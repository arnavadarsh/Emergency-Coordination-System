import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TokenStorage from '../utils/tokenStorage';
import '../styles/HospitalDashboard.css';

const API_BASE_URL = 'http://localhost:3000/api';

interface Capability {
  type: string;
  name: string;
  status: string;
}

interface Booking {
  id: string;
  type: string;
  status: string;
  severity: string;
  eta: string | null;
  time: string;
}

interface Stats {
  totalBeds: number;
  availableBeds: number;
  occupiedBeds: number;
  incomingAmbulances: number;
  activeEmergencies: number;
  completedToday: number;
}

interface HospitalInfo {
  id?: string;
  name: string;
  status: string;
  address?: string;
  phoneNumber?: string;
}

type TabType = 'dashboard' | 'beds' | 'emergencies' | 'history';

const Dashboard = () => {
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [hospitalInfo, setHospitalInfo] = useState<HospitalInfo>({
    name: 'Loading...',
    status: 'ACCEPTING'
  });
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalBeds: 0,
    availableBeds: 0,
    occupiedBeds: 0,
    incomingAmbulances: 0,
    activeEmergencies: 0,
    completedToday: 0
  });
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [bedUpdateValue, setBedUpdateValue] = useState(0);

  const fetchDashboardData = async () => {
    try {
      const token = TokenStorage.getToken();
      const response = await axios.get(`${API_BASE_URL}/dashboard/hospital`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = response.data;
      
      // Set hospital info
      if (data.hospital) {
        setHospitalInfo({
          id: data.hospital.id,
          name: data.hospital.name || 'Hospital',
          status: data.hospital.status || 'ACCEPTING',
          address: data.hospital.address,
          phoneNumber: data.hospital.phoneNumber
        });
        setBedUpdateValue(data.stats?.availableBeds || data.hospital?.availableBeds || 0);
      }
      
      // Set capabilities
      if (data.capabilities && data.capabilities.length > 0) {
        setCapabilities(data.capabilities.map((cap: any) => ({
          type: cap.type || cap.capabilityType || 'GENERAL',
          name: cap.name || cap.type || 'General',
          status: cap.status || 'ACCEPTING'
        })));
      }
      
      // Set stats
      setStats({
        totalBeds: data.stats?.totalBeds || data.hospital?.totalBeds || 0,
        availableBeds: data.stats?.availableBeds || data.hospital?.availableBeds || 0,
        occupiedBeds: data.stats?.occupiedBeds || (data.hospital?.totalBeds - data.hospital?.availableBeds) || 0,
        incomingAmbulances: data.stats?.incomingAmbulances || data.incomingAmbulances?.length || 0,
        activeEmergencies: data.stats?.activeEmergencies || data.activeBookings?.length || 0,
        completedToday: data.stats?.completedToday || data.completedBookings?.length || 0
      });
      
      // Set recent bookings
      if (data.recentBookings && data.recentBookings.length > 0) {
        setRecentBookings(data.recentBookings.map((b: any) => ({
          id: `BK-${b.id?.toString().slice(-4) || Math.random().toString(36).substr(2, 4)}`,
          type: b.bookingType || b.type || 'EMERGENCY',
          status: b.status || 'PENDING',
          severity: b.severity || 'MEDIUM',
          eta: b.eta || null,
          time: formatTimeAgo(b.createdAt)
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

  const formatTimeAgo = (dateStr: string): string => {
    if (!dateStr) return 'Just now';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs} hr ago`;
    return `${Math.floor(diffHrs / 24)} days ago`;
  };

  useEffect(() => {
    fetchDashboardData();
    
    // Refresh data every 30 seconds
    const refreshInterval = setInterval(fetchDashboardData, 30000);
    
    // Update clock every second
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(clockTimer);
    };
  }, []);

  const handleLogout = () => {
    TokenStorage.removeToken();
    navigate('/login');
  };
  
  const handleStatusChange = async (newStatus: string) => {
    try {
      const token = TokenStorage.getToken();
      // Get hospital ID from current user context
      const userResponse = await axios.get(`${API_BASE_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const hospitalId = userResponse.data.hospitalId;
      
      if (!hospitalId) {
        alert('Hospital ID not found');
        return;
      }
      
      await axios.patch(
        `${API_BASE_URL}/hospitals/${hospitalId}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setHospitalInfo(prev => ({ ...prev, status: newStatus }));
    } catch (err) {
      console.error('Failed to update hospital status:', err);
      alert('Failed to update hospital status');
    }
  };

  const handleCapabilityStatusChange = async (capabilityType: string, newStatus: string) => {
    // For now, update local state. Backend capability update can be added later
    setCapabilities(prev => 
      prev.map(cap => 
        cap.type === capabilityType ? { ...cap, status: newStatus } : cap
      )
    );
  };
  
  const handleUpdateBeds = async (availableBeds: number) => {
    try {
      const token = TokenStorage.getToken();
      const userResponse = await axios.get(`${API_BASE_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const hospitalId = userResponse.data.hospitalId;
      
      if (!hospitalId) {
        alert('Hospital ID not found');
        return;
      }
      
      await axios.patch(
        `${API_BASE_URL}/hospitals/${hospitalId}/beds`,
        { availableBeds },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setStats(prev => ({
        ...prev,
        availableBeds,
        occupiedBeds: prev.totalBeds - availableBeds
      }));
    } catch (err) {
      console.error('Failed to update bed count:', err);
      alert('Failed to update bed count');
    }
  };

  const bedUtilization = stats.totalBeds > 0 ? Math.round((stats.occupiedBeds / stats.totalBeds) * 100) : 0;
  
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
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z"/>
            </svg>
          </div>
          <h2>{hospitalInfo.name}</h2>
          <div className={`hospital-status status-${hospitalInfo.status.toLowerCase()}`}>
            {hospitalInfo.status}
          </div>
        </div>
        
        <nav className="sidebar-nav">
          <a href="#" className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('dashboard'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
            Dashboard
          </a>
          <a href="#" className={`nav-item ${activeTab === 'beds' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('beds'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V7H1v10h22v-6c0-2.21-1.79-4-4-4z"/></svg>
            Bed Management
          </a>
          <a href="#" className={`nav-item ${activeTab === 'emergencies' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('emergencies'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2zm0-6h2v4h-2z"/></svg>
            Emergency Cases
          </a>
          <a href="#" className={`nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('history'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            History
          </a>
        </nav>
        
        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
            Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="top-bar">
          <div className="top-bar-left">
            <h1>{activeTab === 'dashboard' ? 'Dashboard Overview' : activeTab === 'beds' ? 'Bed Management' : activeTab === 'emergencies' ? 'Emergency Cases' : 'Booking History'}</h1>
            <div className="time">{currentTime.toLocaleString('en-US', { 
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', 
              hour: '2-digit', minute: '2-digit' 
            })}</div>
          </div>
          <div className="top-bar-right">
            <div className="status-buttons">
              <button 
                className={`status-btn ${hospitalInfo.status === 'ACCEPTING' ? 'active' : ''}`}
                onClick={() => handleStatusChange('ACCEPTING')}
              >
                Accepting
              </button>
              <button 
                className={`status-btn ${hospitalInfo.status === 'LIMITED' ? 'active' : ''}`}
                onClick={() => handleStatusChange('LIMITED')}
              >
                Limited
              </button>
              <button 
                className={`status-btn ${hospitalInfo.status === 'DIVERT' ? 'active' : ''}`}
                onClick={() => handleStatusChange('DIVERT')}
              >
                Divert
              </button>
            </div>
          </div>
        </div>

        {activeTab === 'beds' ? (
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <h2 style={{ marginTop: 0 }}>Bed Management</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '24px' }}>
              <div style={{ padding: '20px', backgroundColor: '#e3f2fd', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#1976d2' }}>{stats.totalBeds}</div>
                <div style={{ color: '#666', marginTop: '8px' }}>Total Beds</div>
              </div>
              <div style={{ padding: '20px', backgroundColor: '#e8f5e9', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#388e3c' }}>{stats.availableBeds}</div>
                <div style={{ color: '#666', marginTop: '8px' }}>Available</div>
              </div>
              <div style={{ padding: '20px', backgroundColor: '#fff3e0', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#f57c00' }}>{stats.occupiedBeds}</div>
                <div style={{ color: '#666', marginTop: '8px' }}>Occupied</div>
              </div>
              <div style={{ padding: '20px', backgroundColor: '#fce4ec', borderRadius: '8px', textAlign: 'center' }}>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#c2185b' }}>{bedUtilization}%</div>
                <div style={{ color: '#666', marginTop: '8px' }}>Utilization</div>
              </div>
            </div>
            <div style={{ padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0 }}>Update Available Beds</h3>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <input 
                  type="number" 
                  value={bedUpdateValue} 
                  onChange={(e) => setBedUpdateValue(parseInt(e.target.value) || 0)}
                  min={0}
                  max={stats.totalBeds}
                  style={{ padding: '12px', fontSize: '16px', border: '1px solid #ddd', borderRadius: '8px', width: '120px' }}
                />
                <button 
                  onClick={() => handleUpdateBeds(bedUpdateValue)}
                  style={{ padding: '12px 24px', backgroundColor: '#00875a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}
                >
                  Update Beds
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setBedUpdateValue(Math.max(0, bedUpdateValue - 1))} style={{ padding: '8px 16px', backgroundColor: '#de350b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>-1</button>
                  <button onClick={() => setBedUpdateValue(Math.min(stats.totalBeds, bedUpdateValue + 1))} style={{ padding: '8px 16px', backgroundColor: '#00875a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>+1</button>
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'emergencies' ? (
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Active Emergency Cases</h2>
              <span style={{ background: '#ffebee', color: '#c62828', padding: '8px 16px', borderRadius: '20px', fontWeight: '600' }}>{stats.activeEmergencies} Active</span>
            </div>
            <div>
              {recentBookings.filter(b => b.status !== 'COMPLETED' && b.status !== 'CANCELLED').length > 0 ? (
                recentBookings.filter(b => b.status !== 'COMPLETED' && b.status !== 'CANCELLED').map(booking => (
                  <div key={booking.id} style={{ padding: '16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>{booking.id}</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: booking.type === 'EMERGENCY' ? '#ffebee' : '#e3f2fd', color: booking.type === 'EMERGENCY' ? '#c62828' : '#1565c0', fontSize: '12px' }}>{booking.type}</span>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: booking.severity === 'CRITICAL' ? '#de350b' : booking.severity === 'HIGH' ? '#ff8b00' : '#ffab00', color: 'white', fontSize: '12px' }}>{booking.severity}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: '#e8f5e9', color: '#2e7d32', fontSize: '12px' }}>{booking.status}</div>
                      {booking.eta && <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>ETA: {booking.eta}</div>}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>No active emergency cases</div>
              )}
            </div>
          </div>
        ) : activeTab === 'history' ? (
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>Booking History</h2>
              <span style={{ background: '#e3f2fd', color: '#1976d2', padding: '8px 16px', borderRadius: '20px' }}>{recentBookings.length} Total</span>
            </div>
            <div>
              {recentBookings.length > 0 ? (
                recentBookings.map(booking => (
                  <div key={booking.id} style={{ padding: '16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>{booking.id}</div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: booking.type === 'EMERGENCY' ? '#ffebee' : '#e3f2fd', color: booking.type === 'EMERGENCY' ? '#c62828' : '#1565c0', fontSize: '12px' }}>{booking.type}</span>
                        <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: booking.severity === 'CRITICAL' ? '#de350b' : booking.severity === 'HIGH' ? '#ff8b00' : '#ffab00', color: 'white', fontSize: '12px' }}>{booking.severity}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: booking.status === 'COMPLETED' ? '#e8f5e9' : booking.status === 'CANCELLED' ? '#ffebee' : '#fff3e0', color: booking.status === 'COMPLETED' ? '#2e7d32' : booking.status === 'CANCELLED' ? '#c62828' : '#e65100', fontSize: '12px' }}>{booking.status}</div>
                      <div style={{ marginTop: '4px', fontSize: '12px', color: '#888' }}>{booking.time}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>No booking history</div>
              )}
            </div>
          </div>
        ) : (
        <>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-header">
              <h3>Total Beds</h3>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V7H1v10h22v-6c0-2.21-1.79-4-4-4z"/></svg>
            </div>
            <div className="stat-value">{stats.totalBeds}</div>
            <div className="stat-footer">
              <span className="stat-detail">Available: {stats.availableBeds}</span>
              <span className="stat-detail">Occupied: {stats.occupiedBeds}</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <h3>Bed Utilization</h3>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>
            </div>
            <div className="stat-value">{bedUtilization}%</div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${bedUtilization}%` }}></div>
            </div>
          </div>

          <div className="stat-card highlight">
            <div className="stat-header">
              <h3>Incoming Ambulances</h3>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z"/></svg>
            </div>
            <div className="stat-value">{stats.incomingAmbulances}</div>
            <div className="stat-footer">
              <span className="stat-badge live">EN ROUTE</span>
            </div>
          </div>

          <div className="stat-card highlight">
            <div className="stat-header">
              <h3>Active Emergencies</h3>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2zm0-6h2v4h-2z"/></svg>
            </div>
            <div className="stat-value">{stats.activeEmergencies}</div>
            <div className="stat-footer">
              <span className="stat-badge urgent">URGENT</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <h3>Completed Today</h3>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
            </div>
            <div className="stat-value">{stats.completedToday}</div>
            <div className="stat-footer">
              <span className="stat-detail">Bookings processed</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <h3>Capabilities</h3>
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            </div>
            <div className="stat-value">{capabilities.length}</div>
            <div className="stat-footer">
              <span className="stat-detail">{capabilities.map(c => c.type).join(', ')}</span>
            </div>
          </div>
        </div>

        <div className="content-grid">
          <div className="capabilities-card">
            <div className="card-header">
              <h3>Capability Status Management</h3>
              <span className="help-text">Set individual status for each capability</span>
            </div>
            
            <div className="capabilities-list">
              {capabilities.map(capability => (
                <div key={capability.type} className="capability-item">
                  <div className="capability-info">
                    <div className="capability-name">{capability.name}</div>
                    <div className="capability-type">{capability.type}</div>
                  </div>
                  <div className="capability-status-controls">
                    <button 
                      className={`capability-status-btn accepting ${capability.status === 'ACCEPTING' ? 'active' : ''}`}
                      onClick={() => handleCapabilityStatusChange(capability.type, 'ACCEPTING')}
                    >
                      Accepting
                    </button>
                    <button 
                      className={`capability-status-btn limited ${capability.status === 'LIMITED' ? 'active' : ''}`}
                      onClick={() => handleCapabilityStatusChange(capability.type, 'LIMITED')}
                    >
                      Limited
                    </button>
                    <button 
                      className={`capability-status-btn divert ${capability.status === 'DIVERT' ? 'active' : ''}`}
                      onClick={() => handleCapabilityStatusChange(capability.type, 'DIVERT')}
                    >
                      Divert
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bookings-card">
            <div className="card-header">
              <h3>Recent Bookings</h3>
              <a href="#" className="view-all">View All</a>
            </div>
            
            <div className="bookings-list">
              {recentBookings.map(booking => (
                <div key={booking.id} className={`booking-item severity-${booking.severity.toLowerCase()}`}>
                  <div className="booking-id">{booking.id}</div>
                  <div className="booking-details">
                    <div className="booking-type">
                      <span className={`type-badge ${booking.type.toLowerCase()}`}>{booking.type}</span>
                      <span className={`severity-badge ${booking.severity.toLowerCase()}`}>{booking.severity}</span>
                    </div>
                    <div className="booking-status">
                      <span className={`status-indicator ${booking.status.toLowerCase()}`}></span>
                      {booking.status.replace('_', ' ')}
                    </div>
                  </div>
                  <div className="booking-meta">
                    {booking.eta && <span className="eta">ETA: {booking.eta}</span>}
                    <span className="time-ago">{booking.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
