import React, { useState, FormEvent, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ApiClient from '../services/api';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/Landing.css';

interface LocationSuggestion {
  display_name: string;
  lat: string;
  lon: string;
}

/**
 * Driver Landing Page with Login and Ambulance Registration
 */
const Landing: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Registration state
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverLicense, setDriverLicense] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('BASIC');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAddress, setLocationAddress] = useState('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const navigate = useNavigate();

  const equipmentOptions = [
    'Oxygen Cylinder', 'Defibrillator', 'Stretcher', 'First Aid Kit',
    'Ventilator', 'Cardiac Monitor', 'Suction Device', 'Spine Board',
    'Medication Kit', 'IV Equipment'
  ];

  // Create custom ambulance marker icon
  const createMarkerIcon = () => {
    return L.divIcon({
      html: `<div style="
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #f5576c 0%, #f093fb 100%);
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 3px 10px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      "><span style="transform: rotate(45deg); font-size: 18px;">🚑</span></div>`,
      className: 'custom-marker',
      iconSize: [40, 40],
      iconAnchor: [20, 40],
    });
  };

  // Initialize map when in register mode
  useEffect(() => {
    if (mode === 'register' && mapRef.current && !mapInstanceRef.current) {
      const defaultCenter: [number, number] = [28.6139, 77.2090]; // Delhi
      
      mapInstanceRef.current = L.map(mapRef.current).setView(defaultCenter, 12);
      
      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(mapInstanceRef.current);

      // Create draggable marker
      markerRef.current = L.marker(defaultCenter, {
        icon: createMarkerIcon(),
        draggable: true
      }).addTo(mapInstanceRef.current);

      // Handle marker drag
      markerRef.current.on('dragend', () => {
        const pos = markerRef.current?.getLatLng();
        if (pos) {
          setCurrentLocation({ lat: pos.lat, lng: pos.lng });
          reverseGeocode(pos.lat, pos.lng);
        }
      });

      // Handle map click
      mapInstanceRef.current.on('click', (e: L.LeafletMouseEvent) => {
        if (markerRef.current) {
          markerRef.current.setLatLng(e.latlng);
          setCurrentLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
          reverseGeocode(e.latlng.lat, e.latlng.lng);
        }
      });
    }

    // Cleanup
    return () => {
      if (mapInstanceRef.current && mode !== 'register') {
        // Don't destroy map when switching away, keep it for when we return
      }
    };
  }, [mode]);

  // Reverse geocode using Nominatim
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { 'User-Agent': 'ECS-Emergency-App' } }
      );
      const data = await response.json();
      if (data.display_name) {
        setLocationAddress(data.display_name);
      }
    } catch (err) {
      console.error('Reverse geocode error:', err);
    }
  };

  // Search locations using Nominatim
  const searchLocations = async (query: string) => {
    if (query.length < 3) {
      setLocationSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5`,
        { headers: { 'User-Agent': 'ECS-Emergency-App' } }
      );
      const data = await response.json();
      setLocationSuggestions(data);
      setShowSuggestions(true);
    } catch (err) {
      console.error('Location search error:', err);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      searchLocations(value);
    }, 300);
  };

  const selectLocation = (suggestion: LocationSuggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lng = parseFloat(suggestion.lon);
    
    setCurrentLocation({ lat, lng });
    setLocationAddress(suggestion.display_name);
    setSearchQuery('');
    setLocationSuggestions([]);
    setShowSuggestions(false);
    
    if (mapInstanceRef.current && markerRef.current) {
      mapInstanceRef.current.setView([lat, lng], 15);
      markerRef.current.setLatLng([lat, lng]);
    }
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      // Fallback to IP-based geolocation
      getLocationByIP();
      return;
    }

    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCurrentLocation({ lat, lng });
        
        if (mapInstanceRef.current && markerRef.current) {
          mapInstanceRef.current.setView([lat, lng], 15);
          markerRef.current.setLatLng([lat, lng]);
        }
        
        reverseGeocode(lat, lng);
        setGettingLocation(false);
      },
      () => {
        // Fallback to IP-based geolocation
        getLocationByIP();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // IP-based geolocation fallback
  const getLocationByIP = async () => {
    try {
      const response = await fetch('https://ipapi.co/json/');
      const data = await response.json();
      
      if (data.latitude && data.longitude) {
        const lat = data.latitude;
        const lng = data.longitude;
        setCurrentLocation({ lat, lng });
        
        if (mapInstanceRef.current && markerRef.current) {
          mapInstanceRef.current.setView([lat, lng], 15);
          markerRef.current.setLatLng([lat, lng]);
        }
        
        reverseGeocode(lat, lng);
      }
    } catch (err) {
      setError('Unable to get your location. Please search or click on the map.');
    } finally {
      setGettingLocation(false);
    }
  };

  const handleEquipmentChange = (item: string) => {
    setEquipment(prev => 
      prev.includes(item) 
        ? prev.filter(e => e !== item)
        : [...prev, item]
    );
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await ApiClient.login(email, password);
      if (response.user.role !== 'DRIVER') {
        setError('Invalid credentials for Driver portal');
        localStorage.removeItem('ecs_token');
        localStorage.removeItem('ecs_user');
        return;
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (!currentLocation) {
      setError('Please set your current location on the map');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('http://localhost:3000/api/ambulances/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverName,
          driverPhone,
          driverLicense,
          vehicleNumber,
          vehicleType,
          currentLatitude: currentLocation.lat,
          currentLongitude: currentLocation.lng,
          equipmentList: {
            equipment,
            locationAddress,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed');
      }

      setSuccess('Registration submitted successfully! Your application is pending admin verification. You will be notified once approved.');
      // Reset form
      setDriverName('');
      setDriverPhone('');
      setDriverLicense('');
      setVehicleNumber('');
      setVehicleType('BASIC');
      setEquipment([]);
      setCurrentLocation(null);
      setLocationAddress('');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-container driver">
      <div className="landing-card driver-card">
        <div className="landing-header driver">
          <div className="landing-icon">🚑</div>
          <h1>ECS Driver Portal</h1>
          <p>Emergency Coordination System</p>
        </div>

        <div className="mode-tabs driver">
          <button
            className={`tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
          >
            Login
          </button>
          <button
            className={`tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); setSuccess(''); }}
          >
            Register Ambulance
          </button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="landing-form">
            {error && <div className="error-message">{error}</div>}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="driver@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </div>

            <button type="submit" disabled={loading} className="submit-button driver">
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="landing-form register-form">
            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <div className="section-title">Driver Information</div>
            
            <div className="form-group">
              <label htmlFor="driverName">Full Name *</label>
              <input
                id="driverName"
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Enter your full name"
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="driverPhone">Phone Number *</label>
                <input
                  id="driverPhone"
                  type="tel"
                  value={driverPhone}
                  onChange={(e) => setDriverPhone(e.target.value)}
                  placeholder="+91 9876543210"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="driverLicense">License Number *</label>
                <input
                  id="driverLicense"
                  type="text"
                  value={driverLicense}
                  onChange={(e) => setDriverLicense(e.target.value)}
                  placeholder="DL-1234567890"
                  required
                />
              </div>
            </div>

            <div className="section-title">Vehicle Information</div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="vehicleNumber">Vehicle Number *</label>
                <input
                  id="vehicleNumber"
                  type="text"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                  placeholder="DL 01 AB 1234"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="vehicleType">Ambulance Type *</label>
                <select
                  id="vehicleType"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  required
                >
                  <option value="BASIC">Basic Life Support (BLS)</option>
                  <option value="ADVANCED">Advanced Life Support (ALS)</option>
                  <option value="ICU">Mobile ICU</option>
                  <option value="NEONATAL">Neonatal</option>
                </select>
              </div>
            </div>

            <div className="section-title">Current Location</div>

            <div className="form-group location-search-group">
              <label>Search Location or Click on Map</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => locationSuggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="Search for a location..."
                className="location-search"
                autoComplete="off"
              />
              {showSuggestions && locationSuggestions.length > 0 && (
                <div className="location-suggestions">
                  {locationSuggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      className="location-suggestion-item"
                      onClick={() => selectLocation(suggestion)}
                    >
                      📍 {suggestion.display_name}
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="location-button"
                onClick={getCurrentLocation}
                disabled={gettingLocation}
              >
                📍 {gettingLocation ? 'Getting Location...' : 'Use Current Location'}
              </button>
            </div>

            <div className="map-container" ref={mapRef}></div>
            
            {locationAddress && (
              <div className="selected-location">
                📍 {locationAddress}
              </div>
            )}

            <div className="section-title">Equipment Available</div>

            <div className="equipment-grid">
              {equipmentOptions.map(item => (
                <label key={item} className="equipment-item">
                  <input
                    type="checkbox"
                    checked={equipment.includes(item)}
                    onChange={() => handleEquipmentChange(item)}
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>

            <div className="submit-note">
              <strong>Note:</strong> Your registration will be reviewed by our admin team. 
              Once verified, you will receive login credentials to access the Driver Dashboard.
            </div>

            <button type="submit" disabled={loading} className="submit-button driver-register">
              {loading ? 'Submitting...' : 'Submit for Verification'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Landing;
