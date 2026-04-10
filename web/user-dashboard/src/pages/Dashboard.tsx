import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { tokenStorage } from '../utils/tokenStorage';
import '../styles/Dashboard.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SavedLocationsTab } from '../components/SavedLocationsTab';
import { NotificationPreferencesSection } from '../components/NotificationPreferencesSection';
import { LiveRouteMap } from '../components/LiveRouteMap';
import BookingCard, { ACTIVE_STATUSES } from '../components/BookingCard';
import BookingTabs from '../components/BookingTabs';
import TriageChat from '../components/TriageChat';
import type { TriageResult } from '../services/triageEngine';

const API_BASE_URL = 'http://localhost:3000/api';

interface LiveEtaResponse {
  source: 'google' | 'fallback';
  etaMinutes: number;
  etaText: string;
  expectedArrivalIso: string;
  distanceText?: string;
  distanceKm?: number;
}

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Custom icons
const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

interface PlaceSuggestion {
  display_name: string;
  lat: string;
  lon: string;
  place_id: number;
}

interface Hospital {
  id: string;
  name: string;
  address: string;
  phoneNumber: string;
  emergencyCapacity: number;
  totalBeds: number;
}

interface Booking {
  id: string;
  userId: string;
  hospitalId: string;
  pickupLocation: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
  bookingType: 'EMERGENCY' | 'SCHEDULED';
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  scheduledTime?: string;
  createdAt: string;
  hospital?: Hospital;
  dispatch?: {
    status: string;
    hospital?: {
      id: string;
      name: string;
      address?: string;
      latitude?: number;
      longitude?: number;
    };
    ambulance?: {
      vehicleNumber: string;
      type: string;
      currentLatitude?: number;
      currentLongitude?: number;
    };
  };
}

interface UserProfile {
  id?: string;
  email?: string;
  firstName: string;
  lastName: string;
  name: string;
  phoneNumber: string;
  address?: string;
  emergencyContact?: string;
  bloodType?: string;
  medicalHistory?: string;
  dateOfBirth?: string;
}

type TabType = 'bookings' | 'profile' | 'locations';

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

const formatExpectedTime = (etaMinutes: number) => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + etaMinutes);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function Dashboard() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingType, setBookingType] = useState<'EMERGENCY' | 'SCHEDULED'>('EMERGENCY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('bookings');
  const [bookingSubTab, setBookingSubTab] = useState<'current' | 'history'>('current');
  const [editingProfile, setEditingProfile] = useState(false);
  const [showSOSConfirm, setShowSOSConfirm] = useState(false);
  const [sosActivating, setSosActivating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [trackingBooking, setTrackingBooking] = useState<Booking | null>(null);
  const [liveEta, setLiveEta] = useState<LiveEtaResponse | null>(null);
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    address: '',
    emergencyContact: '',
    dateOfBirth: ''
  });
  
  // Form states
  const [pickupLocation, setPickupLocation] = useState('');
  const [dropoffLocation, setDropoffLocation] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [ambulanceFacilities, setAmbulanceFacilities] = useState({
    oxygenSupport: false,
    ventilator: false,
    cardiac: false,
    icuEquipment: false,
    wheelchairAccessible: false,
    advancedLifeSupport: false,
  });
  const [triageData, setTriageData] = useState({
    chiefComplaint: '',
    severity: 'MEDIUM' as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
    isBreathing: true,
    isConscious: true,
    hasChestPain: false,
    hasSevereBleeding: false,
  });
  const [triageCompleted, setTriageCompleted] = useState(false);
  const [, setTriageResultData] = useState<TriageResult | null>(null);

  // Map states
  const [gettingLocation, setGettingLocation] = useState(false);
  const [pickupCoords, setPickupCoords] = useState<{lat: number; lng: number} | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{lat: number; lng: number} | null>(null);
  const [pickupSuggestions, setPickupSuggestions] = useState<PlaceSuggestion[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showPickupSuggestions, setShowPickupSuggestions] = useState(false);
  const [showDropoffSuggestions, setShowDropoffSuggestions] = useState(false);
  const pickupMapRef = useRef<HTMLDivElement>(null);
  const dropoffMapRef = useRef<HTMLDivElement>(null);
  const pickupMapInstanceRef = useRef<L.Map | null>(null);
  const dropoffMapInstanceRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropoffMarkerRef = useRef<L.Marker | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No need to fetch hospitals for emergency pickup-only bookings

  // Initialize pickup map with Leaflet
  useEffect(() => {
    if (showBookingForm && pickupMapRef.current && !pickupMapInstanceRef.current) {
      const defaultCenter: [number, number] = [28.6139, 77.2090]; // Delhi
      pickupMapInstanceRef.current = L.map(pickupMapRef.current).setView(defaultCenter, 12);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(pickupMapInstanceRef.current);

      pickupMarkerRef.current = L.marker(defaultCenter, { icon: greenIcon, draggable: true })
        .addTo(pickupMapInstanceRef.current);

      pickupMarkerRef.current.on('dragend', function() {
        const pos = pickupMarkerRef.current?.getLatLng();
        if (pos) {
          setPickupCoords({ lat: pos.lat, lng: pos.lng });
          reverseGeocode(pos.lat, pos.lng, setPickupLocation);
        }
      });

      pickupMapInstanceRef.current.on('click', (e: L.LeafletMouseEvent) => {
        if (pickupMarkerRef.current) {
          pickupMarkerRef.current.setLatLng(e.latlng);
          setPickupCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
          reverseGeocode(e.latlng.lat, e.latlng.lng, setPickupLocation);
        }
      });
    }
    
    return () => {
      if (pickupMapInstanceRef.current && !showBookingForm) {
        pickupMapInstanceRef.current.remove();
        pickupMapInstanceRef.current = null;
        pickupMarkerRef.current = null;
      }
    };
  }, [showBookingForm]);

  // Initialize dropoff map with Leaflet
  useEffect(() => {
    if (showBookingForm && bookingType === 'SCHEDULED' && dropoffMapRef.current && !dropoffMapInstanceRef.current) {
      const defaultCenter: [number, number] = [28.6139, 77.2090]; // Delhi
      dropoffMapInstanceRef.current = L.map(dropoffMapRef.current).setView(defaultCenter, 12);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(dropoffMapInstanceRef.current);

      dropoffMarkerRef.current = L.marker(defaultCenter, { icon: redIcon, draggable: true })
        .addTo(dropoffMapInstanceRef.current);

      dropoffMarkerRef.current.on('dragend', function() {
        const pos = dropoffMarkerRef.current?.getLatLng();
        if (pos) {
          setDropoffCoords({ lat: pos.lat, lng: pos.lng });
          reverseGeocode(pos.lat, pos.lng, setDropoffLocation);
        }
      });

      dropoffMapInstanceRef.current.on('click', (e: L.LeafletMouseEvent) => {
        if (dropoffMarkerRef.current) {
          dropoffMarkerRef.current.setLatLng(e.latlng);
          setDropoffCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
          reverseGeocode(e.latlng.lat, e.latlng.lng, setDropoffLocation);
        }
      });
    }
    
    return () => {
      if (dropoffMapInstanceRef.current && !showBookingForm) {
        dropoffMapInstanceRef.current.remove();
        dropoffMapInstanceRef.current = null;
        dropoffMarkerRef.current = null;
      }
    };
  }, [showBookingForm, bookingType]);

  // Reset map refs when form closes
  useEffect(() => {
    if (!showBookingForm) {
      if (pickupMapInstanceRef.current) {
        pickupMapInstanceRef.current.remove();
        pickupMapInstanceRef.current = null;
      }
      if (dropoffMapInstanceRef.current) {
        dropoffMapInstanceRef.current.remove();
        dropoffMapInstanceRef.current = null;
      }
      pickupMarkerRef.current = null;
      dropoffMarkerRef.current = null;
      setPickupSuggestions([]);
      setDropoffSuggestions([]);
    }
  }, [showBookingForm]);

  const trackingMetrics = useMemo(() => {
    if (!trackingBooking) {
      return null;
    }

    const pickupLat = trackingBooking.pickupLatitude ?? 28.6139;
    const pickupLng = trackingBooking.pickupLongitude ?? 77.209;
    const destinationLat =
      trackingBooking.destinationLatitude ?? trackingBooking.dispatch?.hospital?.latitude;
    const destinationLng =
      trackingBooking.destinationLongitude ?? trackingBooking.dispatch?.hospital?.longitude;
    const ambulanceLat = trackingBooking.dispatch?.ambulance?.currentLatitude ?? (pickupLat - 0.05);
    const ambulanceLng = trackingBooking.dispatch?.ambulance?.currentLongitude ?? (pickupLng + 0.05);
    const dispatchStatus = trackingBooking.dispatch?.status || trackingBooking.status;

    const towardPickup = ['ASSIGNED', 'DISPATCHED', 'EN_ROUTE', 'EN_ROUTE_PICKUP'].includes(dispatchStatus);
    const towardHospital = ['EN_ROUTE_HOSPITAL'].includes(dispatchStatus);
    const arrived = ['AT_HOSPITAL', 'COMPLETED'].includes(dispatchStatus);

    let targetLat = pickupLat;
    let targetLng = pickupLng;
    let targetLabel = 'Pickup Location';
    let routeTitle = 'Route To Pickup';
    let etaLabel = 'ETA to Pickup';
    let etaMinutes: number | null = null;

    if (towardHospital && destinationLat != null && destinationLng != null) {
      targetLat = destinationLat;
      targetLng = destinationLng;
      targetLabel = trackingBooking.dispatch?.hospital?.name || 'Destination Hospital';
      routeTitle = 'Route To Hospital';
      etaLabel = 'ETA to Hospital';
      etaMinutes = Math.max(1, Math.round((calculateDistanceKm(ambulanceLat, ambulanceLng, targetLat, targetLng) / 35) * 60));
    } else if (towardPickup) {
      etaMinutes = Math.max(1, Math.round((calculateDistanceKm(ambulanceLat, ambulanceLng, targetLat, targetLng) / 35) * 60));
    } else if (dispatchStatus === 'AT_PICKUP') {
      if (destinationLat != null && destinationLng != null) {
        targetLat = destinationLat;
        targetLng = destinationLng;
        targetLabel = trackingBooking.dispatch?.hospital?.name || 'Destination Hospital';
        routeTitle = 'Route To Hospital';
        etaLabel = 'Preparing Transfer';
      }
      etaMinutes = 3;
    } else if (arrived) {
      etaMinutes = 0;
      if (destinationLat != null && destinationLng != null) {
        targetLat = destinationLat;
        targetLng = destinationLng;
        targetLabel = trackingBooking.dispatch?.hospital?.name || 'Destination Hospital';
        routeTitle = 'Route Completed';
      }
    }

    const etaText =
      etaMinutes == null
        ? 'Calculating...'
        : etaMinutes === 0
          ? 'Arrived'
          : `${etaMinutes} min`;

    return {
      dispatchStatus,
      ambulanceLat,
      ambulanceLng,
      targetLat,
      targetLng,
      targetLabel,
      routeTitle,
      etaLabel,
      etaMinutes,
      etaText,
      expectedTimeText: etaMinutes != null && etaMinutes > 0 ? formatExpectedTime(etaMinutes) : null,
    };
  }, [trackingBooking]);

  useEffect(() => {
    if (!trackingBooking || !trackingMetrics) {
      setLiveEta(null);
      return;
    }

    if (trackingMetrics.etaMinutes === 0) {
      setLiveEta({
        source: 'fallback',
        etaMinutes: 0,
        etaText: 'Arrived',
        expectedArrivalIso: new Date().toISOString(),
      });
      return;
    }

    const token = tokenStorage.getToken();
    if (!token) {
      setLiveEta(null);
      return;
    }

    let isCancelled = false;

    const fetchLiveEta = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/dashboard/eta`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            originLat: trackingMetrics.ambulanceLat,
            originLng: trackingMetrics.ambulanceLng,
            destinationLat: trackingMetrics.targetLat,
            destinationLng: trackingMetrics.targetLng,
          },
        });

        if (!isCancelled) {
          setLiveEta(response.data);
        }
      } catch {
        if (!isCancelled) {
          setLiveEta(null);
        }
      }
    };

    fetchLiveEta();
    const interval = setInterval(fetchLiveEta, 30000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [trackingBooking, trackingMetrics]);

  // Reverse geocode using Nominatim (OpenStreetMap)
  const reverseGeocode = async (lat: number, lng: number, setter: (val: string) => void) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await response.json();
      if (data.display_name) {
        setter(data.display_name);
      }
    } catch (err) {
      console.error('Reverse geocoding failed:', err);
    }
  };

  // Search places using Nominatim
  const searchPlaces = async (query: string, setter: (suggestions: PlaceSuggestion[]) => void) => {
    if (query.length < 3) {
      setter([]);
      return;
    }
    
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data: PlaceSuggestion[] = await response.json();
      setter(data);
    } catch (err) {
      console.error('Place search failed:', err);
      setter([]);
    }
  };

  // Handle pickup location input change
  const handlePickupInputChange = (value: string) => {
    setPickupLocation(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      searchPlaces(value, setPickupSuggestions);
      setShowPickupSuggestions(true);
    }, 300);
  };

  // Handle dropoff location input change
  const handleDropoffInputChange = (value: string) => {
    setDropoffLocation(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      searchPlaces(value, setDropoffSuggestions);
      setShowDropoffSuggestions(true);
    }, 300);
  };

  // Select a pickup suggestion
  const selectPickupSuggestion = (suggestion: PlaceSuggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lng = parseFloat(suggestion.lon);
    setPickupLocation(suggestion.display_name);
    setPickupCoords({ lat, lng });
    setShowPickupSuggestions(false);
    setPickupSuggestions([]);
    
    if (pickupMapInstanceRef.current && pickupMarkerRef.current) {
      pickupMapInstanceRef.current.setView([lat, lng], 15);
      pickupMarkerRef.current.setLatLng([lat, lng]);
    }
  };

  // Select a dropoff suggestion
  const selectDropoffSuggestion = (suggestion: PlaceSuggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lng = parseFloat(suggestion.lon);
    setDropoffLocation(suggestion.display_name);
    setDropoffCoords({ lat, lng });
    setShowDropoffSuggestions(false);
    setDropoffSuggestions([]);
    
    if (dropoffMapInstanceRef.current && dropoffMarkerRef.current) {
      dropoffMapInstanceRef.current.setView([lat, lng], 15);
      dropoffMarkerRef.current.setLatLng([lat, lng]);
    }
  };

  // Fallback: Get location by IP address
  const getLocationByIP = async () => {
    try {
      console.log('Trying IP-based geolocation...');
      const response = await fetch('https://ipapi.co/json/');
      const data = await response.json();
      
      if (data.latitude && data.longitude) {
        const lat = data.latitude;
        const lng = data.longitude;
        console.log('Got IP location:', lat, lng, data.city);
        
        setPickupCoords({ lat, lng });
        setPickupLocation(`${data.city || ''}, ${data.region || ''}, ${data.country_name || ''}`);
        
        if (pickupMapInstanceRef.current && pickupMarkerRef.current) {
          pickupMapInstanceRef.current.setView([lat, lng], 14);
          pickupMarkerRef.current.setLatLng([lat, lng]);
        }
        return true;
      }
    } catch (err) {
      console.error('IP geolocation failed:', err);
    }
    return false;
  };

  const getCurrentLocation = async () => {
    console.log('getCurrentLocation called');
    setGettingLocation(true);
    
    // First try browser geolocation
    if (navigator.geolocation) {
      const options = {
        enableHighAccuracy: false, // Use false first for faster response
        timeout: 10000,
        maximumAge: 60000
      };
      
      console.log('Requesting browser geolocation...');
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          console.log('Got browser location:', lat, lng);
          
          setPickupCoords({ lat, lng });
          setPickupLocation('Getting address...');
          
          setTimeout(() => {
            if (pickupMapInstanceRef.current && pickupMarkerRef.current) {
              pickupMapInstanceRef.current.setView([lat, lng], 16);
              pickupMarkerRef.current.setLatLng([lat, lng]);
            }
          }, 100);
          
          reverseGeocode(lat, lng, setPickupLocation);
          setGettingLocation(false);
        },
        async (error) => {
          console.error('Browser geolocation error:', error);
          
          // Try IP-based fallback
          const ipSuccess = await getLocationByIP();
          
          if (!ipSuccess) {
            toast.error('Unable to get location. Please search for your address or click on the map.');
          }
          setGettingLocation(false);
        },
        options
      );
    } else {
      // No browser geolocation, try IP
      const ipSuccess = await getLocationByIP();
      if (!ipSuccess) {
        toast.error('Geolocation unavailable. Please search for your address manually.');
      }
      setGettingLocation(false);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const token = tokenStorage.getToken();
      const response = await axios.get(`${API_BASE_URL}/dashboard/user`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = response.data;
      
      // Set user profile
      if (data.user) {
        const profile = {
          id: data.user.id,
          email: data.user.email,
          firstName: data.user.firstName || '',
          lastName: data.user.lastName || '',
          name: data.user.name || `${data.user.firstName || ''} ${data.user.lastName || ''}`.trim() || 'User',
          phoneNumber: data.user.phoneNumber || 'N/A',
          address: data.user.address || '',
          emergencyContact: data.user.emergencyContact || '',
          bloodType: data.user.bloodType,
          medicalHistory: data.user.medicalHistory,
          dateOfBirth: data.user.dateOfBirth
        };
        setUserProfile(profile);
        setProfileForm({
          firstName: profile.firstName,
          lastName: profile.lastName,
          phoneNumber: profile.phoneNumber === 'N/A' ? '' : profile.phoneNumber,
          address: profile.address || '',
          emergencyContact: profile.emergencyContact || '',
          dateOfBirth: profile.dateOfBirth || ''
        });
      }
      
      // Set bookings
      if (data.bookings && data.bookings.length > 0) {
        const mappedBookings = data.bookings.map((b: any) => ({
          id: b.id,
          userId: b.userId,
          hospitalId: b.hospitalId,
          pickupLocation: b.pickupLocation || 'Not specified',
          pickupLatitude: b.pickupLatitude != null ? Number(b.pickupLatitude) : undefined,
          pickupLongitude: b.pickupLongitude != null ? Number(b.pickupLongitude) : undefined,
          destinationLatitude:
            b.destinationLatitude != null
              ? Number(b.destinationLatitude)
              : (b.dispatch?.hospital?.latitude != null ? Number(b.dispatch.hospital.latitude) : undefined),
          destinationLongitude:
            b.destinationLongitude != null
              ? Number(b.destinationLongitude)
              : (b.dispatch?.hospital?.longitude != null ? Number(b.dispatch.hospital.longitude) : undefined),
          bookingType: b.bookingType || 'EMERGENCY',
          severity: b.severity || 'MEDIUM',
          status: b.status || 'PENDING',
          scheduledTime: b.scheduledTime,
          createdAt: b.createdAt,
          hospital: b.hospital ? {
            id: b.hospital.id,
            name: b.hospital.name,
            address: b.hospital.address || '',
            phoneNumber: b.hospital.phoneNumber || '',
            emergencyCapacity: b.hospital.emergencyCapacity || 0,
            totalBeds: b.hospital.totalBeds || 0
          } : undefined,
          dispatch: b.dispatch ? {
            status: b.dispatch.status,
            hospital: b.dispatch.hospital ? {
              id: b.dispatch.hospital.id,
              name: b.dispatch.hospital.name,
              address: b.dispatch.hospital.address,
              latitude: b.dispatch.hospital.latitude != null ? Number(b.dispatch.hospital.latitude) : undefined,
              longitude: b.dispatch.hospital.longitude != null ? Number(b.dispatch.hospital.longitude) : undefined,
            } : undefined,
            ambulance: b.dispatch.ambulance ? {
              vehicleNumber: b.dispatch.ambulance.vehicleNumber,
              type: b.dispatch.ambulance.type,
              currentLatitude: b.dispatch.ambulance.currentLatitude != null ? Number(b.dispatch.ambulance.currentLatitude) : undefined,
              currentLongitude: b.dispatch.ambulance.currentLongitude != null ? Number(b.dispatch.ambulance.currentLongitude) : undefined,
            } : undefined
          } : undefined
        }));

        setBookings(mappedBookings);

        if (trackingBooking) {
          const updatedTracking = mappedBookings.find((b: Booking) => b.id === trackingBooking.id);
          if (updatedTracking) {
            setTrackingBooking(updatedTracking);
          }
        }
      }
      
      setLoading(false);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.response?.data?.message || 'Failed to load dashboard data');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    
    // Refresh data every 30 seconds
    const refreshInterval = setInterval(fetchDashboardData, 30000);

    return () => clearInterval(refreshInterval);
  }, []);

  useEffect(() => {
    const token = tokenStorage.getToken();
    if (!token) {
      return;
    }

    const socket = io('http://localhost:3000', {
      transports: ['websocket'],
    });

    const onDispatchDiverted = (payload: any) => {
      const isRelevant = payload?.userId === userProfile?.id || bookings.some((b) => b.id === payload?.bookingId);
      if (!isRelevant) return;

      const oldName = payload?.oldHospital?.name || 'previous hospital';
      const newName = payload?.newHospital?.name || 'new hospital';
      toast(`🔀 ${oldName} is unavailable. Ambulance diverted to ${newName}.`, { duration: 6000 });
      fetchDashboardData();
    };

    socket.on('dispatch_diverted', onDispatchDiverted);

    return () => {
      socket.off('dispatch_diverted', onDispatchDiverted);
      socket.disconnect();
    };
  }, [userProfile?.id, bookings]);

  const handleCreateBooking = async (triageOverride?: { chiefComplaint: string; severity: string; isBreathing: boolean; isConscious: boolean; hasChestPain: boolean; hasSevereBleeding: boolean }) => {
    try {
      // Validate required fields
      if (!pickupLocation && !pickupCoords) {
        toast.error('Please select a pickup location');
        return;
      }

      if (bookingType === 'SCHEDULED' && (!dropoffLocation || !scheduledTime)) {
        toast.error('Please provide dropoff location and scheduled time for scheduled transport');
        return;
      }

      const token = tokenStorage.getToken();
      const bookingData: any = {
        pickupLocation: pickupLocation || 'Current Location',
        pickupAddress: pickupLocation || 'Current Location',
        pickupLatitude: pickupCoords?.lat || 28.6139,
        pickupLongitude: pickupCoords?.lng || 77.2090,
        bookingType,
      };

      if (bookingType === 'SCHEDULED') {
        bookingData.dropoffLocation = dropoffLocation;
        bookingData.destinationAddress = dropoffLocation;
        bookingData.destinationLatitude = dropoffCoords?.lat;
        bookingData.destinationLongitude = dropoffCoords?.lng;
        bookingData.scheduledTime = scheduledTime;
        bookingData.ambulanceFacilities = ambulanceFacilities;
      } else {
        const td = triageOverride || triageData;
        bookingData.triageData = td;
        bookingData.severity = td.severity;
        bookingData.description = td.chiefComplaint;
      }

      console.log('Creating booking with data:', bookingData);

      const response = await axios.post(
        `${API_BASE_URL}/bookings`,
        bookingData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      console.log('Booking created successfully:', response.data);

      // Reset form
      setShowBookingForm(false);
      setPickupLocation('');
      setDropoffLocation('');
      setPickupCoords(null);
      setDropoffCoords(null);
      setScheduledTime('');
      setAmbulanceFacilities({
        oxygenSupport: false,
        ventilator: false,
        cardiac: false,
        icuEquipment: false,
        wheelchairAccessible: false,
        advancedLifeSupport: false,
      });
      setTriageData({
        chiefComplaint: '',
        severity: 'MEDIUM',
        isBreathing: true,
        isConscious: true,
        hasChestPain: false,
        hasSevereBleeding: false,
      });
      setTriageCompleted(false);
      setTriageResultData(null);

      await fetchDashboardData();
      toast.success('Booking created! An ambulance will be assigned shortly.');
    } catch (err: any) {
      console.error('Failed to create booking:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to create booking';
      toast.error(errorMessage);
    }
  };

  // Emergency SOS Handler
  const handleSOSEmergency = async () => {
    setSosActivating(true);
    try {
      // Get current location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });

      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      // Reverse geocode to get address
      let address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      try {
        const response = await axios.get(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        address = response.data.display_name;
      } catch (err) {
        console.error('Reverse geocoding failed:', err);
      }

      // Create emergency booking with pre-filled critical info
      const token = tokenStorage.getToken();
      const bookingData = {
        pickupLocation: address,
        pickupAddress: address,
        pickupLatitude: lat,
        pickupLongitude: lng,
        bookingType: 'EMERGENCY',
        triageData: {
          chiefComplaint: 'SOS Emergency - Immediate assistance required',
          severity: 'CRITICAL',
          isBreathing: true,
          isConscious: true,
          hasChestPain: false,
          hasSevereBleeding: false,
        }
      };

      const response = await axios.post(
        `${API_BASE_URL}/bookings`,
        bookingData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Call emergency services (simulate)
      console.log('📞 Emergency services alerted!');
      
      // Notify emergency contact
      if (userProfile?.emergencyContact) {
        console.log(`📲 Notifying emergency contact: ${userProfile.emergencyContact}`);
      }

      await fetchDashboardData();
      setShowSOSConfirm(false);
      toast.success('🚨 SOS activated! Ambulance dispatched — stay calm, help is on the way!', { duration: 6000 });

      // Start tracking the new booking
      const newBooking = response.data;
      setTrackingBooking(newBooking);

    } catch (err) {
      console.error('SOS Emergency failed:', err);
      toast.error('Failed to activate SOS. Please try again or call emergency services directly.');
    } finally {
      setSosActivating(false);
    }
  };

  // Start tracking a booking
  const startTracking = (booking: Booking) => {
    setTrackingBooking(booking);
    setActiveTab('bookings');
  };

  const handleCancelBooking = async (bookingId: string) => {
    toast((t: { id: string }) => (
      <span style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        <span>Cancel this booking?</span>
        <button onClick={async () => {
          toast.dismiss(t.id);
          try {
            const token = tokenStorage.getToken();
            try {
              await axios.patch(`${API_BASE_URL}/bookings/${bookingId}/cancel`, {}, { headers: { Authorization: `Bearer ${token}` } });
            } catch {
              await axios.patch(`${API_BASE_URL}/bookings/${bookingId}`, { status: 'CANCELLED' }, { headers: { Authorization: `Bearer ${token}` } });
            }
            await fetchDashboardData();
            toast.success('Booking cancelled.');
          } catch (err: any) {
            toast.error(err.response?.data?.message || 'Failed to cancel booking');
          }
        }} style={{ padding:'4px 12px', background:'#de350b', color:'white', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:600, fontSize:'13px' }}>
          Yes, cancel
        </button>
        <button onClick={() => toast.dismiss(t.id)} style={{ padding:'4px 12px', background:'#f4f5f7', color:'#172b4d', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:600, fontSize:'13px' }}>
          Keep
        </button>
      </span>
    ), { duration: 8000 });
  };

  const handleUpdateProfile = async () => {
    try {
      const token = tokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/users/profile`,
        profileForm,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setEditingProfile(false);
      await fetchDashboardData();
      toast.success('Profile updated successfully!');
    } catch (err) {
      console.error('Failed to update profile:', err);
      toast.error('Failed to update profile');
    }
  };

  const handleLogout = () => {
    tokenStorage.clearToken();
    navigate('/');
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case 'CRITICAL': return '#de350b';
      case 'HIGH': return '#ff8b00';
      case 'MEDIUM': return '#ffab00';
      case 'LOW': return '#00875a';
      default: return '#0066cc';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return '#6b778c';
      case 'CONFIRMED': return '#0066cc';
      case 'ASSIGNED': return '#ff8b00';
      case 'IN_PROGRESS': return '#00875a';
      case 'COMPLETED': return '#6b778c';
      case 'CANCELLED': return '#de350b';
      default: return '#6b778c';
    }
  };

  const getDispatchStatusColor = (status: string) => {
    switch (status) {
      case 'DISPATCHED':
      case 'ASSIGNED': return '#1976d2';
      case 'EN_ROUTE': return '#ff9800';
      case 'AT_PICKUP': return '#4caf50';
      case 'EN_ROUTE_HOSPITAL': return '#ff9800';
      case 'AT_HOSPITAL': return '#4caf50';
      case 'COMPLETED': return '#9e9e9e';
      default: return '#1976d2';
    }
  };

  const getDispatchStatusLabel = (status: string) => {
    switch (status) {
      case 'DISPATCHED':
      case 'ASSIGNED': return ' Ambulance Assigned';
      case 'EN_ROUTE': return ' En Route to You';
      case 'AT_PICKUP': return '✅ Arrived - Waiting';
      case 'EN_ROUTE_HOSPITAL': return '🏥 Going to Hospital';
      case 'AT_HOSPITAL': return '🏥 At Hospital';
      case 'COMPLETED': return '✓ Completed';
      default: return status.replace('_', ' ');
    }
  };

  const getDispatchProgress = (status: string) => {
    switch (status) {
      case 'DISPATCHED':
      case 'ASSIGNED': return 15;
      case 'EN_ROUTE': return 35;
      case 'AT_PICKUP': return 50;
      case 'EN_ROUTE_HOSPITAL': return 75;
      case 'AT_HOSPITAL': return 90;
      case 'COMPLETED': return 100;
      default: return 10;
    }
  };

  if (loading) {
    return (
      <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', background:'#f5f7fa', flexDirection:'column', gap:'16px' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        <div style={{ width:'44px', height:'44px', borderRadius:'50%', border:'3px solid #e6f7f9', borderTopColor:'#00a3bf', animation:'spin 0.8s linear infinite' }} />
        <div style={{ fontSize:'15px', color:'#6b778c', fontWeight:500 }}>Loading dashboard…</div>
        <div style={{ display:'flex', flexDirection:'column', gap:'12px', width:'min(420px,90vw)', marginTop:'8px' }}>
          {[1,2,3].map(i => (
            <div key={i} style={{ height:'68px', borderRadius:'12px', background:'#e0e0e0', animation:'pulse 1.6s ease-in-out infinite', animationDelay:`${i*0.15}s` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', background:'#f5f7fa', flexDirection:'column', gap:'12px', padding:'24px' }}>
        <div style={{ fontSize:'40px' }}>⚠️</div>
        <div style={{ fontSize:'16px', color:'#de350b', fontWeight:600, textAlign:'center' }}>{error}</div>
        <button onClick={fetchDashboardData} style={{ padding:'10px 24px', background:'#00a3bf', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:600, fontSize:'14px' }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Mobile overlay */}
      <div className={`sidebar-overlay ${sidebarOpen ? 'overlay--visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-section">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="#00a3bf"/>
              <path d="M12 8v8m-4-4h8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="logo-text">ECS User</span>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} aria-label="Close menu">✕</button>
          </div>
          <div className="user-badge">User Portal</div>
        </div>

        <nav className="nav-menu">
          <a href="#" className={`nav-item ${activeTab === 'bookings' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('bookings'); setShowBookingForm(false); setSidebarOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="18" rx="2" fill="currentColor"/>
              <path d="M16 2v4M8 2v4M3 10h18" stroke="white" strokeWidth="2"/>
            </svg>
            <span>My Bookings</span>
          </a>
          <a href="#" className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('profile'); setShowBookingForm(false); setSidebarOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" fill="currentColor"/>
              <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" fill="currentColor"/>
            </svg>
            <span>Profile</span>
          </a>
          <a href="#" className={`nav-item ${activeTab === 'locations' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('locations'); setShowBookingForm(false); setSidebarOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/>
            </svg>
            <span>Saved Locations</span>
          </a>
        </nav>

        <button onClick={handleLogout} className="logout-btn">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" fill="currentColor"/>
          </svg>
          Logout
        </button>
      </aside>

      <main className="main-content">
        {/* Mobile top bar */}
        <div className="mobile-topbar">
          <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>
          <svg style={{ width:28, height:28, flexShrink:0 }} viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="#00a3bf"/>
            <path d="M12 8v8m-4-4h8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span style={{ fontWeight:700, fontSize:16, color:'#172b4d', flex:1 }}>ECS User</span>
          {userProfile && <span style={{ fontSize:13, color:'#6b778c' }}>{userProfile.name}</span>}
        </div>

        <header className="dashboard-header">
          <div>
            <h1>{activeTab === 'bookings' ? 'My Bookings' : activeTab === 'profile' ? 'My Profile' : 'Saved Locations'}</h1>
            <p>{activeTab === 'bookings' ? 'Book ambulance services and track your requests' : activeTab === 'profile' ? 'Manage your personal information' : 'Manage your frequently used locations'}</p>
          </div>
          {userProfile && activeTab === 'bookings' && (
            <div className="user-info-card">
              <div className="info-row">
                <strong>{userProfile.name}</strong>
              </div>
              <div className="info-row">
                {userProfile.phoneNumber}
              </div>
              {userProfile.bloodType && (
                <div className="info-row">
                  Blood Type: {userProfile.bloodType}
                </div>
              )}
            </div>
          )}
        </header>

        {activeTab === 'profile' ? (
          <div className="profile-section">
            {/* Profile Header with Avatar */}
            <div style={{ 
              background: 'linear-gradient(135deg, #0066cc 0%, #00a3bf 100%)', 
              borderRadius: '12px 12px 0 0', 
              padding: '40px 32px',
              color: 'white',
              marginBottom: '0'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                <div style={{ 
                  width: '100px', 
                  height: '100px', 
                  borderRadius: '50%', 
                  background: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '40px',
                  fontWeight: '700',
                  color: '#0066cc',
                  border: '4px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)'
                }}>
                  {userProfile?.name ? userProfile.name.charAt(0).toUpperCase() : '👤'}
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700' }}>
                    {userProfile?.name || 'User Profile'}
                  </h2>
                  <p style={{ margin: '0 0 4px 0', fontSize: '16px', opacity: 0.9 }}>
                    📧 {userProfile?.email || 'No email'}
                  </p>
                  <p style={{ margin: 0, fontSize: '14px', opacity: 0.8 }}>
                    📞 {userProfile?.phoneNumber || 'No phone number'}
                  </p>
                </div>
                {!editingProfile && (
                  <button 
                    onClick={() => setEditingProfile(true)} 
                    style={{ 
                      padding: '12px 24px', 
                      backgroundColor: 'white', 
                      color: '#0066cc', 
                      border: 'none', 
                      borderRadius: '8px', 
                      cursor: 'pointer',
                      fontSize: '15px',
                      fontWeight: '600',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    ✏️ Edit Profile
                  </button>
                )}
              </div>
            </div>

            <div style={{ background: 'white', borderRadius: '0 0 12px 12px', padding: '32px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
              {editingProfile && (
                <div style={{ 
                  display: 'flex', 
                  gap: '12px', 
                  marginBottom: '24px', 
                  padding: '16px', 
                  background: '#fff4e6', 
                  borderRadius: '8px',
                  border: '1px solid #ffab00'
                }}>
                  <div style={{ fontSize: '20px' }}>💡</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', color: '#172b4d', marginBottom: '4px' }}>
                      Complete Your Profile
                    </div>
                    <div style={{ fontSize: '13px', color: '#666' }}>
                      Adding medical information and emergency contacts helps responders provide better care during emergencies.
                    </div>
                  </div>
                </div>
              )}

              {!editingProfile ? (
                <>
                  {/* Personal Information Section */}
                  <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ 
                      margin: '0 0 20px 0', 
                      fontSize: '18px', 
                      color: '#172b4d',
                      paddingBottom: '12px',
                      borderBottom: '2px solid #e0e0e0'
                    }}>
                      👤 Personal Information
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                      <div style={{ padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
                        <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Full Name</label>
                        <p style={{ margin: '8px 0 0', fontSize: '17px', color: '#172b4d', fontWeight: '600' }}>{userProfile?.name || 'Not set'}</p>
                      </div>
                      <div style={{ padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
                        <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Phone Number</label>
                        <p style={{ margin: '8px 0 0', fontSize: '17px', color: '#172b4d', fontWeight: '600' }}>{userProfile?.phoneNumber || 'Not set'}</p>
                      </div>
                      <div style={{ padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
                        <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Date of Birth</label>
                        <p style={{ margin: '8px 0 0', fontSize: '17px', color: '#172b4d', fontWeight: '600' }}>
                          {userProfile?.dateOfBirth ? new Date(userProfile.dateOfBirth).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not set'}
                        </p>
                      </div>
                      <div style={{ padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '12px', border: '1px solid #e0e0e0', gridColumn: 'span 2' }}>
                        <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Address</label>
                        <p style={{ margin: '8px 0 0', fontSize: '17px', color: '#172b4d', fontWeight: '600' }}>{userProfile?.address || 'Not set'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Emergency Contact Section */}
                  <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ 
                      margin: '0 0 20px 0', 
                      fontSize: '18px', 
                      color: '#172b4d',
                      paddingBottom: '12px',
                      borderBottom: '2px solid #e0e0e0'
                    }}>
                      🚨 Emergency Information
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                      <div style={{ 
                        padding: '20px', 
                        background: userProfile?.emergencyContact ? '#e3f5ff' : '#fff4e6', 
                        borderRadius: '12px', 
                        border: userProfile?.emergencyContact ? '1px solid #0066cc' : '1px solid #ffab00'
                      }}>
                        <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Emergency Contact</label>
                        <p style={{ margin: '8px 0 0', fontSize: '17px', color: '#172b4d', fontWeight: '600' }}>
                          {userProfile?.emergencyContact || '⚠️ Not set - Please add'}
                        </p>
                      </div>
                      <div style={{ padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
                        <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Blood Type</label>
                        <p style={{ margin: '8px 0 0', fontSize: '17px', color: '#172b4d', fontWeight: '600' }}>{userProfile?.bloodType || 'Not specified'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Medical History Section */}
                  <div>
                    <h3 style={{ 
                      margin: '0 0 20px 0', 
                      fontSize: '18px', 
                      color: '#172b4d',
                      paddingBottom: '12px',
                      borderBottom: '2px solid #e0e0e0'
                    }}>
                      🏥 Medical Information
                    </h3>
                    <div style={{ padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
                      <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>Medical History</label>
                      <p style={{ margin: '8px 0 0', fontSize: '15px', color: '#172b4d', lineHeight: '1.6' }}>
                        {userProfile?.medicalHistory || 'No medical history recorded'}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Edit Form */}
                  <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ margin: '0 0 20px 0', fontSize: '18px', color: '#172b4d' }}>
                      👤 Personal Information
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#172b4d' }}>
                          First Name <span style={{ color: '#de350b' }}>*</span>
                        </label>
                        <input 
                          type="text" 
                          value={profileForm.firstName} 
                          onChange={(e) => setProfileForm({...profileForm, firstName: e.target.value})} 
                          style={{ 
                            width: '100%', 
                            padding: '12px 16px', 
                            border: '2px solid #dfe1e6', 
                            borderRadius: '8px', 
                            fontSize: '15px', 
                            boxSizing: 'border-box',
                            transition: 'border-color 0.2s'
                          }} 
                          placeholder="Enter first name"
                          onFocus={(e) => e.target.style.borderColor = '#0066cc'}
                          onBlur={(e) => e.target.style.borderColor = '#dfe1e6'}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#172b4d' }}>
                          Last Name <span style={{ color: '#de350b' }}>*</span>
                        </label>
                        <input 
                          type="text" 
                          value={profileForm.lastName} 
                          onChange={(e) => setProfileForm({...profileForm, lastName: e.target.value})} 
                          style={{ 
                            width: '100%', 
                            padding: '12px 16px', 
                            border: '2px solid #dfe1e6', 
                            borderRadius: '8px', 
                            fontSize: '15px', 
                            boxSizing: 'border-box',
                            transition: 'border-color 0.2s'
                          }} 
                          placeholder="Enter last name"
                          onFocus={(e) => e.target.style.borderColor = '#0066cc'}
                          onBlur={(e) => e.target.style.borderColor = '#dfe1e6'}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#172b4d' }}>
                          Phone Number <span style={{ color: '#de350b' }}>*</span>
                        </label>
                        <input 
                          type="tel" 
                          value={profileForm.phoneNumber} 
                          onChange={(e) => setProfileForm({...profileForm, phoneNumber: e.target.value})} 
                          style={{ 
                            width: '100%', 
                            padding: '12px 16px', 
                            border: '2px solid #dfe1e6', 
                            borderRadius: '8px', 
                            fontSize: '15px', 
                            boxSizing: 'border-box',
                            transition: 'border-color 0.2s'
                          }} 
                          placeholder="+1 (555) 000-0000"
                          onFocus={(e) => e.target.style.borderColor = '#0066cc'}
                          onBlur={(e) => e.target.style.borderColor = '#dfe1e6'}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#172b4d' }}>
                          Date of Birth
                        </label>
                        <input 
                          type="date" 
                          value={profileForm.dateOfBirth} 
                          onChange={(e) => setProfileForm({...profileForm, dateOfBirth: e.target.value})} 
                          style={{ 
                            width: '100%', 
                            padding: '12px 16px', 
                            border: '2px solid #dfe1e6', 
                            borderRadius: '8px', 
                            fontSize: '15px', 
                            boxSizing: 'border-box',
                            transition: 'border-color 0.2s'
                          }}
                          onFocus={(e) => e.target.style.borderColor = '#0066cc'}
                          onBlur={(e) => e.target.style.borderColor = '#dfe1e6'}
                        />
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#172b4d' }}>
                          Address
                        </label>
                        <input 
                          type="text" 
                          value={profileForm.address} 
                          onChange={(e) => setProfileForm({...profileForm, address: e.target.value})} 
                          style={{ 
                            width: '100%', 
                            padding: '12px 16px', 
                            border: '2px solid #dfe1e6', 
                            borderRadius: '8px', 
                            fontSize: '15px', 
                            boxSizing: 'border-box',
                            transition: 'border-color 0.2s'
                          }} 
                          placeholder="123 Main St, City, State, ZIP"
                          onFocus={(e) => e.target.style.borderColor = '#0066cc'}
                          onBlur={(e) => e.target.style.borderColor = '#dfe1e6'}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Emergency Contact */}
                  <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ margin: '0 0 20px 0', fontSize: '18px', color: '#172b4d' }}>
                      🚨 Emergency Information
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#172b4d' }}>
                          Emergency Contact <span style={{ color: '#de350b' }}>*</span>
                        </label>
                        <input 
                          type="tel" 
                          value={profileForm.emergencyContact} 
                          onChange={(e) => setProfileForm({...profileForm, emergencyContact: e.target.value})} 
                          style={{ 
                            width: '100%', 
                            padding: '12px 16px', 
                            border: '2px solid #dfe1e6', 
                            borderRadius: '8px', 
                            fontSize: '15px', 
                            boxSizing: 'border-box',
                            transition: 'border-color 0.2s'
                          }} 
                          placeholder="Emergency contact phone number"
                          onFocus={(e) => e.target.style.borderColor = '#de350b'}
                          onBlur={(e) => e.target.style.borderColor = '#dfe1e6'}
                        />
                        <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#666' }}>
                          This person will be notified during emergencies
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ 
                    display: 'flex', 
                    gap: '12px', 
                    paddingTop: '24px', 
                    borderTop: '2px solid #e0e0e0',
                    justifyContent: 'flex-end'
                  }}>
                    <button 
                      onClick={() => setEditingProfile(false)} 
                      style={{ 
                        padding: '12px 24px', 
                        backgroundColor: '#f4f5f7', 
                        color: '#172b4d', 
                        border: '2px solid #dfe1e6', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        fontSize: '15px',
                        fontWeight: '600',
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e0e0e0'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f4f5f7'}
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleUpdateProfile} 
                      style={{ 
                        padding: '12px 32px', 
                        backgroundColor: '#00875a', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        fontSize: '15px',
                        fontWeight: '600',
                        boxShadow: '0 4px 12px rgba(0, 135, 90, 0.3)',
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = '#006644';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = '#00875a';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      💾 Save Changes
                    </button>
                  </div>
                </>
              )}
            </div>
            
            {/* Notification Preferences Section */}
            <div style={{ marginTop: '32px' }}>
              <NotificationPreferencesSection token={tokenStorage.getToken() || ''} />
            </div>
          </div>
        ) : activeTab === 'locations' ? (
          <div style={{ padding: '24px' }}>
            <SavedLocationsTab token={tokenStorage.getToken() || ''} />
          </div>
        ) : !showBookingForm ? (
          <>
            {/* Emergency SOS Button */}
            <div className="sos-container" style={{ 
              background: 'linear-gradient(135deg, #ff1744 0%, #de350b 100%)', 
              borderRadius: '16px', 
              padding: '24px', 
              marginBottom: '24px',
              boxShadow: '0 8px 24px rgba(222, 53, 11, 0.3)',
              border: '3px solid #ff5252'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                  <h2 style={{ color: 'white', margin: '0 0 8px 0', fontSize: '24px', fontWeight: '700' }}>
                    🚨 Emergency SOS
                  </h2>
                  <p style={{ color: 'rgba(255, 255, 255, 0.9)', margin: 0, fontSize: '14px' }}>
                    One-tap emergency assistance • Auto-location • Immediate dispatch
                  </p>
                </div>
                <button 
                  onClick={() => setShowSOSConfirm(true)}
                  disabled={sosActivating}
                  style={{
                    padding: '16px 32px',
                    fontSize: '18px',
                    fontWeight: '700',
                    color: '#de350b',
                    background: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    cursor: sosActivating ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                    transition: 'transform 0.2s',
                    opacity: sosActivating ? 0.7 : 1
                  }}
                  onMouseOver={(e) => !sosActivating && (e.currentTarget.style.transform = 'scale(1.05)')}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  {sosActivating ? '⏳ ACTIVATING...' : '🆘 ACTIVATE SOS'}
                </button>
              </div>
            </div>

            {/* Action Buttons — improved CTA hierarchy */}
            <div style={{ display: 'flex', gap: '14px', marginBottom: '28px', flexWrap: 'wrap' }}>
              <button
                onClick={() => { setBookingType('EMERGENCY'); setShowBookingForm(true); }}
                style={{
                  flex: 1,
                  minWidth: '220px',
                  padding: '15px 28px',
                  background: 'linear-gradient(135deg, #BE123C, #9F1239)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  boxShadow: '0 4px 14px rgba(159,18,57,0.35)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(159,18,57,0.4)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(159,18,57,0.35)'; }}
              >
                🚑 Request Emergency Ambulance
              </button>
              <button
                onClick={() => { setBookingType('SCHEDULED'); setShowBookingForm(true); }}
                style={{
                  flex: 1,
                  minWidth: '180px',
                  padding: '15px 28px',
                  background: 'white',
                  color: '#1E40AF',
                  border: '2px solid #BFDBFE',
                  borderRadius: '12px',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  boxShadow: '0 2px 8px rgba(30,64,175,0.1)',
                  transition: 'transform 0.15s, box-shadow 0.15s, background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                📅 Schedule Transport
              </button>
            </div>

            {/* Bookings Section with Sub-Tabs */}
            <div style={{ marginTop: '8px' }}>
              {/* Sub-tab switcher */}
              {(() => {
                const activeBookings = bookings.filter(b => ACTIVE_STATUSES.includes(b.status));
                const historyBookings = bookings.filter(b => !ACTIVE_STATUSES.includes(b.status));
                return (
                  <>
                    <BookingTabs
                      tabs={[
                        { id: 'current', label: 'Current Bookings', count: activeBookings.length },
                        { id: 'history', label: 'Booking History', count: historyBookings.length },
                      ]}
                      activeTab={bookingSubTab}
                      onChange={id => setBookingSubTab(id as 'current' | 'history')}
                    />

                    {/* Loading skeleton */}
                    {loading ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                        {[1,2,3].map(i => (
                          <div key={i} style={{ background: 'white', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                            <div style={{ height: '4px', background: '#E2E8F0' }} />
                            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                              {[60,80,40,90].map((w, j) => (
                                <div key={j} style={{ height: '14px', borderRadius: '9999px', background: '#F1F5F9', width: `${w}%`, animation: 'pulse 1.5s infinite' }} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : bookingSubTab === 'current' ? (
                      activeBookings.length > 0 ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                          {activeBookings.map(booking => (
                            <BookingCard
                              key={booking.id}
                              booking={booking}
                              onTrack={booking.dispatch ? () => startTracking(booking) : undefined}
                              onCancel={() => handleCancelBooking(booking.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '64px 24px',
                          background: 'white',
                          borderRadius: '16px',
                          border: '1.5px dashed #CBD5E1',
                          gap: '16px',
                          textAlign: 'center',
                        }}>
                          <div style={{ fontSize: '56px', lineHeight: 1 }}>🚑</div>
                          <h3 style={{ margin: 0, fontSize: '20px', color: '#1E293B', fontWeight: 700 }}>No Active Bookings</h3>
                          <p style={{ margin: 0, fontSize: '14px', color: '#64748B', maxWidth: '320px', lineHeight: 1.6 }}>
                            You have no active or upcoming bookings. Use the buttons above to request emergency assistance or schedule a transport.
                          </p>
                        </div>
                      )
                    ) : (
                      /* Booking History Tab */
                      historyBookings.length > 0 ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                          {historyBookings.map(booking => (
                            <BookingCard
                              key={booking.id}
                              booking={booking}
                              showActions={false}
                            />
                          ))}
                        </div>
                      ) : (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '64px 24px',
                          background: 'white',
                          borderRadius: '16px',
                          border: '1.5px dashed #CBD5E1',
                          gap: '16px',
                          textAlign: 'center',
                        }}>
                          <div style={{ fontSize: '56px', lineHeight: 1 }}>📋</div>
                          <h3 style={{ margin: 0, fontSize: '20px', color: '#1E293B', fontWeight: 700 }}>No Booking History</h3>
                          <p style={{ margin: 0, fontSize: '14px', color: '#64748B', maxWidth: '320px', lineHeight: 1.6 }}>
                            Your completed and cancelled bookings will appear here.
                          </p>
                        </div>
                      )
                    )}
                  </>
                );
              })()}
            </div>
          </>
        ) : (
          <div className="booking-form-container">
            <div className="form-header">
              <h2>{bookingType === 'EMERGENCY' ? '🚨 Emergency Ambulance Request' : '📅 Schedule Transport'}</h2>
              <button onClick={() => setShowBookingForm(false)} className="close-btn">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
                </svg>
              </button>
            </div>

            <div className="booking-form">
              <div className="location-section">
                <h3>📍 Pickup Location</h3>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>Search or click on map</label>
                  <input 
                    type="text"
                    value={pickupLocation}
                    onChange={(e) => handlePickupInputChange(e.target.value)}
                    onFocus={() => pickupSuggestions.length > 0 && setShowPickupSuggestions(true)}
                    placeholder="Type to search for pickup location..."
                    autoComplete="off"
                  />
                  {showPickupSuggestions && pickupSuggestions.length > 0 && (
                    <div className="autocomplete-dropdown">
                      {pickupSuggestions.map((suggestion) => (
                        <div
                          key={suggestion.place_id}
                          className="autocomplete-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectPickupSuggestion(suggestion);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          📍 {suggestion.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                  <button 
                    type="button" 
                    className="location-btn"
                    onClick={getCurrentLocation}
                    disabled={gettingLocation}
                  >
                    📍 {gettingLocation ? 'Getting...' : 'Use Current Location'}
                  </button>
                </div>
                <div className="map-container" ref={pickupMapRef} style={{ height: '300px', borderRadius: '8px', marginTop: '12px' }}></div>
                {pickupCoords && (
                  <div className="coords-display">
                    ✓ Location set: {pickupLocation || `${pickupCoords.lat.toFixed(4)}, ${pickupCoords.lng.toFixed(4)}`}
                  </div>
                )}
              </div>

              {bookingType === 'SCHEDULED' && (
                <div className="location-section">
                  <h3>🏥 Dropoff Location</h3>
                  <div className="form-group" style={{ position: 'relative' }}>
                    <label>Search or click on map for destination</label>
                    <input 
                      type="text"
                      value={dropoffLocation}
                      onChange={(e) => handleDropoffInputChange(e.target.value)}
                      onFocus={() => dropoffSuggestions.length > 0 && setShowDropoffSuggestions(true)}
                      placeholder="Type to search for dropoff location..."
                      autoComplete="off"
                    />
                    {showDropoffSuggestions && dropoffSuggestions.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {dropoffSuggestions.map((suggestion) => (
                          <div
                            key={suggestion.place_id}
                            className="autocomplete-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectDropoffSuggestion(suggestion);
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            🏥 {suggestion.display_name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="map-container" ref={dropoffMapRef} style={{ height: '300px', borderRadius: '8px', marginTop: '12px' }}></div>
                  {dropoffCoords && (
                    <div className="coords-display">
                      ✓ Location set: {dropoffLocation || `${dropoffCoords.lat.toFixed(4)}, ${dropoffCoords.lng.toFixed(4)}`}
                    </div>
                  )}
                </div>
              )}

              {bookingType === 'SCHEDULED' ? (
                <>
                  <div className="form-group">
                    <label>📅 Scheduled Date & Time</label>
                    <input 
                      type="datetime-local"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      required
                    />
                  </div>

                  <div className="facilities-section">
                    <h3>🚑 Required Ambulance Facilities</h3>
                    <div className="checkbox-group">
                      <label>
                        <input 
                          type="checkbox"
                          checked={ambulanceFacilities.oxygenSupport}
                          onChange={(e) => setAmbulanceFacilities({...ambulanceFacilities, oxygenSupport: e.target.checked})}
                        />
                        <span>Oxygen Support</span>
                      </label>
                      
                      <label>
                        <input 
                          type="checkbox"
                          checked={ambulanceFacilities.ventilator}
                          onChange={(e) => setAmbulanceFacilities({...ambulanceFacilities, ventilator: e.target.checked})}
                        />
                        <span>Ventilator</span>
                      </label>
                      
                      <label>
                        <input 
                          type="checkbox"
                          checked={ambulanceFacilities.cardiac}
                          onChange={(e) => setAmbulanceFacilities({...ambulanceFacilities, cardiac: e.target.checked})}
                        />
                        <span>Cardiac Monitor / ECG</span>
                      </label>
                      
                      <label>
                        <input 
                          type="checkbox"
                          checked={ambulanceFacilities.icuEquipment}
                          onChange={(e) => setAmbulanceFacilities({...ambulanceFacilities, icuEquipment: e.target.checked})}
                        />
                        <span>ICU Equipment</span>
                      </label>
                      
                      <label>
                        <input 
                          type="checkbox"
                          checked={ambulanceFacilities.wheelchairAccessible}
                          onChange={(e) => setAmbulanceFacilities({...ambulanceFacilities, wheelchairAccessible: e.target.checked})}
                        />
                        <span>Wheelchair Accessible</span>
                      </label>
                      
                      <label>
                        <input 
                          type="checkbox"
                          checked={ambulanceFacilities.advancedLifeSupport}
                          onChange={(e) => setAmbulanceFacilities({...ambulanceFacilities, advancedLifeSupport: e.target.checked})}
                        />
                        <span>Advanced Life Support (ALS)</span>
                      </label>
                    </div>
                  </div>
                </>
              ) : (
                <div className="triage-section">
                  <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#172b4d', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🤖 AI Emergency Triage
                    {triageCompleted && (
                      <span style={{ fontSize: '12px', padding: '3px 10px', background: '#e3fcef', color: '#00875a', borderRadius: '16px', fontWeight: 600 }}>
                        ✓ Complete
                      </span>
                    )}
                  </h3>
                  <TriageChat
                    onComplete={(result: TriageResult) => {
                      setTriageResultData(result);
                      setTriageCompleted(true);
                      const mappedSeverity = result.severity === 'MODERATE' ? 'MEDIUM' : result.severity;
                      const td = {
                        chiefComplaint: result.chiefComplaint,
                        severity: mappedSeverity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
                        isBreathing: result.isBreathing,
                        isConscious: result.isConscious,
                        hasChestPain: result.hasChestPain,
                        hasSevereBleeding: result.hasSevereBleeding,
                      };
                      setTriageData(td);
                    }}
                  />
                </div>
              )}

              <div className="form-actions">
                <button onClick={() => setShowBookingForm(false)} className="cancel-btn">
                  Cancel
                </button>
                <button 
                  onClick={() => handleCreateBooking()} 
                  className="submit-btn"
                  disabled={bookingType === 'EMERGENCY' ? (!triageCompleted) : (!pickupLocation && !pickupCoords) || !dropoffLocation || !scheduledTime}
                >
                  {bookingType === 'EMERGENCY' ? '🚑 Request Emergency Ambulance' : '📅 Schedule Transport'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* SOS Confirmation Modal */}
      {showSOSConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '500px',
            width: '100%',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>🚨</div>
              <h2 style={{ margin: '0 0 12px 0', fontSize: '24px', color: '#172b4d' }}>
                Activate Emergency SOS?
              </h2>
              <p style={{ margin: 0, color: '#666', fontSize: '14px', lineHeight: '1.6' }}>
                This will:<br/>
                • Detect your current location automatically<br/>
                • Request CRITICAL emergency ambulance<br/>
                • Alert emergency services<br/>
                • Notify your emergency contact: {userProfile?.emergencyContact || 'Not set'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowSOSConfirm(false)}
                disabled={sosActivating}
                style={{
                  flex: 1,
                  padding: '14px',
                  fontSize: '16px',
                  fontWeight: '600',
                  background: '#e0e0e0',
                  color: '#333',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: sosActivating ? 'not-allowed' : 'pointer',
                  opacity: sosActivating ? 0.5 : 1
                }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSOSEmergency}
                disabled={sosActivating}
                style={{
                  flex: 1,
                  padding: '14px',
                  fontSize: '16px',
                  fontWeight: '700',
                  background: 'linear-gradient(135deg, #ff1744 0%, #de350b 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: sosActivating ? 'not-allowed' : 'pointer',
                  opacity: sosActivating ? 0.7 : 1
                }}
              >
                {sosActivating ? '⏳ ACTIVATING...' : '🆘 CONFIRM SOS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Tracking Modal */}
      {trackingBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9998,
          padding: '20px'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e0e0e0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, #0066cc 0%, #00a3bf 100%)',
              color: 'white'
            }}>
              <div>
                <h2 style={{ margin: '0 0 4px 0', fontSize: '20px' }}>
                  🚑 Live Tracking - {trackingBooking.bookingType}
                </h2>
                <p style={{ margin: 0, fontSize: '14px', opacity: 0.9 }}>
                  Booking #{trackingBooking.id.slice(0, 8)}
                </p>
              </div>
              <button 
                onClick={() => setTrackingBooking(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  color: 'white',
                  fontSize: '24px',
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ 
              padding: '20px 24px', 
              background: '#f8f9fa',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '12px'
            }}>
              <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Status</div>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#00875a' }}>
                  {getDispatchStatusLabel(trackingMetrics?.dispatchStatus || trackingBooking.status)}
                </div>
              </div>
              <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                  {trackingMetrics?.etaLabel || 'ETA'}
                </div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#ff5722' }}>
                  {liveEta?.etaText || trackingMetrics?.etaText || 'Calculating...'}
                </div>
                {(liveEta?.expectedArrivalIso || trackingMetrics?.expectedTimeText) && (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    Expected by {liveEta?.expectedArrivalIso
                      ? new Date(liveEta.expectedArrivalIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : trackingMetrics?.expectedTimeText}
                  </div>
                )}
                {liveEta?.source === 'google' && (
                  <div style={{ fontSize: '11px', color: '#00875a', marginTop: '4px' }}>
                    Google traffic ETA
                  </div>
                )}
              </div>
              {trackingBooking.dispatch?.ambulance && (
                <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Vehicle</div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#1976d2' }}>
                    {trackingBooking.dispatch.ambulance.vehicleNumber}
                  </div>
                </div>
              )}
              {trackingBooking.dispatch?.hospital && (
                <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Selected Hospital</div>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#5e35b1' }}>
                    {trackingBooking.dispatch.hospital.name}
                  </div>
                </div>
              )}
              {trackingMetrics && (
                <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Ambulance Location</div>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#333' }}>
                    {trackingMetrics.ambulanceLat.toFixed(4)}, {trackingMetrics.ambulanceLng.toFixed(4)}
                  </div>
                </div>
              )}
            </div>

            <div style={{ flex: 1, position: 'relative', minHeight: '400px' }}>
              <LiveRouteMap
                ambulanceLat={trackingMetrics?.ambulanceLat}
                ambulanceLng={trackingMetrics?.ambulanceLng}
                targetLat={trackingMetrics?.targetLat}
                targetLng={trackingMetrics?.targetLng}
                targetLabel={trackingMetrics?.targetLabel}
                title={trackingMetrics?.routeTitle || 'Route'}
                ctaLabel="Open Route"
              />
            </div>

            <div style={{ padding: '16px 24px', background: '#f8f9fa', borderTop: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', background: '#0066cc', borderRadius: '50%' }}></div>
                  <span>Ambulance</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', background: '#de350b', borderRadius: '50%' }}></div>
                  <span>Current Destination</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '20px', height: '2px', background: '#0066cc', borderTop: '2px dashed #0066cc' }}></div>
                  <span>Live Route</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
