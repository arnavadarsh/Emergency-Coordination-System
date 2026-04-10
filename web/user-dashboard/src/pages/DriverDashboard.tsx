import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { tokenStorage } from '../utils/tokenStorage';
import '../styles/DriverDashboard.css';

const API_BASE_URL = 'http://localhost:3000/api';

interface Booking {
  id: string;
  userId: string;
  pickupLocation: string;
  dropoffLocation: string;
  bookingType: 'EMERGENCY' | 'SCHEDULED';
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  scheduledTime?: string;
  createdAt: string;
}

interface Dispatch {
  id: string;
  bookingId: string;
  ambulanceId: string;
  driverId: string;
  status: 'ASSIGNED' | 'DISPATCHED' | 'EN_ROUTE' | 'AT_PICKUP' | 'EN_ROUTE_HOSPITAL' | 'AT_HOSPITAL' | 'COMPLETED' | 'CANCELLED';
  assignedAt: string;
  completedAt?: string;
  booking: Booking;
}

interface DriverProfile {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name: string;
  licenseNumber: string;
  phoneNumber: string;
  address?: string;
  ambulanceId: string;
  ambulance?: {
    vehicleNumber: string;
    type: string;
    status: string;
  };
}

type TabType = 'active' | 'history' | 'profile';

function Dashboard() {
  const navigate = useNavigate();
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [activeDispatch, setActiveDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    address: ''
  });

  const fetchDashboardData = async () => {
    try {
      const token = tokenStorage.getToken();
      const response = await axios.get(`${API_BASE_URL}/dashboard/driver`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = response.data;
      
      // Set driver profile
      if (data.driver) {
        const profile = {
          id: data.driver.id,
          email: data.driver.email,
          firstName: data.driver.firstName || '',
          lastName: data.driver.lastName || '',
          name: data.driver.name || `${data.driver.firstName || ''} ${data.driver.lastName || ''}`.trim() || 'Driver',
          licenseNumber: data.driver.licenseNumber || 'N/A',
          phoneNumber: data.driver.phoneNumber || 'N/A',
          address: data.driver.address || '',
          ambulanceId: data.driver.ambulanceId || '',
          ambulance: data.ambulance ? {
            vehicleNumber: data.ambulance.vehicleNumber || 'N/A',
            type: data.ambulance.type || 'STANDARD',
            status: data.ambulance.status || 'AVAILABLE'
          } : undefined
        };
        setDriverProfile(profile);
        setProfileForm({
          firstName: profile.firstName,
          lastName: profile.lastName,
          phoneNumber: profile.phoneNumber === 'N/A' ? '' : profile.phoneNumber,
          address: profile.address || ''
        });
      }
      
      // Set dispatches
      if (data.dispatches && data.dispatches.length > 0) {
        const formattedDispatches = data.dispatches.map((d: any) => ({
          id: d.id,
          bookingId: d.bookingId || d.booking?.id,
          ambulanceId: d.ambulanceId,
          driverId: d.driverId,
          status: d.status || 'ASSIGNED',
          assignedAt: d.assignedAt || d.createdAt,
          completedAt: d.completedAt,
          booking: {
            id: d.booking?.id || d.bookingId,
            userId: d.booking?.userId || '',
            pickupLocation: d.booking?.pickupLocation || 'Not specified',
            dropoffLocation: d.booking?.dropoffLocation || d.booking?.hospitalName || 'Not specified',
            bookingType: d.booking?.bookingType || 'EMERGENCY',
            severity: d.booking?.severity || 'MEDIUM',
            status: d.booking?.status || 'IN_PROGRESS',
            createdAt: d.booking?.createdAt || d.assignedAt
          }
        }));
        
        setDispatches(formattedDispatches);
        
        // Find active dispatch
        const active = formattedDispatches.find(
          (d: Dispatch) => ['ASSIGNED', 'DISPATCHED', 'EN_ROUTE', 'AT_PICKUP', 'EN_ROUTE_HOSPITAL', 'AT_HOSPITAL'].includes(d.status)
        );
        setActiveDispatch(active || null);
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

  const updateDispatchStatus = async (dispatchId: string, newStatus: string) => {
    try {
      const token = tokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/dispatch/${dispatchId}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to update dispatch status:', err);
      toast.error('Failed to update status');
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
      toast.success('Profile updated successfully!');
    } catch (err) {
      console.error('Failed to update profile:', err);
      toast.error('Failed to update profile');
    }
  };

  const handleLogout = () => {
    tokenStorage.clearToken();
    navigate('/login');
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
      case 'ASSIGNED': 
      case 'DISPATCHED': return '#0066cc';
      case 'EN_ROUTE': 
      case 'EN_ROUTE_HOSPITAL': return '#ff8b00';
      case 'AT_PICKUP':
      case 'AT_HOSPITAL': return '#00875a';
      case 'COMPLETED': return '#6b778c';
      case 'CANCELLED': return '#de350b';
      default: return '#6b778c';
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
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="#ff8b00"/>
              <path d="M12 8v8m-4-4h8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="logo-text">ECS Driver</span>
          </div>
          <div className="driver-badge">Driver Portal</div>
        </div>

        <nav className="nav-menu">
          <a href="#" className={`nav-item ${activeTab === 'active' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('active'); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" fill="currentColor"/>
            </svg>
            <span>Active Dispatch</span>
          </a>
          <a href="#" className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('history'); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 117 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21a9 9 0 000-18zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z" fill="currentColor"/>
            </svg>
            <span>History</span>
          </a>
          <a href="#" className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('profile'); }}>
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
            <h1>{activeTab === 'active' ? 'Active Dispatch' : activeTab === 'history' ? 'Dispatch History' : 'My Profile'}</h1>
            <p>{activeTab === 'active' ? 'Manage your current dispatch' : activeTab === 'history' ? 'View past dispatches' : 'Manage your personal information'}</p>
          </div>
          {driverProfile && activeTab !== 'profile' && (
            <div className="driver-info-card">
              <div className="info-row">
                <strong>{driverProfile.name}</strong>
              </div>
              <div className="info-row">
                License: {driverProfile.licenseNumber}
              </div>
              {driverProfile.ambulance && (
                <div className="info-row">
                  Vehicle: {driverProfile.ambulance.vehicleNumber} ({driverProfile.ambulance.type})
                </div>
              )}
            </div>
          )}
        </header>

        {activeTab === 'profile' ? (
          <div className="profile-section" style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: '#333' }}>Personal Information</h2>
              {!editingProfile ? (
                <button onClick={() => setEditingProfile(true)} style={{ padding: '8px 16px', backgroundColor: '#ff8b00', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                  Edit Profile
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setEditingProfile(false)} style={{ padding: '8px 16px', backgroundColor: '#e0e0e0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={handleUpdateProfile} style={{ padding: '8px 16px', backgroundColor: '#00875a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                    Save Changes
                  </button>
                </div>
              )}
            </div>

            {!editingProfile ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                <div style={{ padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600' }}>Email</label>
                  <p style={{ margin: '8px 0 0', fontSize: '16px', color: '#333' }}>{driverProfile?.email || 'N/A'}</p>
                </div>
                <div style={{ padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600' }}>Full Name</label>
                  <p style={{ margin: '8px 0 0', fontSize: '16px', color: '#333' }}>{driverProfile?.name || 'N/A'}</p>
                </div>
                <div style={{ padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600' }}>Phone Number</label>
                  <p style={{ margin: '8px 0 0', fontSize: '16px', color: '#333' }}>{driverProfile?.phoneNumber || 'N/A'}</p>
                </div>
                <div style={{ padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600' }}>License Number</label>
                  <p style={{ margin: '8px 0 0', fontSize: '16px', color: '#333' }}>{driverProfile?.licenseNumber || 'N/A'}</p>
                </div>
                <div style={{ padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600' }}>Address</label>
                  <p style={{ margin: '8px 0 0', fontSize: '16px', color: '#333' }}>{driverProfile?.address || 'Not set'}</p>
                </div>
                {driverProfile?.ambulance && (
                  <div style={{ padding: '16px', backgroundColor: '#fff3e0', borderRadius: '8px' }}>
                    <label style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: '600' }}>Assigned Vehicle</label>
                    <p style={{ margin: '8px 0 0', fontSize: '16px', color: '#333' }}>{driverProfile.ambulance.vehicleNumber} ({driverProfile.ambulance.type})</p>
                    <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#ff8b00' }}>Status: {driverProfile.ambulance.status}</p>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#333' }}>First Name</label>
                  <input type="text" value={profileForm.firstName} onChange={(e) => setProfileForm({...profileForm, firstName: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} placeholder="Enter first name" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#333' }}>Last Name</label>
                  <input type="text" value={profileForm.lastName} onChange={(e) => setProfileForm({...profileForm, lastName: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} placeholder="Enter last name" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#333' }}>Phone Number</label>
                  <input type="tel" value={profileForm.phoneNumber} onChange={(e) => setProfileForm({...profileForm, phoneNumber: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} placeholder="Enter phone number" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#333' }}>Address</label>
                  <input type="text" value={profileForm.address} onChange={(e) => setProfileForm({...profileForm, address: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} placeholder="Enter address" />
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'history' ? (
          <div className="card history-card" style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>All Dispatches</h2>
              <span className="count-badge" style={{ background: '#e3f2fd', color: '#1976d2', padding: '4px 12px', borderRadius: '12px' }}>{dispatches.length}</span>
            </div>
            
            <div className="dispatches-list">
              {dispatches.length > 0 ? (
                dispatches.map(dispatch => (
                  <div key={dispatch.id} className="dispatch-item" style={{ padding: '16px', borderBottom: '1px solid #eee' }}>
                    <div className="dispatch-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span className="dispatch-id" style={{ fontFamily: 'monospace' }}>#{dispatch.booking.id.slice(0, 8)}</span>
                      <span style={{ padding: '4px 12px', borderRadius: '12px', color: 'white', backgroundColor: getStatusColor(dispatch.status), fontSize: '12px' }}>
                        {dispatch.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#ff8b00' }}>📍</span>
                      <span>{dispatch.booking.pickupLocation}</span>
                      <span>→</span>
                      <span style={{ color: '#00875a' }}>📍</span>
                      <span>{dispatch.booking.dropoffLocation}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666' }}>
                      <span>{new Date(dispatch.assignedAt).toLocaleString()}</span>
                      {dispatch.booking.severity && (
                        <span style={{ padding: '2px 8px', borderRadius: '8px', backgroundColor: getSeverityColor(dispatch.booking.severity), color: 'white' }}>
                          {dispatch.booking.severity}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                  <p>No dispatch history</p>
                </div>
              )}
            </div>
          </div>
        ) : (
        <div className="dashboard-grid">
          {/* Active Dispatch Section */}
          <div className="card active-dispatch-card">
            <div className="card-header">
              <h2>Active Dispatch</h2>
              {activeDispatch && (
                <span 
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(activeDispatch.status) }}
                >
                  {activeDispatch.status.replace('_', ' ')}
                </span>
              )}
            </div>
            
            {activeDispatch ? (
              <div className="active-dispatch-content">
                <div className="dispatch-details">
                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" className="detail-icon">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ff8b00"/>
                    </svg>
                    <div>
                      <strong>Pickup Location</strong>
                      <p>{activeDispatch.booking.pickupLocation}</p>
                    </div>
                  </div>

                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" className="detail-icon">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#00875a"/>
                    </svg>
                    <div>
                      <strong>Dropoff Location</strong>
                      <p>{activeDispatch.booking.dropoffLocation}</p>
                    </div>
                  </div>

                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" className="detail-icon">
                      <circle cx="12" cy="12" r="10" fill={getSeverityColor(activeDispatch.booking.severity)}/>
                      <path d="M12 6v6l4 2" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <div>
                      <strong>Priority</strong>
                      <p style={{ color: getSeverityColor(activeDispatch.booking.severity) }}>
                        {activeDispatch.booking.severity || 'STANDARD'}
                      </p>
                    </div>
                  </div>

                  <div className="detail-item">
                    <svg viewBox="0 0 24 24" fill="none" className="detail-icon">
                      <rect x="3" y="4" width="18" height="18" rx="2" fill="#0066cc"/>
                      <path d="M16 2v4M8 2v4M3 10h18" stroke="white" strokeWidth="2"/>
                    </svg>
                    <div>
                      <strong>Type</strong>
                      <p>{activeDispatch.booking.bookingType}</p>
                    </div>
                  </div>
                </div>

                <div className="status-controls">
                  {activeDispatch.status === 'ASSIGNED' || activeDispatch.status === 'DISPATCHED' ? (
                    <button
                      onClick={() => updateDispatchStatus(activeDispatch.id, 'EN_ROUTE')}
                      className="status-btn en-route"
                    >
                      Start Journey
                    </button>
                  ) : null}
                  {activeDispatch.status === 'EN_ROUTE' && (
                    <button
                      onClick={() => updateDispatchStatus(activeDispatch.id, 'AT_PICKUP')}
                      className="status-btn arrived"
                    >
                      Arrived at Pickup
                    </button>
                  )}
                  {activeDispatch.status === 'AT_PICKUP' && (
                    <button
                      onClick={() => updateDispatchStatus(activeDispatch.id, 'EN_ROUTE_HOSPITAL')}
                      className="status-btn en-route"
                    >
                      En Route to Hospital
                    </button>
                  )}
                  {activeDispatch.status === 'EN_ROUTE_HOSPITAL' && (
                    <button
                      onClick={() => updateDispatchStatus(activeDispatch.id, 'AT_HOSPITAL')}
                      className="status-btn arrived"
                    >
                      Arrived at Hospital
                    </button>
                  )}
                  {activeDispatch.status === 'AT_HOSPITAL' && (
                    <button
                      onClick={() => updateDispatchStatus(activeDispatch.id, 'COMPLETED')}
                      className="status-btn completed"
                    >
                      Complete Dispatch
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" className="empty-icon">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#e0e0e0"/>
                </svg>
                <p>No active dispatch</p>
                <span>You'll see your next assignment here</span>
              </div>
            )}
          </div>

          {/* Recent Dispatches */}
          <div className="card history-card">
            <div className="card-header">
              <h2>Recent Dispatches</h2>
              <span className="count-badge">{dispatches.length}</span>
            </div>
            
            <div className="dispatches-list">
              {dispatches.length > 0 ? (
                dispatches.slice(0, 10).map(dispatch => (
                  <div key={dispatch.id} className="dispatch-item">
                    <div className="dispatch-header">
                      <span className="dispatch-id">#{dispatch.booking.id.slice(0, 8)}</span>
                      <span 
                        className="dispatch-status"
                        style={{ backgroundColor: getStatusColor(dispatch.status) }}
                      >
                        {dispatch.status.replace('_', ' ')}
                      </span>
                    </div>
                    
                    <div className="dispatch-locations">
                      <div className="location-item">
                        <svg viewBox="0 0 24 24" fill="none" className="location-icon">
                          <circle cx="12" cy="10" r="3" fill="#ff8b00"/>
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="#ff8b00" strokeWidth="2" fill="none"/>
                        </svg>
                        <span>{dispatch.booking.pickupLocation}</span>
                      </div>
                      <svg viewBox="0 0 24 24" fill="none" className="arrow-icon">
                        <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" fill="#6b778c"/>
                      </svg>
                      <div className="location-item">
                        <svg viewBox="0 0 24 24" fill="none" className="location-icon">
                          <circle cx="12" cy="10" r="3" fill="#00875a"/>
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="#00875a" strokeWidth="2" fill="none"/>
                        </svg>
                        <span>{dispatch.booking.dropoffLocation}</span>
                      </div>
                    </div>
                    
                    <div className="dispatch-meta">
                      <span className="dispatch-time">
                        {new Date(dispatch.assignedAt).toLocaleString()}
                      </span>
                      {dispatch.booking.severity && (
                        <span 
                          className="severity-badge"
                          style={{ backgroundColor: getSeverityColor(dispatch.booking.severity) }}
                        >
                          {dispatch.booking.severity}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <p>No dispatch history</p>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
