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
import MedicalProfileSection from '../components/MedicalProfileSection';
import EmergencyContactsSection from '../components/EmergencyContactsSection';
import TrackingShareCard from '../components/TrackingShareCard';
import { normalizeMedicalProfile, type MedicalProfile } from '@shared/types/medicalProfile';
import CaseChat from '../components/CaseChat';
import { useCaseChats } from '../hooks/useCaseChats';
import { formatIstLongDate, formatIstTime } from '@shared/utils/datetime';
import DriverIdentity, { type DriverInfo } from '../components/DriverIdentity';
import type { TriageResult } from '../services/triageEngine';
import { API_BASE_URL, SOCKET_URL } from '../config/api';
import { Icon, iconSvg } from '@shared/components/ui/Icon';
import { Badge, StatusBadge, statusMeta } from '@shared/components/ui/Status';
import { BrandMark, EmptyState, PageError, PageLoading, initialsOf } from '@shared/components/ui/primitives';
import { Modal } from '@shared/components/ui/Modal';


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

// Map pins for the booking form, drawn in-app (no third-party marker images):
// teal for the pickup, red for the destination — the same pins as the live route map.
const pinIcon = (variant: 'pickup' | 'dropoff') =>
  L.divIcon({
    className: 'ui-marker',
    html: `<span class="ui-marker__pin${variant === 'pickup' ? ' ui-marker__pin--brand' : ''}">${iconSvg(variant === 'pickup' ? 'mapPin' : 'hospital', 16, 2.4)}</span>`,
    iconSize: [32, 40],
    iconAnchor: [16, 38],
    popupAnchor: [0, -34],
  });
const greenIcon = pinIcon('pickup');
const redIcon = pinIcon('dropoff');

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
    driver?: DriverInfo | null;
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
  /** Standing clinical background — the single source of truth for triage,
   *  pre-alerts and reports. Always present; unset fields read "Not Provided". */
  medicalProfile: MedicalProfile;
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

const formatExpectedTime = (etaMinutes: number) =>
  formatIstTime(new Date(Date.now() + etaMinutes * 60000));

// Dispatch, status and ambulance-position changes arrive over the socket as
// they happen. This slow poll only catches anything missed while the
// connection was down.
const FALLBACK_REFRESH_MS = 5 * 60_000;

const NO_PICKUP_MESSAGE =
  'We could not find your location. Set the pickup point on the map or tap "Use Current Location", then tap "Request Emergency Ambulance".';

/** Thrown when there is no real pickup position to send an ambulance to. */
class PickupUnknownError extends Error {}

function Dashboard() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  // Kept alongside the profile so triage can show it without another round-trip,
  // and so a save in the Profile section is reflected immediately.
  const [medicalProfile, setMedicalProfile] = useState<MedicalProfile>(() => normalizeMedicalProfile(null));
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
  const [triageResultData, setTriageResultData] = useState<TriageResult | null>(null);
  const [fastTrackDispatched, setFastTrackDispatched] = useState(false);
  const fastTrackBookingIdRef = useRef<string | null>(null);

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

      pickupMarkerRef.current = L.marker(defaultCenter, { icon: greenIcon, draggable: true, title: 'Pickup point — drag to adjust' })
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

      dropoffMarkerRef.current = L.marker(defaultCenter, { icon: redIcon, draggable: true, title: 'Destination — drag to adjust' })
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

  // Live positions now stream in, and each one produces new metrics. The ETA
  // lookup (Google Distance Matrix when configured, which is billed) keeps its
  // 30-second cadence: it restarts only when the booking or the place the
  // ambulance is heading changes, and reads the latest position from this ref.
  const trackingMetricsRef = useRef(trackingMetrics);
  trackingMetricsRef.current = trackingMetrics;
  const etaKey = trackingBooking && trackingMetrics
    ? `${trackingBooking.id}|${trackingMetrics.targetLat}|${trackingMetrics.targetLng}|${trackingMetrics.etaMinutes === 0}`
    : null;

  useEffect(() => {
    const trackingMetrics = trackingMetricsRef.current;
    if (!etaKey || !trackingMetrics) {
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
      const metrics = trackingMetricsRef.current;
      if (!metrics) return;
      try {
        const response = await axios.get(`${API_BASE_URL}/dashboard/eta`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            originLat: metrics.ambulanceLat,
            originLng: metrics.ambulanceLng,
            destinationLat: metrics.targetLat,
            destinationLng: metrics.targetLng,
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
  }, [etaKey]);

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
      const response = await fetch('https://ipapi.co/json/');
      const data = await response.json();
      
      if (data.latitude && data.longitude) {
        const lat = data.latitude;
        const lng = data.longitude;
        
        setPickupCoords({ lat, lng });
        setPickupLocation(`${data.city || ''}, ${data.region || ''}, ${data.country_name || ''}`);
        
        if (pickupMapInstanceRef.current && pickupMarkerRef.current) {
          pickupMapInstanceRef.current.setView([lat, lng], 14);
          pickupMarkerRef.current.setLatLng([lat, lng]);
        }
        // An address looked up from the network is accurate to the city at best.
        toast('This is only an approximate location. Drag the pin to exactly where the ambulance should come.', { duration: 9000 });
        return true;
      }
    } catch (err) {
      console.error('IP geolocation failed:', err);
    }
    return false;
  };

  const getCurrentLocation = async () => {
    setGettingLocation(true);
    
    // First try browser geolocation
    if (navigator.geolocation) {
      const options = {
        enableHighAccuracy: false, // Use false first for faster response
        timeout: 10000,
        maximumAge: 60000
      };
      
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          
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
          dateOfBirth: data.user.dateOfBirth,
          medicalProfile: normalizeMedicalProfile(data.user.medicalProfile)
        };
        setUserProfile(profile);
        setMedicalProfile(profile.medicalProfile);
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
      let mappedBookings: Booking[] = [];
      if (Array.isArray(data.bookings)) {
        mappedBookings = data.bookings.map((b: any) => ({
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
            } : undefined,
            driver: b.dispatch.driver ? {
              id: b.dispatch.driver.id,
              name: b.dispatch.driver.name,
              photoUrl: b.dispatch.driver.photoUrl ?? null,
              phoneNumber: b.dispatch.driver.phoneNumber ?? null,
              licenseNumber: b.dispatch.driver.licenseNumber ?? null,
              vehicleNumber: b.dispatch.driver.vehicleNumber ?? b.dispatch.ambulance?.vehicleNumber ?? null,
            } : null
          } : undefined
        }));

        setBookings(mappedBookings);

        // Functional update: this runs from timers and socket handlers whose
        // closure still holds the first render's (null) trackingBooking, so the
        // open tracking view never refreshed.
        setTrackingBooking(current =>
          current ? mappedBookings.find((b: Booking) => b.id === current.id) ?? current : current,
        );
      }
      
      setLoading(false);
      setError(null);
      return mappedBookings;
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.response?.data?.message || 'Failed to load dashboard data');
      setLoading(false);
      return [];
    }
  };

  useEffect(() => {
    fetchDashboardData();

    const refreshInterval = setInterval(fetchDashboardData, FALLBACK_REFRESH_MS);

    return () => clearInterval(refreshInterval);
  }, []);

  // The socket handlers read these through refs, so the connection is opened
  // once — it used to be torn down and reopened on every bookings refresh.
  const userIdRef = useRef<string | undefined>(undefined);
  userIdRef.current = userProfile?.id;
  const bookingsRef = useRef<Booking[]>([]);
  bookingsRef.current = bookings;

  useEffect(() => {
    const token = tokenStorage.getToken();
    if (!token) {
      return;
    }

    // Signed-in sockets only. The server puts this account in its own room and
    // sends it events about its own cases — nobody else's.
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: cb => cb({ token: tokenStorage.getToken() }),
    });

    const isRelevant = (payload: any) =>
      payload?.userId === userIdRef.current || bookingsRef.current.some((b) => b.id === payload?.bookingId);

    // Fold bursts of events into one refetch.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = null; fetchDashboardData(); }, 400);
    };

    let connectedBefore = false;
    const onConnect = () => {
      // Catch up on anything that happened while the connection was down.
      if (connectedBefore) scheduleRefresh();
      connectedBefore = true;
    };

    // Moves the ambulance on the map the moment it reports a new position.
    const onAmbulanceLocation = (payload: any) => {
      if (!payload?.bookingId || payload.latitude == null || payload.longitude == null) return;
      const patch = (b: Booking): Booking =>
        b.id === payload.bookingId && b.dispatch
          ? {
              ...b,
              dispatch: {
                ...b.dispatch,
                ambulance: {
                  ...b.dispatch.ambulance,
                  currentLatitude: Number(payload.latitude),
                  currentLongitude: Number(payload.longitude),
                } as NonNullable<Booking['dispatch']>['ambulance'],
              },
            }
          : b;
      setBookings(prev => prev.map(patch));
      setTrackingBooking(prev => (prev ? patch(prev) : prev));
    };

    const onDispatchDiverted = (payload: any) => {
      if (!isRelevant(payload)) return;

      const oldName = payload?.oldHospital?.name || 'previous hospital';
      const newName = payload?.newHospital?.name || 'new hospital';
      toast(`Destination updated: ${oldName} is unavailable. Ambulance diverted to ${newName}.`, { duration: 7000 });
      fetchDashboardData();
    };

    const onRerouteSearchStarted = (payload: any) => {
      if (!isRelevant(payload)) return;
      toast(payload?.message || 'Assigned hospital is currently unable to accept the patient. Searching for the next best hospital.', { duration: 7000 });
    };

    const onRerouteEscalated = (payload: any) => {
      if (!isRelevant(payload)) return;
      toast.error('No suitable hospital is currently available. Manual intervention is required.', { duration: 10000 });
      fetchDashboardData();
    };

    // A message from the operations team, shown however long it takes to read.
    const onAnnouncement = (p: { message: string; tone?: string }) => {
      const show = p?.tone === 'danger' ? toast.error : p?.tone === 'success' ? toast.success : toast;
      show(`Announcement: ${p.message}`, { duration: 12000 });
    };
    socket.on('system_announcement', onAnnouncement);
    socket.on('connect', onConnect);
    // An ambulance was assigned (possibly by the retry worker, after a wait),
    // or the trip moved on a stage.
    socket.on('dispatch_assigned', scheduleRefresh);
    socket.on('dispatch_status_updated', scheduleRefresh);
    socket.on('ambulance_location_updated', onAmbulanceLocation);
    socket.on('hospital_reroute_search_started', onRerouteSearchStarted);
    socket.on('dispatch_diverted', onDispatchDiverted);
    socket.on('hospital_reroute_escalated', onRerouteEscalated);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.disconnect();
    };
  }, []);

  /**
   * Where the ambulance should come: the point already set on the form, else
   * this device's GPS, else the typed address looked up on the map.
   *
   * Returns null when none of those gives a real position. It used to fall
   * back to a fixed point in central Delhi, which sent the ambulance there
   * while telling the caller help was on its way — no dispatch is better than
   * one to the wrong place, because the caller is then asked for the location.
   */
  const resolvePickup = async (): Promise<{ lat: number; lng: number; address: string } | null> => {
    if (pickupCoords) {
      return { ...pickupCoords, address: pickupLocation || `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}` };
    }

    if (navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }),
        );
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPickupCoords({ lat, lng });
        if (!pickupLocation) reverseGeocode(lat, lng, setPickupLocation);
        return { lat, lng, address: pickupLocation || `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
      } catch {
        // Denied, unavailable or timed out — try the typed address next.
      }
    }

    const typed = pickupLocation.trim();
    if (typed.length >= 3) {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(typed)}&countrycodes=in&limit=1`,
          { headers: { 'Accept-Language': 'en' } },
        );
        const [match] = (await response.json()) as PlaceSuggestion[];
        const lat = match ? parseFloat(match.lat) : NaN;
        const lng = match ? parseFloat(match.lon) : NaN;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setPickupCoords({ lat, lng });
          return { lat, lng, address: typed };
        }
      } catch {
        // No network for the lookup — fall through to "unknown".
      }
    }

    return null;
  };

  /**
   * Create an EMERGENCY booking from a triage result. Used to dispatch the
   * moment triage finds a life-threat, and again when triage finishes, so the
   * in-chat "ambulance is on its way" confirmation is accurate.
   */
  const createEmergencyBooking = async (result: TriageResult, severity: string): Promise<Booking | null> => {
    const pickup = await resolvePickup();
    if (!pickup) throw new PickupUnknownError(NO_PICKUP_MESSAGE);

    const token = tokenStorage.getToken();
    const bookingData = {
      pickupLocation: pickup.address,
      pickupAddress: pickup.address,
      pickupLatitude: pickup.lat,
      pickupLongitude: pickup.lng,
      bookingType: 'EMERGENCY',
      severity,
      description: result.chiefComplaint,
      triageData: {
        chiefComplaint: result.chiefComplaint,
        severity,
        isBreathing: result.isBreathing,
        isConscious: result.isConscious,
        hasChestPain: result.hasChestPain,
        hasSevereBleeding: result.hasSevereBleeding,
        emergencyType: result.emergencyType,
        painLevel: result.painLevel,
        isPregnant: result.isPregnant,
      },
    };
    const response = await axios.post(`${API_BASE_URL}/bookings`, bookingData, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (response.data?.booking || response.data) as Booking;
  };

  // ── Fast-track: dispatch immediately when triage detects a CRITICAL life-threat ──
  // A ref as well as state: triage can finish while this request is still in
  // flight, and must not send a second ambulance.
  const dispatchInFlightRef = useRef(false);
  const handleFastTrack = async (result: TriageResult) => {
    if (fastTrackDispatched || dispatchInFlightRef.current || fastTrackBookingIdRef.current) return;
    dispatchInFlightRef.current = true;
    try {
      const booking = await createEmergencyBooking(result, 'CRITICAL');
      fastTrackBookingIdRef.current = booking?.id ?? null;
      setFastTrackDispatched(true);
      toast.success('🚨 CRITICAL detected — ambulance dispatch initiated!', { duration: 6000 });
      await fetchDashboardData();
    } catch (err: any) {
      // Left undispatched, so finishing triage (or the button) tries again.
      setFastTrackDispatched(false);
      console.error('Fast-track dispatch failed:', err);
      toast.error(
        err instanceof PickupUnknownError
          ? NO_PICKUP_MESSAGE
          : 'Auto-dispatch failed — tap "Request Emergency Ambulance" to retry.',
        { duration: 10000 },
      );
    } finally {
      dispatchInFlightRef.current = false;
    }
  };

  /** "Track ambulance" from the chat success screen → open live tracking. */
  const handleTrackFromChat = async () => {
    const fresh = await fetchDashboardData();
    const id = fastTrackBookingIdRef.current;
    const booking = (id ? fresh.find((b) => b.id === id) : null) ?? fresh[0] ?? null;
    setShowBookingForm(false);
    setFastTrackDispatched(false);
    setTriageCompleted(false);
    setTriageResultData(null);
    fastTrackBookingIdRef.current = null;
    if (booking) startTracking(booking);
    else { setActiveTab('bookings'); toast.success('Track your ambulance in "My Bookings".'); }
  };

  const handleCreateBooking = async (triageOverride?: { chiefComplaint: string; severity: string; isBreathing: boolean; isConscious: boolean; hasChestPain: boolean; hasSevereBleeding: boolean }) => {
    // Already dispatched via fast-track — don't create a duplicate; just close & reset.
    if (fastTrackDispatched) {
      setShowBookingForm(false);
      setFastTrackDispatched(false);
      setTriageCompleted(false);
      setTriageResultData(null);
      fastTrackBookingIdRef.current = null;
      toast.success('Ambulance already dispatched. Track it in "My Bookings".');
      await fetchDashboardData();
      return;
    }
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

      // A real position, never a guess: see resolvePickup.
      const pickup = await resolvePickup();
      if (!pickup) {
        toast.error(
          bookingType === 'SCHEDULED'
            ? 'We could not find that pickup address. Choose it from the suggestions or click the map.'
            : NO_PICKUP_MESSAGE,
          { duration: 9000 },
        );
        return;
      }

      const token = tokenStorage.getToken();
      const bookingData: any = {
        pickupLocation: pickup.address,
        pickupAddress: pickup.address,
        pickupLatitude: pickup.lat,
        pickupLongitude: pickup.lng,
        bookingType,
      };

      if (bookingType === 'SCHEDULED') {
        bookingData.dropoffLocation = dropoffLocation;
        bookingData.destinationAddress = dropoffLocation;
        bookingData.destinationLatitude = dropoffCoords?.lat;
        bookingData.destinationLongitude = dropoffCoords?.lng;
        // The picker gives local wall-clock time with no zone; send an exact instant.
        bookingData.scheduledTime = new Date(scheduledTime).toISOString();
        bookingData.ambulanceFacilities = ambulanceFacilities;
      } else {
        const td = triageOverride || triageData;
        // The hospital's alert and hospital matching need the kind of emergency, not just its severity.
        bookingData.triageData = triageResultData
          ? { ...td, emergencyType: triageResultData.emergencyType, painLevel: triageResultData.painLevel, isPregnant: triageResultData.isPregnant }
          : td;
        bookingData.severity = td.severity;
        bookingData.description = td.chiefComplaint;
      }

      await axios.post(
        `${API_BASE_URL}/bookings`,
        bookingData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

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

      const fresh = await fetchDashboardData();
      setShowSOSConfirm(false);
      toast.success('🚨 SOS activated! Ambulance requested — stay calm, help is on the way!', { duration: 6000 });

      // Open tracking on the booking as the dashboard knows it (with its
      // ambulance, hospital and numeric coordinates) — the raw API row has none
      // of those and left the tracking view half empty.
      const newId = response.data?.id || response.data?.booking?.id;
      const newBooking = fresh.find(b => b.id === newId);
      if (newBooking) setTrackingBooking(newBooking);

    } catch (err) {
      console.error('SOS Emergency failed:', err);
      toast.error('Failed to activate SOS. Please try again or call emergency services directly.');
    } finally {
      setSosActivating(false);
    }
  };

  /**
   * Chat rooms for every dispatched booking. Held at dashboard level so messages keep
   * arriving — and the sidebar badge keeps counting — while the user is on another tab.
   */
  const chatRooms = useMemo(
    () => bookings
      .filter(b => b.dispatch && ACTIVE_STATUSES.includes(b.status))
      .map(b => ({ bookingId: b.id })),
    [bookings],
  );
  const chat = useCaseChats({
    rooms: chatRooms,
    role: 'patient',
    senderName: userProfile?.name || 'Patient',
    apiBaseUrl: API_BASE_URL,
    getToken: () => tokenStorage.getToken(),
  });

  // Start tracking a booking
  const startTracking = (booking: Booking) => {
    setTrackingBooking(booking);
    setActiveTab('bookings');
  };

  // ── Triage finished ──
  const handleTriageComplete = async (result: TriageResult) => {
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

    // Ensure an ambulance is dispatched the moment triage finishes. CRITICAL
    // cases were already auto-dispatched mid-assessment (fast-track); for every
    // other case, dispatch now so the chat's "ambulance is on its way"
    // confirmation + Track button are accurate. The booking form stays open
    // showing that success screen until the user taps Track.
    if (!fastTrackDispatched && !fastTrackBookingIdRef.current && !dispatchInFlightRef.current) {
      dispatchInFlightRef.current = true;
      try {
        const booking = await createEmergencyBooking(result, mappedSeverity);
        fastTrackBookingIdRef.current = booking?.id ?? null;
        setFastTrackDispatched(true);
        await fetchDashboardData();
      } catch (err) {
        console.error('Auto-dispatch on triage complete failed:', err);
        toast.error(
          err instanceof PickupUnknownError
            ? NO_PICKUP_MESSAGE
            : 'Could not dispatch automatically — tap "Request Emergency Ambulance".',
          { duration: 10000 },
        );
      } finally {
        dispatchInFlightRef.current = false;
      }
    } else {
      await fetchDashboardData();
    }
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
        }} className="ui-btn ui-btn--danger ui-btn--sm">
          Yes, cancel
        </button>
        <button onClick={() => toast.dismiss(t.id)} className="ui-btn ui-btn--secondary ui-btn--sm">
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


  const getDispatchStatusLabel = (status: string) => {
    switch (status) {
      case 'DISPATCHED':
      case 'ASSIGNED': return 'Ambulance assigned';
      case 'EN_ROUTE':
      case 'EN_ROUTE_PICKUP': return 'En route to you';
      case 'AT_PICKUP': return 'Arrived — waiting';
      case 'EN_ROUTE_HOSPITAL': return 'Going to hospital';
      case 'AT_HOSPITAL': return 'At hospital';
      case 'COMPLETED': return 'Completed';
      default: return statusMeta(status).label;
    }
  };

  if (loading) {
    return <PageLoading label="Loading your dashboard…" />;
  }

  if (error) {
    return <PageError message={error} onRetry={fetchDashboardData} />;
  }

  const activeBookings = bookings.filter(b => ACTIVE_STATUSES.includes(b.status));
  const historyBookings = bookings.filter(b => !ACTIVE_STATUSES.includes(b.status));

  const TITLES: Record<TabType, { title: string; subtitle: string }> = {
    bookings: { title: 'My Bookings', subtitle: 'Book ambulance services and track your requests' },
    profile: { title: 'My Profile', subtitle: 'Manage your personal information' },
    locations: { title: 'Saved Locations', subtitle: 'Manage your frequently used locations' },
  };

  const selectTab = (tab: TabType) => {
    setActiveTab(tab);
    setShowBookingForm(false);
    setSidebarOpen(false);
  };

  const NAV: { id: TabType; label: string; icon: 'ambulance' | 'user' | 'mapPin' }[] = [
    { id: 'bookings', label: 'My Bookings', icon: 'ambulance' },
    { id: 'profile', label: 'Profile', icon: 'user' },
    { id: 'locations', label: 'Saved Locations', icon: 'mapPin' },
  ];

  const trackingStatus = trackingMetrics?.dispatchStatus || trackingBooking?.status || '';
  const isEmergencyForm = bookingType === 'EMERGENCY';

  return (
    <div className="ui-app">
      <a href="#main" className="ui-skip-link">Skip to content</a>
      <div className={`ui-scrim${sidebarOpen ? ' is-visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      <aside className={`ui-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Patient navigation">
        <div className="ui-sidebar__brand">
          <BrandMark />
          <div className="ui-sidebar__brand-text">
            <div className="ui-sidebar__product">ECS</div>
            <div className="ui-sidebar__portal">Patient portal</div>
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>

        <nav className="ui-nav" aria-label="Sections">
          {NAV.map(item => (
            <button
              key={item.id}
              type="button"
              className={`ui-nav__item${activeTab === item.id ? ' is-active' : ''}`}
              aria-current={activeTab === item.id ? 'page' : undefined}
              onClick={() => selectTab(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.id === 'bookings' && chat.totalUnread > 0 && (
                <span className="ui-nav__badge" aria-label={`${chat.totalUnread} unread messages`}>{chat.totalUnread}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="ui-sidebar__footer">
          {userProfile && (
            <div className="ui-user">
              <span className="ui-avatar">{initialsOf(userProfile.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ui-user__name ui-truncate">{userProfile.name}</div>
                <div className="ui-user__meta ui-truncate">{userProfile.phoneNumber}</div>
              </div>
            </div>
          )}
          <button type="button" onClick={handleLogout} className="ui-btn ui-btn--ghost ui-btn--block usr-signout">
            <Icon name="logOut" />
            Logout
          </button>
        </div>
      </aside>

      <div className="ui-main">
        <header className="ui-topbar">
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--icon ui-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="ui-topbar__titles">
            <h1 className="ui-topbar__title">{TITLES[activeTab].title}</h1>
            <div className="ui-topbar__subtitle">{TITLES[activeTab].subtitle}</div>
          </div>
          {userProfile && (
            <div className="ui-topbar__actions">
              {medicalProfile.bloodGroup && (
                <Badge tone="danger" icon="droplet" title="Blood group">Blood {medicalProfile.bloodGroup}</Badge>
              )}
              <span className="usr-topbar-user ui-hide-sm">
                <span className="ui-avatar">{initialsOf(userProfile.name)}</span>
                <span className="ui-user__name">{userProfile.name}</span>
              </span>
            </div>
          )}
        </header>

        <main id="main" className="ui-content" key={activeTab}>
          {activeTab === 'profile' ? (
            <div className="ui-stack usr-profile">
              <section className="ui-card usr-profile__hero ui-enter">
                <span className="ui-avatar ui-avatar--xl usr-profile__avatar">{initialsOf(userProfile?.name)}</span>
                <div className="usr-profile__identity">
                  <h2 className="usr-profile__name">{userProfile?.name || 'User Profile'}</h2>
                  <div className="usr-profile__contact">
                    <span><Icon name="mail" size={15} />{userProfile?.email || 'No email'}</span>
                    <span><Icon name="phone" size={15} />{userProfile?.phoneNumber || 'No phone number'}</span>
                  </div>
                </div>
                {!editingProfile && (
                  <button type="button" onClick={() => setEditingProfile(true)} className="ui-btn ui-btn--secondary">
                    <Icon name="pencil" size={15} />
                    Edit Profile
                  </button>
                )}
              </section>

              {!editingProfile ? (
                <>
                  <section className="ui-card ui-enter" style={{ ['--i' as string]: 1 }} aria-labelledby="personal-h">
                    <div className="ui-card__header">
                      <h3 id="personal-h" className="ui-card__title"><Icon name="idCard" size={17} />Personal information</h3>
                    </div>
                    <div className="ui-card__body">
                      <dl className="ui-dl">
                        <div className="ui-dl__item"><dt>Full name</dt><dd className={userProfile?.name ? undefined : 'is-empty'}>{userProfile?.name || 'Not set'}</dd></div>
                        <div className="ui-dl__item"><dt>Phone number</dt><dd className={userProfile?.phoneNumber ? undefined : 'is-empty'}>{userProfile?.phoneNumber || 'Not set'}</dd></div>
                        <div className="ui-dl__item">
                          <dt>Date of birth</dt>
                          <dd className={userProfile?.dateOfBirth ? undefined : 'is-empty'}>{userProfile?.dateOfBirth ? formatIstLongDate(userProfile.dateOfBirth) : 'Not set'}</dd>
                        </div>
                        <div className="ui-dl__item ui-dl__item--wide"><dt>Address</dt><dd className={userProfile?.address ? undefined : 'is-empty'}>{userProfile?.address || 'Not set'}</dd></div>
                      </dl>
                    </div>
                  </section>

                  <section className="ui-card ui-enter" style={{ ['--i' as string]: 2 }} aria-labelledby="emergency-h">
                    <div className="ui-card__header">
                      <h3 id="emergency-h" className="ui-card__title"><Icon name="siren" size={17} />Emergency information</h3>
                    </div>
                    <div className="ui-card__body">
                      <dl className="ui-dl">
                        <div className={`ui-dl__item${userProfile?.emergencyContact ? '' : ' usr-missing'}`}>
                          <dt>Emergency contact</dt>
                          <dd>
                            {userProfile?.emergencyContact || (
                              <span className="usr-missing__text"><Icon name="alertTriangle" size={15} />Not set — please add</span>
                            )}
                          </dd>
                        </div>
                        <div className="ui-dl__item">
                          <dt>Blood group</dt>
                          <dd className={medicalProfile.bloodGroup ? undefined : 'is-empty'}>{medicalProfile.display.bloodGroup}</dd>
                        </div>
                        {/* Medical History — free-text notes. The structured
                            Medical Profile lives in its own editable section below. */}
                        <div className="ui-dl__item ui-dl__item--wide">
                          <dt>Medical history</dt>
                          <dd className={userProfile?.medicalHistory ? undefined : 'is-empty'} style={{ fontWeight: userProfile?.medicalHistory ? 500 : undefined, lineHeight: 1.6 }}>
                            {userProfile?.medicalHistory || 'No medical history recorded'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </section>
                </>
              ) : (
                <section className="ui-card ui-enter" aria-labelledby="edit-h">
                  <div className="ui-card__header">
                    <h3 id="edit-h" className="ui-card__title"><Icon name="pencil" size={16} />Edit profile</h3>
                  </div>
                  <div className="ui-card__body ui-stack">
                    <div className="ui-alert tone-info">
                      <Icon name="info" size={17} />
                      <div>
                        <div className="ui-alert__title">Complete your profile</div>
                        Adding medical information and emergency contacts helps responders provide better care during emergencies.
                      </div>
                    </div>

                    <fieldset className="usr-fieldset">
                      <legend className="ui-eyebrow">Personal information</legend>
                      <div className="ui-form-grid">
                        <div className="ui-field">
                          <label className="ui-label" htmlFor="pf-first">First name <span className="ui-label__required" aria-hidden="true">*</span></label>
                          <input id="pf-first" className="ui-input" type="text" value={profileForm.firstName}
                            onChange={(e) => setProfileForm({...profileForm, firstName: e.target.value})} placeholder="Enter first name" required />
                        </div>
                        <div className="ui-field">
                          <label className="ui-label" htmlFor="pf-last">Last name <span className="ui-label__required" aria-hidden="true">*</span></label>
                          <input id="pf-last" className="ui-input" type="text" value={profileForm.lastName}
                            onChange={(e) => setProfileForm({...profileForm, lastName: e.target.value})} placeholder="Enter last name" required />
                        </div>
                        <div className="ui-field">
                          <label className="ui-label" htmlFor="pf-phone">Phone number <span className="ui-label__required" aria-hidden="true">*</span></label>
                          <input id="pf-phone" className="ui-input" type="tel" value={profileForm.phoneNumber}
                            onChange={(e) => setProfileForm({...profileForm, phoneNumber: e.target.value})} placeholder="+91 98765 43210" required />
                        </div>
                        <div className="ui-field">
                          <label className="ui-label" htmlFor="pf-dob">Date of birth</label>
                          <input id="pf-dob" className="ui-input" type="date" value={profileForm.dateOfBirth}
                            onChange={(e) => setProfileForm({...profileForm, dateOfBirth: e.target.value})} />
                        </div>
                        <div className="ui-field is-wide">
                          <label className="ui-label" htmlFor="pf-address">Address</label>
                          <input id="pf-address" className="ui-input" type="text" value={profileForm.address}
                            onChange={(e) => setProfileForm({...profileForm, address: e.target.value})} placeholder="House, street, city, PIN" />
                        </div>
                      </div>
                    </fieldset>

                    <fieldset className="usr-fieldset">
                      <legend className="ui-eyebrow">Emergency information</legend>
                      <div className="ui-form-grid">
                        <div className="ui-field">
                          <label className="ui-label" htmlFor="pf-ec">Emergency contact <span className="ui-label__required" aria-hidden="true">*</span></label>
                          <input id="pf-ec" className="ui-input" type="tel" value={profileForm.emergencyContact}
                            onChange={(e) => setProfileForm({...profileForm, emergencyContact: e.target.value})}
                            placeholder="Emergency contact phone number" aria-describedby="pf-ec-help" />
                          <div id="pf-ec-help" className="ui-help">This person will be notified during emergencies</div>
                        </div>
                      </div>
                    </fieldset>
                  </div>
                  <div className="ui-card__footer usr-form-actions">
                    <button type="button" onClick={() => setEditingProfile(false)} className="ui-btn ui-btn--secondary">Cancel</button>
                    <button type="button" onClick={handleUpdateProfile} className="ui-btn ui-btn--success">
                      <Icon name="save" size={16} />
                      Save changes
                    </button>
                  </div>
                </section>
              )}

              {/* Medical Profile — add, update or remove at any time. Saving here
                  updates the patient's profile record, so future triage sessions,
                  hospital pre-alerts and reports pick up the new values. */}
              <MedicalProfileSection
                apiBaseUrl={API_BASE_URL}
                token={tokenStorage.getToken() || ''}
                initialProfile={medicalProfile}
                onSaved={(saved) => {
                  setMedicalProfile(saved);
                  setUserProfile(prev => (prev ? { ...prev, medicalProfile: saved, bloodType: saved.bloodGroup ?? undefined } : prev));
                }}
              />

              {/* Emergency Contacts — the people automatically texted a live
                  tracking link the moment an ambulance is assigned. */}
              <EmergencyContactsSection
                apiBaseUrl={API_BASE_URL}
                token={tokenStorage.getToken() || ''}
              />

              {/* Notification Preferences Section */}
              <NotificationPreferencesSection token={tokenStorage.getToken() || ''} />
            </div>
          ) : activeTab === 'locations' ? (
            <SavedLocationsTab token={tokenStorage.getToken() || ''} />
          ) : !showBookingForm ? (
            <div className="ui-stack usr-home">
              {/* Emergency SOS */}
              <section className="usr-sos ui-enter" aria-labelledby="sos-title">
                <div className="usr-sos__icon" aria-hidden="true">
                  <Icon name="siren" size={28} />
                </div>
                <div className="usr-sos__text">
                  <h2 id="sos-title" className="usr-sos__title">Emergency SOS</h2>
                  <p className="usr-sos__desc">One-tap emergency assistance for a life-threatening situation.</p>
                  <ul className="usr-sos__points">
                    <li><Icon name="locate" size={15} />Auto-location</li>
                    <li><Icon name="zap" size={15} />Immediate dispatch</li>
                    <li><Icon name="alertOctagon" size={15} />Critical priority</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSOSConfirm(true)}
                  disabled={sosActivating}
                  className="ui-btn ui-btn--emergency ui-btn--xl usr-sos__btn"
                >
                  {sosActivating ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="siren" size={20} />}
                  {sosActivating ? 'Activating…' : 'Activate SOS'}
                </button>
              </section>

              {/* Request options */}
              <div className="usr-actions">
                <button type="button" className="usr-action tone-danger ui-enter" style={{ ['--i' as string]: 1 }}
                  onClick={() => { setBookingType('EMERGENCY'); setShowBookingForm(true); }}>
                  <span className="ui-icon-tile"><Icon name="ambulance" size={22} /></span>
                  <span className="usr-action__text">
                    <span className="usr-action__title">Request Emergency Ambulance</span>
                    <span className="usr-action__desc">Answer a few triage questions and we dispatch the right ambulance.</span>
                  </span>
                  <Icon name="chevronRight" size={18} className="usr-action__chevron" />
                </button>
                <button type="button" className="usr-action tone-info ui-enter" style={{ ['--i' as string]: 2 }}
                  onClick={() => { setBookingType('SCHEDULED'); setShowBookingForm(true); }}>
                  <span className="ui-icon-tile"><Icon name="calendarClock" size={22} /></span>
                  <span className="usr-action__text">
                    <span className="usr-action__title">Schedule Transport</span>
                    <span className="usr-action__desc">Book a non-emergency transfer for a later date and time.</span>
                  </span>
                  <Icon name="chevronRight" size={18} className="usr-action__chevron" />
                </button>
              </div>

              {/* Bookings */}
              <section className="usr-bookings ui-enter" style={{ ['--i' as string]: 3 }} aria-labelledby="bookings-h">
                <div className="usr-bookings__head">
                  <h2 id="bookings-h" className="ui-section-title">Your bookings</h2>
                  <BookingTabs
                    tabs={[
                      { id: 'current', label: 'Current Bookings', count: activeBookings.length },
                      { id: 'history', label: 'Booking History', count: historyBookings.length },
                    ]}
                    activeTab={bookingSubTab}
                    onChange={id => setBookingSubTab(id as 'current' | 'history')}
                  />
                </div>

                {bookingSubTab === 'current' ? (
                  activeBookings.length > 0 ? (
                    <div className="usr-booking-grid">
                      {activeBookings.map((booking, i) => (
                        <div key={booking.id} className="usr-booking-stack ui-enter" style={{ ['--i' as string]: i }}>
                          <BookingCard
                            booking={booking}
                            onTrack={booking.dispatch ? () => startTracking(booking) : undefined}
                            onCancel={() => handleCancelBooking(booking.id)}
                          />
                          {booking.dispatch && (
                            <CaseChat
                              bookingId={booking.id}
                              currentRole="patient"
                              title="Chat with Driver"
                              active={activeTab === 'bookings' && bookingSubTab === 'current' && !showBookingForm}
                              connected={chat.connected}
                              thread={chat.threads[booking.id]}
                              onSend={text => chat.send(booking.id, text)}
                              onSendImage={file => { void chat.sendImage(booking.id, file); }}
                              onRetry={clientId => chat.retry(booking.id, clientId)}
                              apiBaseUrl={API_BASE_URL}
                              onVisibilityChange={visible => chat.setRoomVisible(booking.id, visible)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="ambulance" title="No Active Bookings" dashed>
                      You have no active or upcoming bookings. Use the options above to request emergency assistance or schedule a transport.
                    </EmptyState>
                  )
                ) : (
                  /* Booking History Tab */
                  historyBookings.length > 0 ? (
                    <div className="usr-booking-grid">
                      {historyBookings.map((booking, i) => (
                        <div key={booking.id} className="ui-enter" style={{ ['--i' as string]: Math.min(i, 8) }}>
                          <BookingCard booking={booking} showActions={false} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="history" title="No Booking History" dashed>
                      Your completed and cancelled bookings will appear here.
                    </EmptyState>
                  )
                )}
              </section>
            </div>
          ) : (
            <section className={`ui-card usr-form ui-enter ${isEmergencyForm ? 'tone-danger' : 'tone-info'}`} aria-labelledby="form-title">
              <header className="usr-form__header">
                <span className="ui-icon-tile"><Icon name={isEmergencyForm ? 'siren' : 'calendarClock'} size={22} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2 id="form-title" className="usr-form__title">{isEmergencyForm ? 'Emergency Ambulance Request' : 'Schedule Transport'}</h2>
                  <p className="usr-form__subtitle">
                    {isEmergencyForm
                      ? 'Confirm the pickup point and answer the triage questions — dispatch starts as soon as triage finishes.'
                      : 'Choose pickup, destination and time, plus any equipment the ambulance needs.'}
                  </p>
                </div>
                <button type="button" onClick={() => setShowBookingForm(false)} className="ui-btn ui-btn--ghost ui-btn--icon" aria-label="Close form">
                  <Icon name="x" />
                </button>
              </header>

              <div className="usr-form__body">
                <div className="usr-location">
                  <h3 className="usr-location__title"><span className="usr-location__pin tone-danger"><Icon name="mapPin" size={15} /></span>Pickup location</h3>
                  <div className="ui-field">
                    <label className="ui-label" htmlFor="pickup-search">Search or click on map</label>
                    <div className="usr-location__row">
                      <div className="ui-input-wrap usr-location__search">
                        <Icon name="search" size={16} />
                        <input
                          id="pickup-search"
                          className="ui-input"
                          type="text"
                          value={pickupLocation}
                          onChange={(e) => handlePickupInputChange(e.target.value)}
                          onFocus={() => pickupSuggestions.length > 0 && setShowPickupSuggestions(true)}
                          placeholder="Type to search for pickup location…"
                          autoComplete="off"
                        />
                        {showPickupSuggestions && pickupSuggestions.length > 0 && (
                          <div className="ui-menu" role="listbox" aria-label="Pickup suggestions">
                            {pickupSuggestions.map((suggestion) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={false}
                                key={suggestion.place_id}
                                className="ui-menu__item"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  selectPickupSuggestion(suggestion);
                                }}
                                onClick={() => selectPickupSuggestion(suggestion)}
                              >
                                <Icon name="mapPin" size={15} />
                                {suggestion.display_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ui-btn ui-btn--soft"
                        onClick={getCurrentLocation}
                        disabled={gettingLocation}
                      >
                        {gettingLocation ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="locate" size={16} />}
                        {gettingLocation ? 'Getting…' : 'Use Current Location'}
                      </button>
                    </div>
                  </div>
                  <div className="ui-map usr-location__map" ref={pickupMapRef} role="region" aria-label="Pickup map — click to set the pickup point"></div>
                  {pickupCoords && (
                    <div className="ui-alert tone-success usr-location__set" role="status">
                      <Icon name="checkCircle" size={16} />
                      <div><strong>Location set:</strong> {pickupLocation || `${pickupCoords.lat.toFixed(4)}, ${pickupCoords.lng.toFixed(4)}`}</div>
                    </div>
                  )}
                </div>

                {bookingType === 'SCHEDULED' && (
                  <div className="usr-location">
                    <h3 className="usr-location__title"><span className="usr-location__pin tone-info"><Icon name="hospital" size={15} /></span>Dropoff location</h3>
                    <div className="ui-field">
                      <label className="ui-label" htmlFor="dropoff-search">Search or click on map for destination</label>
                      <div className="ui-input-wrap">
                        <Icon name="search" size={16} />
                        <input
                          id="dropoff-search"
                          className="ui-input"
                          type="text"
                          value={dropoffLocation}
                          onChange={(e) => handleDropoffInputChange(e.target.value)}
                          onFocus={() => dropoffSuggestions.length > 0 && setShowDropoffSuggestions(true)}
                          placeholder="Type to search for dropoff location…"
                          autoComplete="off"
                        />
                        {showDropoffSuggestions && dropoffSuggestions.length > 0 && (
                          <div className="ui-menu" role="listbox" aria-label="Dropoff suggestions">
                            {dropoffSuggestions.map((suggestion) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={false}
                                key={suggestion.place_id}
                                className="ui-menu__item"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  selectDropoffSuggestion(suggestion);
                                }}
                                onClick={() => selectDropoffSuggestion(suggestion)}
                              >
                                <Icon name="hospital" size={15} />
                                {suggestion.display_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="ui-map usr-location__map" ref={dropoffMapRef} role="region" aria-label="Dropoff map — click to set the destination"></div>
                    {dropoffCoords && (
                      <div className="ui-alert tone-success usr-location__set" role="status">
                        <Icon name="checkCircle" size={16} />
                        <div><strong>Location set:</strong> {dropoffLocation || `${dropoffCoords.lat.toFixed(4)}, ${dropoffCoords.lng.toFixed(4)}`}</div>
                      </div>
                    )}
                  </div>
                )}

                {bookingType === 'SCHEDULED' ? (
                  <>
                    <div className="ui-field usr-schedule">
                      <label className="ui-label" htmlFor="scheduled-time"><Icon name="calendarClock" size={15} />Scheduled date &amp; time</label>
                      <input
                        id="scheduled-time"
                        className="ui-input ui-input--lg"
                        type="datetime-local"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        // Local time, like the picker's own value — toISOString() is UTC and allowed past times.
                        min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
                        required
                      />
                    </div>

                    <fieldset className="usr-facilities">
                      <legend className="usr-location__title"><span className="usr-location__pin tone-brand"><Icon name="medKit" size={15} /></span>Required ambulance facilities</legend>
                      <div className="usr-facilities__grid">
                        {([
                          ['oxygenSupport', 'Oxygen Support', 'wind'],
                          ['ventilator', 'Ventilator', 'activity'],
                          ['cardiac', 'Cardiac Monitor / ECG', 'heartPulse'],
                          ['icuEquipment', 'ICU Equipment', 'bedDouble'],
                          ['wheelchairAccessible', 'Wheelchair Accessible', 'user'],
                          ['advancedLifeSupport', 'Advanced Life Support (ALS)', 'shieldPlus'],
                        ] as const).map(([key, label, icon]) => (
                          <label key={key} className="ui-check">
                            <input
                              type="checkbox"
                              checked={ambulanceFacilities[key]}
                              onChange={(e) => setAmbulanceFacilities({...ambulanceFacilities, [key]: e.target.checked})}
                            />
                            <Icon name={icon} size={16} className="usr-facilities__icon" />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                ) : (
                  <TriageChat
                    patientName={userProfile?.name}
                    medicalProfile={medicalProfile}
                    ambulanceDispatched={fastTrackDispatched}
                    onFastTrack={handleFastTrack}
                    onComplete={handleTriageComplete}
                    onTrack={handleTrackFromChat}
                    onLocation={(loc) => {
                      setPickupCoords({ lat: loc.lat, lng: loc.lng });
                      setPickupLocation((prev) => prev || `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
                      reverseGeocode(loc.lat, loc.lng, setPickupLocation);
                    }}
                  />
                )}
              </div>

              <footer className="usr-form__footer">
                <button
                  type="button"
                  onClick={() => { setShowBookingForm(false); setFastTrackDispatched(false); fastTrackBookingIdRef.current = null; }}
                  className="ui-btn ui-btn--secondary ui-btn--lg"
                >
                  {fastTrackDispatched ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateBooking()}
                  className={`ui-btn ui-btn--lg ${fastTrackDispatched ? 'ui-btn--success' : isEmergencyForm ? 'ui-btn--emergency' : 'ui-btn--primary'}`}
                  disabled={bookingType === 'EMERGENCY' ? (!triageCompleted && !fastTrackDispatched) : (!pickupLocation && !pickupCoords) || !dropoffLocation || !scheduledTime}
                >
                  <Icon name={fastTrackDispatched ? 'checkCircle' : isEmergencyForm ? 'ambulance' : 'calendarClock'} size={18} />
                  {bookingType === 'EMERGENCY'
                    ? (fastTrackDispatched ? 'Ambulance Dispatched — Done' : 'Request Emergency Ambulance')
                    : 'Schedule Transport'}
                </button>
              </footer>
            </section>
          )}
        </main>
      </div>

      {/* SOS Confirmation Modal */}
      {showSOSConfirm && (
        <Modal
          onClose={sosActivating ? undefined : () => setShowSOSConfirm(false)}
          closeOnBackdrop={!sosActivating}
          labelledBy="sos-confirm-title"
          describedBy="sos-confirm-desc"
          role="alertdialog"
        >
          <div className="ui-modal__body usr-sos-modal">
            <div className="usr-sos-modal__icon" aria-hidden="true"><Icon name="siren" size={30} /></div>
            <h2 id="sos-confirm-title" className="usr-sos-modal__title">Activate Emergency SOS?</h2>
            <p id="sos-confirm-desc" className="usr-sos-modal__lead">This will:</p>
            <ul className="usr-sos-modal__list">
              <li><Icon name="locate" size={16} />Detect your current location automatically</li>
              <li><Icon name="siren" size={16} />Request a CRITICAL emergency ambulance</li>
              <li><Icon name="radio" size={16} />Alert emergency services</li>
              <li><Icon name="users" size={16} />Notify your emergency contact: <strong>{userProfile?.emergencyContact || 'Not set'}</strong></li>
            </ul>
          </div>
          <div className="ui-modal__footer">
            <button type="button" onClick={() => setShowSOSConfirm(false)} disabled={sosActivating} className="ui-btn ui-btn--secondary ui-btn--lg" data-autofocus>
              Cancel
            </button>
            <button type="button" onClick={handleSOSEmergency} disabled={sosActivating} className="ui-btn ui-btn--emergency ui-btn--lg">
              {sosActivating ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="siren" size={18} />}
              {sosActivating ? 'Activating…' : 'Confirm SOS'}
            </button>
          </div>
        </Modal>
      )}

      {/* Real-time Tracking Modal */}
      {trackingBooking && (
        <Modal onClose={() => setTrackingBooking(null)} labelledBy="track-title" size="lg" align="top" className="ui-modal--auto-height usr-track">
          <div className="ui-modal__header">
            <span className="ui-icon-tile"><Icon name="ambulance" size={22} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 id="track-title" className="ui-modal__title">Live Tracking</h2>
              <p className="ui-modal__subtitle">
                Booking #{String(trackingBooking.id ?? '').slice(0, 8)} · {trackingBooking.bookingType === 'SCHEDULED' ? 'Scheduled' : 'Emergency'}
              </p>
            </div>
            <button type="button" onClick={() => setTrackingBooking(null)} className="ui-btn ui-btn--ghost ui-btn--icon ui-modal__close" aria-label="Close tracking">
              <Icon name="x" />
            </button>
          </div>

          <div className="ui-modal__body usr-track__body">
            <div className="usr-track__metrics">
              <div className="usr-track__metric">
                <div className="usr-track__label">Status</div>
                <StatusBadge status={trackingStatus} label={getDispatchStatusLabel(trackingStatus)} large />
              </div>
              <div className="usr-track__metric usr-track__metric--eta">
                <div className="usr-track__label">{trackingMetrics?.etaLabel || 'ETA'}</div>
                <div className="usr-track__eta">{liveEta?.etaText || trackingMetrics?.etaText || 'Calculating...'}</div>
                {(liveEta?.expectedArrivalIso || trackingMetrics?.expectedTimeText) && (
                  <div className="usr-track__sub">
                    Expected by {liveEta?.expectedArrivalIso
                      ? formatIstTime(liveEta.expectedArrivalIso)
                      : trackingMetrics?.expectedTimeText}
                  </div>
                )}
                {liveEta?.source === 'google' && (
                  <Badge tone="success" icon="activity">Google traffic ETA</Badge>
                )}
              </div>
              {trackingBooking.dispatch?.hospital && (
                <div className="usr-track__metric">
                  <div className="usr-track__label">Selected hospital</div>
                  <div className="usr-track__value"><Icon name="hospital" size={16} />{trackingBooking.dispatch.hospital.name}</div>
                </div>
              )}
              {trackingMetrics && (
                <div className="usr-track__metric">
                  <div className="usr-track__label">Ambulance location</div>
                  <div className="usr-track__value ui-mono">
                    {trackingMetrics.ambulanceLat.toFixed(4)}, {trackingMetrics.ambulanceLng.toFixed(4)}
                  </div>
                </div>
              )}
            </div>

            {trackingBooking.dispatch && (
              <DriverIdentity
                driver={trackingBooking.dispatch.driver}
                vehicleNumber={trackingBooking.dispatch.ambulance?.vehicleNumber}
                showCallButton
              />
            )}

            {/* Hand the same live view to anyone else, and see who the system
                has already told. */}
            <TrackingShareCard
              apiBaseUrl={API_BASE_URL}
              token={tokenStorage.getToken() || ''}
              bookingId={trackingBooking.id}
            />

            <div className="ui-card ui-card--flat">
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
          </div>
        </Modal>
      )}
    </div>
  );
}

export default Dashboard;
