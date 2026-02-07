import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { tokenStorage } from '../utils/tokenStorage';
import '../styles/Dashboard.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API_BASE_URL = 'http://localhost:3000/api';

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
  bookingType: 'EMERGENCY' | 'SCHEDULED';
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  scheduledTime?: string;
  createdAt: string;
  hospital?: Hospital;
  dispatch?: {
    status: string;
    ambulance?: {
      vehicleNumber: string;
      type: string;
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

type TabType = 'bookings' | 'profile';

function Dashboard() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingType, setBookingType] = useState<'EMERGENCY' | 'SCHEDULED'>('EMERGENCY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('bookings');
  const [editingProfile, setEditingProfile] = useState(false);
  const [showSOSConfirm, setShowSOSConfirm] = useState(false);
  const [sosActivating, setSosActivating] = useState(false);
  const [trackingBooking, setTrackingBooking] = useState<Booking | null>(null);
  const [ambulanceLocation, setAmbulanceLocation] = useState<{lat: number; lng: number} | null>(null);
  const [eta, setEta] = useState<string | null>(null);
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
  const trackingMapRef = useRef<HTMLDivElement>(null);
  const trackingMapInstanceRef = useRef<L.Map | null>(null);
  const ambulanceMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);

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

  // Initialize tracking map
  useEffect(() => {
    if (trackingBooking && trackingMapRef.current && !trackingMapInstanceRef.current) {
      const pickupLat = trackingBooking.pickupLatitude || 28.6139;
      const pickupLng = trackingBooking.pickupLongitude || 77.2090;
      
      trackingMapInstanceRef.current = L.map(trackingMapRef.current).setView([pickupLat, pickupLng], 13);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(trackingMapInstanceRef.current);

      // Add pickup marker
      const blueIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      L.marker([pickupLat, pickupLng], { icon: blueIcon })
        .bindPopup('📍 Pickup Location')
        .addTo(trackingMapInstanceRef.current);

      // Add ambulance marker
      const ambulanceIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });

      ambulanceMarkerRef.current = L.marker([pickupLat - 0.05, pickupLng + 0.05], { icon: ambulanceIcon })
        .bindPopup('🚑 Ambulance')
        .addTo(trackingMapInstanceRef.current);
    }

    return () => {
      if (!trackingBooking && trackingMapInstanceRef.current) {
        trackingMapInstanceRef.current.remove();
        trackingMapInstanceRef.current = null;
        ambulanceMarkerRef.current = null;
        routeLayerRef.current = null;
      }
    };
  }, [trackingBooking]);

  // Simulate real-time location updates
  useEffect(() => {
    if (!trackingBooking || !trackingMapInstanceRef.current) return;

    const interval = setInterval(() => {
      if (ambulanceMarkerRef.current) {
        const currentPos = ambulanceMarkerRef.current.getLatLng();
        const pickupLat = trackingBooking.pickupLatitude || 28.6139;
        const pickupLng = trackingBooking.pickupLongitude || 77.2090;
        
        const newLat = currentPos.lat + (pickupLat - currentPos.lat) * 0.1;
        const newLng = currentPos.lng + (pickupLng - currentPos.lng) * 0.1;
        
        ambulanceMarkerRef.current.setLatLng([newLat, newLng]);
        setAmbulanceLocation({ lat: newLat, lng: newLng });

        if (routeLayerRef.current) {
          trackingMapInstanceRef.current.removeLayer(routeLayerRef.current);
        }
        routeLayerRef.current = L.polyline([
          [newLat, newLng],
          [pickupLat, pickupLng]
        ], { color: 'red', weight: 3, opacity: 0.7, dashArray: '10, 10' })
          .addTo(trackingMapInstanceRef.current);

        const distance = Math.sqrt(
          Math.pow(pickupLat - newLat, 2) + Math.pow(pickupLng - newLng, 2)
        ) * 111;
        const etaMinutes = Math.max(1, Math.round(distance * 2));
        setEta(`${etaMinutes} min`);

        if (distance < 0.5) {
          clearInterval(interval);
          setEta('Arrived');
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [trackingBooking]);

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
            alert('Unable to get your location. Please search for your address manually or click on the map.');
          }
          setGettingLocation(false);
        },
        options
      );
    } else {
      // No browser geolocation, try IP
      const ipSuccess = await getLocationByIP();
      if (!ipSuccess) {
        alert('Geolocation is not available. Please search for your address manually.');
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
        setBookings(data.bookings.map((b: any) => ({
          id: b.id,
          userId: b.userId,
          hospitalId: b.hospitalId,
          pickupLocation: b.pickupLocation || 'Not specified',
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
            ambulance: b.dispatch.ambulance ? {
              vehicleNumber: b.dispatch.ambulance.vehicleNumber,
              type: b.dispatch.ambulance.type
            } : undefined
          } : undefined
        })));
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

  const handleCreateBooking = async () => {
    try {
      const token = tokenStorage.getToken();
      const bookingData: any = {
        pickupLocation,
        pickupAddress: pickupLocation,
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
        bookingData.triageData = triageData;
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

      await fetchDashboardData();
      alert('Booking created successfully! An ambulance will be assigned shortly.');
    } catch (err) {
      console.error('Failed to create booking:', err);
      alert('Failed to create booking');
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
      alert('🚨 SOS ACTIVATED! Emergency ambulance dispatched to your location. Stay calm, help is on the way!');
      
      // Start tracking the new booking
      const newBooking = response.data;
      setTrackingBooking(newBooking);
      
    } catch (err) {
      console.error('SOS Emergency failed:', err);
      alert('Failed to activate SOS. Please try again or call emergency services directly.');
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
    if (!confirm('Are you sure you want to cancel this booking?')) {
      return;
    }
    
    try {
      const token = tokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/bookings/${bookingId}/cancel`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to cancel booking:', err);
      alert('Failed to cancel booking');
    }
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
      alert('Profile updated successfully!');
    } catch (err) {
      console.error('Failed to update profile:', err);
      alert('Failed to update profile');
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
      case 'ASSIGNED': return '🚑 Ambulance Assigned';
      case 'EN_ROUTE': return '🚗 En Route to You';
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
      <div className="dashboard-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', marginBottom: '10px' }}>Loading...</div>
          <div style={{ color: '#666' }}>Fetching data from server</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center', color: '#ff4444' }}>
          <div style={{ fontSize: '24px', marginBottom: '10px' }}>Error</div>
          <div>{error}</div>
          <button onClick={fetchDashboardData} style={{ marginTop: '20px', padding: '10px 20px', cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-section">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="#00a3bf"/>
              <path d="M12 8v8m-4-4h8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="logo-text">ECS User</span>
          </div>
          <div className="user-badge">User Portal</div>
        </div>

        <nav className="nav-menu">
          <a href="#" className={`nav-item ${activeTab === 'bookings' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('bookings'); setShowBookingForm(false); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="18" rx="2" fill="currentColor"/>
              <path d="M16 2v4M8 2v4M3 10h18" stroke="white" strokeWidth="2"/>
            </svg>
            <span>My Bookings</span>
          </a>
          <a href="#" className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('profile'); setShowBookingForm(false); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" fill="currentColor"/>
              <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" fill="currentColor"/>
            </svg>
            <span>Profile</span>
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
        <header className="dashboard-header">
          <div>
            <h1>{activeTab === 'bookings' ? 'My Bookings' : 'My Profile'}</h1>
            <p>{activeTab === 'bookings' ? 'Book ambulance services and track your requests' : 'Manage your personal information'}</p>
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

            <div className="action-buttons">
              <button 
                onClick={() => {
                  setBookingType('EMERGENCY');
                  setShowBookingForm(true);
                }}
                className="action-btn emergency"
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="white"/>
                  <path d="M12 8v8m-4-4h8" stroke="#de350b" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Request Emergency Ambulance
              </button>
              <button 
                onClick={() => {
                  setBookingType('SCHEDULED');
                  setShowBookingForm(true);
                }}
                className="action-btn scheduled"
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="18" rx="2" fill="white"/>
                  <path d="M16 2v4M8 2v4M3 10h18" stroke="#0066cc" strokeWidth="2"/>
                </svg>
                Schedule Transport
              </button>
            </div>

            <div className="bookings-section">
              <div className="section-header">
                <h2>My Bookings</h2>
                <span className="count-badge">{bookings.length}</span>
              </div>

              <div className="bookings-grid">
                {bookings.length > 0 ? (
                  bookings.map(booking => (
                    <div key={booking.id} className="booking-card">
                      <div className="booking-header">
                        <span className="booking-id">#{booking.id.slice(0, 8)}</span>
                        <span 
                          className="booking-status"
                          style={{ backgroundColor: getStatusColor(booking.status) }}
                        >
                          {booking.status}
                        </span>
                      </div>

                      <div className="booking-type">
                        <svg viewBox="0 0 24 24" fill="none" className="type-icon">
                          {booking.bookingType === 'EMERGENCY' ? (
                            <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="#de350b"/>
                          ) : (
                            <rect x="3" y="4" width="18" height="18" rx="2" fill="#0066cc"/>
                          )}
                        </svg>
                        <span>{booking.bookingType}</span>
                        {booking.severity && (
                          <span 
                            className="severity-indicator"
                            style={{ backgroundColor: getSeverityColor(booking.severity) }}
                          >
                            {booking.severity}
                          </span>
                        )}
                      </div>

                      <div className="booking-locations">
                        <div className="location-row">
                          <svg viewBox="0 0 24 24" fill="none" className="location-icon">
                            <circle cx="12" cy="10" r="3" fill="#00a3bf"/>
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="#00a3bf" strokeWidth="2" fill="none"/>
                          </svg>
                          <div>
                            <strong>Pickup</strong>
                            <p>{booking.pickupLocation}</p>
                          </div>
                        </div>

                      </div>

                      {booking.dispatch && booking.dispatch.ambulance && (
                        <div className="ambulance-info" style={{ background: '#e3f2fd', padding: '12px', borderRadius: '8px', marginTop: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
                              <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4z" fill="#1976d2"/>
                            </svg>
                            <strong style={{ color: '#1976d2' }}>{booking.dispatch.ambulance.vehicleNumber}</strong>
                            <span style={{ fontSize: '12px', color: '#666' }}>({booking.dispatch.ambulance.type})</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ 
                              padding: '4px 10px', 
                              borderRadius: '12px', 
                              fontSize: '12px', 
                              fontWeight: '600',
                              backgroundColor: getDispatchStatusColor(booking.dispatch.status),
                              color: 'white'
                            }}>
                              {getDispatchStatusLabel(booking.dispatch.status)}
                            </span>
                          </div>
                          {/* Progress Bar */}
                          <div style={{ marginTop: '10px', background: '#e0e0e0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                            <div style={{ 
                              width: getDispatchProgress(booking.dispatch.status) + '%', 
                              background: 'linear-gradient(90deg, #1976d2, #42a5f5)', 
                              height: '100%',
                              transition: 'width 0.5s ease'
                            }}></div>
                          </div>
                        </div>
                      )}

                      <div className="booking-footer">
                        <div className="booking-time">
                          {new Date(booking.createdAt).toLocaleString()}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {(booking.status === 'CONFIRMED' || booking.status === 'PENDING') && booking.dispatch && (
                            <button 
                              onClick={() => startTracking(booking)}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#00875a',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                              }}
                            >
                              📍 Track Live
                            </button>
                          )}
                          {booking.status !== 'COMPLETED' && booking.status !== 'CANCELLED' && (
                            <button 
                              onClick={() => handleCancelBooking(booking.id)}
                              className="cancel-booking-btn"
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#de350b',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                              }}
                            >
                              Cancel Booking
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" className="empty-icon">
                      <rect x="3" y="4" width="18" height="18" rx="2" fill="#e0e0e0"/>
                    </svg>
                    <p>No bookings yet</p>
                    <span>Create your first booking to get started</span>
                  </div>
                )}
              </div>
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
                  <h3>Emergency Triage</h3>
                  
                  <div className="form-group">
                    <label>Chief Complaint</label>
                    <textarea 
                      value={triageData.chiefComplaint}
                      onChange={(e) => setTriageData({...triageData, chiefComplaint: e.target.value})}
                      placeholder="Describe the medical emergency"
                      rows={3}
                    />
                  </div>

                  <div className="form-group">
                    <label>Severity Level</label>
                    <select 
                      value={triageData.severity}
                      onChange={(e) => setTriageData({...triageData, severity: e.target.value as any})}
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                      <option value="CRITICAL">Critical</option>
                    </select>
                  </div>

                  <div className="checkbox-group">
                    <label>
                      <input 
                        type="checkbox"
                        checked={!triageData.isBreathing}
                        onChange={(e) => setTriageData({...triageData, isBreathing: !e.target.checked})}
                      />
                      <span>Difficulty Breathing</span>
                    </label>
                    
                    <label>
                      <input 
                        type="checkbox"
                        checked={!triageData.isConscious}
                        onChange={(e) => setTriageData({...triageData, isConscious: !e.target.checked})}
                      />
                      <span>Loss of Consciousness</span>
                    </label>
                    
                    <label>
                      <input 
                        type="checkbox"
                        checked={triageData.hasChestPain}
                        onChange={(e) => setTriageData({...triageData, hasChestPain: e.target.checked})}
                      />
                      <span>Chest Pain</span>
                    </label>
                    
                    <label>
                      <input 
                        type="checkbox"
                        checked={triageData.hasSevereBleeding}
                        onChange={(e) => setTriageData({...triageData, hasSevereBleeding: e.target.checked})}
                      />
                      <span>Severe Bleeding</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="form-actions">
                <button onClick={() => setShowBookingForm(false)} className="cancel-btn">
                  Cancel
                </button>
                <button 
                  onClick={handleCreateBooking} 
                  className="submit-btn"
                  disabled={bookingType === 'EMERGENCY' ? !pickupLocation : (!pickupLocation || !dropoffLocation || !scheduledTime)}
                >
                  {bookingType === 'EMERGENCY' ? 'Request Emergency Ambulance' : 'Schedule Transport'}
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
                  {trackingBooking.status}
                </div>
              </div>
              <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>ETA</div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#ff5722' }}>
                  {eta || 'Calculating...'}
                </div>
              </div>
              {trackingBooking.dispatch?.ambulance && (
                <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Vehicle</div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#1976d2' }}>
                    {trackingBooking.dispatch.ambulance.vehicleNumber}
                  </div>
                </div>
              )}
              {ambulanceLocation && (
                <div style={{ background: 'white', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Ambulance Location</div>
                  <div style={{ fontSize: '12px', fontWeight: '600', color: '#333' }}>
                    {ambulanceLocation.lat.toFixed(4)}, {ambulanceLocation.lng.toFixed(4)}
                  </div>
                </div>
              )}
            </div>

            <div style={{ flex: 1, position: 'relative', minHeight: '400px' }}>
              <div ref={trackingMapRef} style={{ width: '100%', height: '100%' }}></div>
            </div>

            <div style={{ padding: '16px 24px', background: '#f8f9fa', borderTop: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', background: '#2196f3', borderRadius: '50%' }}></div>
                  <span>Pickup Location</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', background: '#f44336', borderRadius: '50%' }}></div>
                  <span>Ambulance (Live)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '20px', height: '2px', background: '#f44336', borderTop: '2px dashed #f44336' }}></div>
                  <span>Route</span>
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
