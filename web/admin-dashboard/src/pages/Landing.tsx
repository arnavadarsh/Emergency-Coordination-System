import React, { useState, FormEvent, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ApiClient from '../services/api';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../styles/Landing.css';

interface AddressSuggestion {
  display_name: string;
  lat: string;
  lon: string;
}

/**
 * Landing Page with Login and Register
 */
const Landing: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [selectedRole, setSelectedRole] = useState<'USER' | 'HOSPITAL' | 'DRIVER' | 'ADMIN'>('USER');
  const [hospitalName, setHospitalName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const navigate = useNavigate();

  // Search for addresses using Nominatim (OpenStreetMap)
  const searchAddresses = async (query: string) => {
    if (query.length < 3) {
      setAddressSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5`,
        { headers: { 'User-Agent': 'ECS-Emergency-App' } }
      );
      const data = await response.json();
      setAddressSuggestions(data);
      setShowSuggestions(true);
    } catch (err) {
      console.error('Address search error:', err);
    }
  };

  const handleAddressChange = (value: string) => {
    setAddress(value);
    
    // Debounce the search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      searchAddresses(value);
    }, 300);
  };

  const selectAddress = (suggestion: AddressSuggestion) => {
    setAddress(suggestion.display_name);
    setSelectedCoords({ lat: parseFloat(suggestion.lat), lon: parseFloat(suggestion.lon) });
    setAddressSuggestions([]);
    setShowSuggestions(false);
    setShowMap(true);
  };

  // Initialize map when showing
  useEffect(() => {
    if (!showMap || !mapRef.current) return;

    // Clean up existing map
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    }

    // Small delay to ensure DOM is ready
    setTimeout(() => {
      if (!mapRef.current) return;

      // Initialize map
      const map = L.map(mapRef.current).setView([20.5937, 78.9629], 5);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      mapInstanceRef.current = map;

      // Custom marker icon
      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div style="background: #de350b; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      // If we have coordinates, add marker
      if (selectedCoords) {
        const marker = L.marker([selectedCoords.lat, selectedCoords.lon], { 
          icon: customIcon,
          draggable: true 
        }).addTo(map);
        
        marker.on('dragend', async (e) => {
          const position = e.target.getLatLng();
          setSelectedCoords({ lat: position.lat, lon: position.lng });
          
          // Reverse geocode to get address
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.lat}&lon=${position.lng}`,
              { headers: { 'User-Agent': 'ECS-Emergency-App' } }
            );
            const data = await response.json();
            setAddress(data.display_name);
          } catch (err) {
            console.error('Reverse geocode error:', err);
          }
        });

        markerRef.current = marker;
        map.setView([selectedCoords.lat, selectedCoords.lon], 13);
      }
    }, 100);

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, [showMap, selectedCoords]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await ApiClient.login(email, password);
      // Navigate based on user role
      const userRole = response.user.role;
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

    try {
      const registrationData: any = {
        email,
        password,
        firstName,
        lastName,
        phoneNumber,
        role: selectedRole,
      };

      // Add role-specific fields
      if (selectedRole === 'HOSPITAL') {
        registrationData.hospitalName = hospitalName;
        registrationData.address = address;
        if (selectedCoords) {
          registrationData.latitude = selectedCoords.lat;
          registrationData.longitude = selectedCoords.lon;
        }
      } else if (selectedRole === 'DRIVER') {
        registrationData.licenseNumber = licenseNumber;
        registrationData.vehicleNumber = vehicleNumber;
      } else if (selectedRole === 'USER') {
        registrationData.address = address;
        if (selectedCoords) {
          registrationData.latitude = selectedCoords.lat;
          registrationData.longitude = selectedCoords.lon;
        }
      }

      const response = await fetch('http://localhost:3000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registrationData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed');
      }

      setSuccess('Registration successful! You can now login.');
      setMode('login');
      setPassword('');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-container">
      <div className="landing-card">
        <div className="landing-header">
          <div className="landing-icon">ECS</div>
          <h1>Emergency Coordination System</h1>
        </div>

        <div className="mode-tabs">
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
            Register
          </button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="landing-form">
            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">{success}</div>}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
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

            <button type="submit" disabled={loading} className="submit-button">
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="landing-form">
            {error && <div className="error-message">{error}</div>}

            {/* Role Selection */}
            <div className="form-group">
              <label htmlFor="role">Select Role</label>
              <select
                id="role"
                value={selectedRole}
                onChange={(e) => {
                  setSelectedRole(e.target.value as any);
                  setShowMap(false);
                  setAddress('');
                  setHospitalName('');
                  setLicenseNumber('');
                  setVehicleNumber('');
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  fontSize: '14px',
                  backgroundColor: 'white',
                  cursor: 'pointer'
                }}
                required
              >
                <option value="USER">Patient/User</option>
                <option value="HOSPITAL">Hospital Staff</option>
                <option value="DRIVER">Ambulance Driver</option>
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="firstName">First Name</label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="lastName">Last Name</label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="regEmail">Email</label>
              <input
                id="regEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="regPassword">Password</label>
              <input
                id="regPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                minLength={6}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number</label>
              <input
                id="phone"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+91 9876543210"
                required
              />
            </div>

            {/* Hospital-specific fields */}
            {selectedRole === 'HOSPITAL' && (
              <>
                <div className="form-group">
                  <label htmlFor="hospitalName">Hospital Name</label>
                  <input
                    id="hospitalName"
                    type="text"
                    value={hospitalName}
                    onChange={(e) => setHospitalName(e.target.value)}
                    placeholder="Enter hospital name"
                    required
                  />
                </div>
                <div className="form-group address-group">
                  <label htmlFor="address">Hospital Address (Search on Map)</label>
                  <input
                    id="address"
                    type="text"
                    value={address}
                    onChange={(e) => handleAddressChange(e.target.value)}
                    onFocus={() => addressSuggestions.length > 0 && setShowSuggestions(true)}
                    placeholder="Start typing to search..."
                    autoComplete="off"
                    required
                  />
                  {showSuggestions && addressSuggestions.length > 0 && (
                    <div className="address-suggestions">
                      {addressSuggestions.map((suggestion, index) => (
                        <div
                          key={index}
                          className="address-suggestion-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectAddress(suggestion);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          {suggestion.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Driver-specific fields */}
            {selectedRole === 'DRIVER' && (
              <>
                <div className="form-group">
                  <label htmlFor="licenseNumber">License Number</label>
                  <input
                    id="licenseNumber"
                    type="text"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="Enter driving license number"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="vehicleNumber">Vehicle Number</label>
                  <input
                    id="vehicleNumber"
                    type="text"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                    placeholder="Enter ambulance vehicle number"
                    required
                  />
                </div>
              </>
            )}

            {/* User address field */}
            {selectedRole === 'USER' && (
              <div className="form-group address-group">
                <label htmlFor="address">Address (Search on Map)</label>
                <input
                  id="address"
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  onFocus={() => addressSuggestions.length > 0 && setShowSuggestions(true)}
                  placeholder="Start typing to search..."
                  autoComplete="off"
                />
                {showSuggestions && addressSuggestions.length > 0 && (
                  <div className="address-suggestions">
                    {addressSuggestions.map((suggestion, index) => (
                      <div
                        key={index}
                        className="address-suggestion-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectAddress(suggestion);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {suggestion.display_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showMap && (
              <div className="map-container" style={{ 
                marginBottom: '20px',
                borderRadius: '12px',
                overflow: 'hidden',
                border: '2px solid #0066cc',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}>
                <div 
                  ref={mapRef} 
                  style={{ 
                    height: '300px', 
                    width: '100%' 
                  }}
                ></div>
                <div style={{ 
                  padding: '12px', 
                  background: '#f8f9fa', 
                  borderTop: '1px solid #e0e0e0',
                  fontSize: '13px',
                  color: '#666'
                }}>
                  <strong>Selected Location:</strong> {address}
                  <br />
                  <small>Drag the marker to adjust your exact location</small>
                </div>
              </div>
            )}

            <button type="submit" disabled={loading} className="submit-button register">
              {loading ? 'Registering...' : 'Create Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Landing;
