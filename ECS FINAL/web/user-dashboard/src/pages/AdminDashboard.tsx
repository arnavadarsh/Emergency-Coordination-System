import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TokenStorage from '../utils/tokenStorage';
import '../styles/AdminDashboard.css';

const API_BASE_URL = 'http://localhost:3000/api';

interface SystemStats {
  totalUsers: number;
  totalHospitals: number;
  totalAmbulances: number;
  activeBookings: number;
  completedToday: number;
  emergenciesHandled: number;
}

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  actor: string;
  timestamp: string;
}

interface User {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface Hospital {
  id: string;
  name: string;
  address: string;
  status: string;
  totalBeds: number;
  availableBeds: number;
}

interface Ambulance {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  status: string;
  equipmentList?: any;
}

interface PendingAmbulance {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  driverName: string;
  driverPhone: string;
  driverLicense: string;
  locationAddress: string;
  equipment: string[];
  createdAt: string;
}

interface Booking {
  id: string;
  status: string;
  severity: string;
  pickupAddress: string;
  createdAt: string;
}

type TabType = 'dashboard' | 'users' | 'hospitals' | 'ambulances' | 'pending' | 'bookings' | 'audit';

const Dashboard = () => {
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  
  const [systemStats, setSystemStats] = useState<SystemStats>({
    totalUsers: 0,
    totalHospitals: 0,
    totalAmbulances: 0,
    activeBookings: 0,
    completedToday: 0,
    emergenciesHandled: 0
  });
  const [recentAudit, setRecentAudit] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [ambulances, setAmbulances] = useState<Ambulance[]>([]);
  const [pendingAmbulances, setPendingAmbulances] = useState<PendingAmbulance[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

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

  const fetchDashboardData = async () => {
    try {
      const token = TokenStorage.getToken();
      const response = await axios.get(`${API_BASE_URL}/dashboard/admin`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = response.data;
      
      setSystemStats({
        totalUsers: data.stats?.totalUsers || 0,
        totalHospitals: data.stats?.totalHospitals || 0,
        totalAmbulances: data.stats?.totalAmbulances || 0,
        activeBookings: data.stats?.activeBookings || 0,
        completedToday: data.stats?.completedToday || 0,
        emergenciesHandled: data.stats?.emergenciesHandled || 0
      });
      
      if (data.recentAudit && data.recentAudit.length > 0) {
        setRecentAudit(data.recentAudit.map((log: any) => ({
          id: log.id || `AUD-${Math.random().toString(36).substr(2, 4)}`,
          action: log.action || 'UNKNOWN',
          entity: log.entityType || log.entity || 'Unknown',
          entityId: log.entityId || 'N/A',
          actor: log.actorEmail || log.actor || 'SYSTEM',
          timestamp: formatTimeAgo(log.createdAt || log.timestamp)
        })));
      }

      if (data.users) {
        setUsers(data.users.map((u: any) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt
        })));
      }

      if (data.hospitals) {
        setHospitals(data.hospitals.map((h: any) => ({
          id: h.id,
          name: h.name,
          address: h.address,
          status: h.status,
          totalBeds: h.totalBeds,
          availableBeds: h.availableBeds
        })));
      }

      if (data.ambulances) {
        setAmbulances(data.ambulances.map((a: any) => ({
          id: a.id,
          vehicleNumber: a.vehicleNumber,
          vehicleType: a.vehicleType,
          status: a.status,
          equipmentList: a.equipmentList
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

  const fetchBookings = async () => {
    try {
      const token = TokenStorage.getToken();
      const response = await axios.get(`${API_BASE_URL}/bookings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBookings(response.data.map((b: any) => ({
        id: b.id,
        status: b.status,
        severity: b.severity,
        pickupAddress: b.pickupAddress,
        createdAt: b.createdAt
      })));
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    }
  };

  const fetchPendingAmbulances = async () => {
    try {
      const token = TokenStorage.getToken();
      const response = await axios.get(`${API_BASE_URL}/ambulances/pending`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPendingAmbulances(response.data.map((a: any) => ({
        id: a.id,
        vehicleNumber: a.vehicleNumber,
        vehicleType: a.vehicleType,
        driverName: a.equipmentList?.driverName || 'N/A',
        driverPhone: a.equipmentList?.driverPhone || 'N/A',
        driverLicense: a.equipmentList?.driverLicense || 'N/A',
        locationAddress: a.equipmentList?.locationAddress || 'N/A',
        equipment: a.equipmentList?.equipment || [],
        createdAt: a.createdAt
      })));
    } catch (err) {
      console.error('Failed to fetch pending ambulances:', err);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    fetchBookings();
    fetchPendingAmbulances();
    
    const refreshInterval = setInterval(() => {
      fetchDashboardData();
      fetchBookings();
      fetchPendingAmbulances();
    }, 30000);
    
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
    navigate('/');
  };

  const handleVerifyAmbulance = async (ambulanceId: string) => {
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/ambulances/${ambulanceId}/verify`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchPendingAmbulances();
      await fetchDashboardData();
      alert('Ambulance verified successfully!');
    } catch (err) {
      console.error('Failed to verify ambulance:', err);
      alert('Failed to verify ambulance');
    }
  };

  const handleRejectAmbulance = async (ambulanceId: string) => {
    if (!window.confirm('Are you sure you want to reject this registration?')) return;
    try {
      const token = TokenStorage.getToken();
      await axios.delete(
        `${API_BASE_URL}/ambulances/${ambulanceId}/reject`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchPendingAmbulances();
      alert('Ambulance registration rejected');
    } catch (err) {
      console.error('Failed to reject ambulance:', err);
      alert('Failed to reject ambulance');
    }
  };

  const handleUpdateUserStatus = async (userId: string, isActive: boolean) => {
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/users/${userId}/status`,
        { isActive },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to update user status:', err);
      alert('Failed to update user status');
    }
  };

  const handleUpdateUserRole = async (userId: string, role: string) => {
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/users/${userId}/role`,
        { role },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to update user role:', err);
      alert('Failed to update user role');
    }
  };

  const handleUpdateHospitalStatus = async (hospitalId: string, status: string) => {
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/hospitals/${hospitalId}/status`,
        { status },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to update hospital status:', err);
      alert('Failed to update hospital status');
    }
  };

  const handleUpdateAmbulanceStatus = async (ambulanceId: string, status: string) => {
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/ambulances/${ambulanceId}/status`,
        { status },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to update ambulance status:', err);
      alert('Failed to update ambulance status');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': case 'AVAILABLE': case 'ACCEPTING': return '#00875a';
      case 'INACTIVE': case 'OFFLINE': case 'DIVERT': return '#de350b';
      case 'BUSY': case 'LIMITED': case 'IN_PROGRESS': return '#ff8b00';
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

  const renderDashboardTab = () => (
    <>
      <div className="stats-grid">
        <div className="stat-card" onClick={() => setActiveTab('users')} style={{ cursor: 'pointer' }}>
          <div className="stat-header">
            <h3>Total Users</h3>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3z"/></svg>
          </div>
          <div className="stat-value">{systemStats.totalUsers}</div>
          <div className="stat-footer"><span className="stat-detail">Click to manage</span></div>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('hospitals')} style={{ cursor: 'pointer' }}>
          <div className="stat-header">
            <h3>Hospitals</h3>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z"/></svg>
          </div>
          <div className="stat-value">{systemStats.totalHospitals}</div>
          <div className="stat-footer"><span className="stat-detail">Click to manage</span></div>
        </div>
        <div className="stat-card" onClick={() => setActiveTab('ambulances')} style={{ cursor: 'pointer' }}>
          <div className="stat-header">
            <h3>Ambulances</h3>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z"/></svg>
          </div>
          <div className="stat-value">{systemStats.totalAmbulances}</div>
          <div className="stat-footer"><span className="stat-detail">Click to manage</span></div>
        </div>
        <div className="stat-card highlight" onClick={() => setActiveTab('bookings')} style={{ cursor: 'pointer' }}>
          <div className="stat-header">
            <h3>Active Bookings</h3>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          </div>
          <div className="stat-value">{systemStats.activeBookings}</div>
          <div className="stat-footer"><span className="stat-badge active">Click to view</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <h3>Completed Today</h3>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
          </div>
          <div className="stat-value">{systemStats.completedToday}</div>
          <div className="stat-footer"><span className="stat-detail">Successful transports</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-header">
            <h3>Emergencies</h3>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 16h2v2h-2zm0-6h2v4h-2z"/></svg>
          </div>
          <div className="stat-value">{systemStats.emergenciesHandled}</div>
          <div className="stat-footer"><span className="stat-detail">Handled today</span></div>
        </div>
      </div>
      <div className="content-grid">
        <div className="audit-card">
          <div className="card-header">
            <h3>Recent Audit Logs</h3>
            <button onClick={() => setActiveTab('audit')} className="view-all" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0066cc' }}>View All</button>
          </div>
          <div className="audit-list">
            {recentAudit.length > 0 ? recentAudit.slice(0, 5).map(log => (
              <div key={log.id} className="audit-item">
                <div className="audit-id">{String(log.id).slice(0, 8)}</div>
                <div className="audit-details">
                  <div className="audit-action">
                    <span className="action-badge">{log.action}</span>
                    <span className="entity-info">{log.entity}: {String(log.entityId).slice(0, 8)}</span>
                  </div>
                  <div className="audit-actor">Actor: {log.actor}</div>
                </div>
                <div className="audit-time">{log.timestamp}</div>
              </div>
            )) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No recent audit logs</div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const renderUsersTab = () => (
    <div className="management-section">
      <div className="section-header"><h2>User Management</h2><span className="count-badge">{users.length} users</span></div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.email}</td>
                <td>
                  <select value={user.role} onChange={(e) => handleUpdateUserRole(user.id, e.target.value)} style={{ padding: '4px 8px', borderRadius: '4px' }}>
                    <option value="USER">USER</option>
                    <option value="DRIVER">DRIVER</option>
                    <option value="HOSPITAL">HOSPITAL</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td><span style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: user.isActive ? '#e3fcef' : '#ffebe6', color: user.isActive ? '#00875a' : '#de350b' }}>{user.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                <td><button onClick={() => handleUpdateUserStatus(user.id, !user.isActive)} style={{ padding: '6px 12px', backgroundColor: user.isActive ? '#de350b' : '#00875a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{user.isActive ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderHospitalsTab = () => (
    <div className="management-section">
      <div className="section-header"><h2>Hospital Management</h2><span className="count-badge">{hospitals.length} hospitals</span></div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Address</th><th>Status</th><th>Beds (Available/Total)</th><th>Actions</th></tr></thead>
          <tbody>
            {hospitals.map(hospital => (
              <tr key={hospital.id}>
                <td><strong>{hospital.name}</strong></td>
                <td>{hospital.address}</td>
                <td><span style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: getStatusColor(hospital.status) + '20', color: getStatusColor(hospital.status) }}>{hospital.status}</span></td>
                <td>{hospital.availableBeds} / {hospital.totalBeds}</td>
                <td>
                  <select value={hospital.status} onChange={(e) => handleUpdateHospitalStatus(hospital.id, e.target.value)} style={{ padding: '6px 12px', borderRadius: '4px' }}>
                    <option value="ACCEPTING">ACCEPTING</option>
                    <option value="LIMITED">LIMITED</option>
                    <option value="DIVERT">DIVERT</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderAmbulancesTab = () => (
    <div className="management-section">
      <div className="section-header"><h2>Ambulance Management</h2><span className="count-badge">{ambulances.length} ambulances</span></div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Vehicle Number</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {ambulances.map(ambulance => (
              <tr key={ambulance.id}>
                <td><strong>{ambulance.vehicleNumber}</strong></td>
                <td>{ambulance.vehicleType}</td>
                <td><span style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: getStatusColor(ambulance.status) + '20', color: getStatusColor(ambulance.status) }}>{ambulance.status}</span></td>
                <td>
                  <select value={ambulance.status} onChange={(e) => handleUpdateAmbulanceStatus(ambulance.id, e.target.value)} style={{ padding: '6px 12px', borderRadius: '4px' }}>
                    <option value="AVAILABLE">AVAILABLE</option>
                    <option value="BUSY">BUSY</option>
                    <option value="OFFLINE">OFFLINE</option>
                    <option value="MAINTENANCE">MAINTENANCE</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderBookingsTab = () => (
    <div className="management-section">
      <div className="section-header"><h2>Booking Management</h2><span className="count-badge">{bookings.length} bookings</span></div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Booking ID</th><th>Status</th><th>Severity</th><th>Pickup Address</th><th>Created</th></tr></thead>
          <tbody>
            {bookings.map(booking => (
              <tr key={booking.id}>
                <td><code>{booking.id.slice(0, 8)}</code></td>
                <td><span style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: getStatusColor(booking.status) + '20', color: getStatusColor(booking.status) }}>{booking.status}</span></td>
                <td><span style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: booking.severity === 'CRITICAL' ? '#de350b20' : booking.severity === 'HIGH' ? '#ff8b0020' : '#ffab0020', color: booking.severity === 'CRITICAL' ? '#de350b' : booking.severity === 'HIGH' ? '#ff8b00' : '#ffab00' }}>{booking.severity || 'MEDIUM'}</span></td>
                <td>{booking.pickupAddress || 'N/A'}</td>
                <td>{new Date(booking.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderAuditTab = () => (
    <div className="management-section">
      <div className="section-header"><h2>Audit Logs</h2><span className="count-badge">{recentAudit.length} logs</span></div>
      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Log ID</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Actor</th><th>Time</th></tr></thead>
          <tbody>
            {recentAudit.map(log => (
              <tr key={log.id}>
                <td><code>{String(log.id).slice(0, 8)}</code></td>
                <td><span style={{ padding: '4px 12px', borderRadius: '12px', backgroundColor: '#0066cc20', color: '#0066cc' }}>{log.action}</span></td>
                <td>{log.entity}</td>
                <td><code>{String(log.entityId).slice(0, 8)}</code></td>
                <td>{log.actor}</td>
                <td>{log.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPendingTab = () => (
    <div className="management-section">
      <div className="section-header">
        <h2>Pending Verifications</h2>
        <span className="count-badge" style={{ background: pendingAmbulances.length > 0 ? '#fff3e0' : '#e3f2fd', color: pendingAmbulances.length > 0 ? '#f57c00' : '#1976d2' }}>
          {pendingAmbulances.length} pending
        </span>
      </div>
      {pendingAmbulances.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
          <div style={{ fontSize: '18px' }}>No pending verifications</div>
          <div style={{ fontSize: '14px', marginTop: '8px' }}>All ambulance registrations have been reviewed</div>
        </div>
      ) : (
        <div className="pending-cards">
          {pendingAmbulances.map(ambulance => (
            <div key={ambulance.id} className="pending-card">
              <div className="pending-header">
                <div className="pending-vehicle">
                  <span className="vehicle-icon">🚑</span>
                  <div>
                    <strong>{ambulance.vehicleNumber}</strong>
                    <span className="vehicle-type">{ambulance.vehicleType}</span>
                  </div>
                </div>
                <span className="pending-badge">PENDING</span>
              </div>
              
              <div className="pending-details">
                <div className="detail-row">
                  <span className="detail-label">Driver Name</span>
                  <span className="detail-value">{ambulance.driverName}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Phone</span>
                  <span className="detail-value">{ambulance.driverPhone}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">License</span>
                  <span className="detail-value">{ambulance.driverLicense}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Location</span>
                  <span className="detail-value">{ambulance.locationAddress}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Equipment</span>
                  <span className="detail-value equipment-list">
                    {ambulance.equipment.length > 0 ? ambulance.equipment.join(', ') : 'None specified'}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Submitted</span>
                  <span className="detail-value">{new Date(ambulance.createdAt).toLocaleString()}</span>
                </div>
              </div>
              
              <div className="pending-actions">
                <button className="verify-btn" onClick={() => handleVerifyAmbulance(ambulance.id)}>
                  ✓ Verify & Approve
                </button>
                <button className="reject-btn" onClick={() => handleRejectAmbulance(ambulance.id)}>
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'users': return renderUsersTab();
      case 'hospitals': return renderHospitalsTab();
      case 'ambulances': return renderAmbulancesTab();
      case 'pending': return renderPendingTab();
      case 'bookings': return renderBookingsTab();
      case 'audit': return renderAuditTab();
      default: return renderDashboardTab();
    }
  };

  const getTabTitle = () => {
    switch (activeTab) {
      case 'users': return 'User Management';
      case 'hospitals': return 'Hospital Management';
      case 'ambulances': return 'Ambulance Management';
      case 'pending': return 'Pending Verifications';
      case 'bookings': return 'Booking Management';
      case 'audit': return 'Audit Logs';
      default: return 'System Overview';
    }
  };

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 10h7c-.53 4.12-3.28 7.79-7 8.94V12H5V9h7V4.21l7 3.5V12z"/>
            </svg>
          </div>
          <h2>Admin Portal</h2>
          <div className="admin-badge">ADMINISTRATOR</div>
        </div>
        
        <nav className="sidebar-nav">
          <a href="#" className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('dashboard'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
            Dashboard
          </a>
          <a href="#" className={`nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('users'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            Users
          </a>
          <a href="#" className={`nav-item ${activeTab === 'hospitals' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('hospitals'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z"/></svg>
            Hospitals
          </a>
          <a href="#" className={`nav-item ${activeTab === 'ambulances' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('ambulances'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z"/></svg>
            Ambulances
          </a>
          <a href="#" className={`nav-item ${activeTab === 'pending' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('pending'); }} style={{ position: 'relative' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
            Pending Verifications
            {pendingAmbulances.length > 0 && (
              <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: '#f57c00', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold' }}>
                {pendingAmbulances.length}
              </span>
            )}
          </a>
          <a href="#" className={`nav-item ${activeTab === 'bookings' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('bookings'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
            Bookings
          </a>
          <a href="#" className={`nav-item ${activeTab === 'audit' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setActiveTab('audit'); }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>
            Audit Logs
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
            <h1>{getTabTitle()}</h1>
            <div className="time">{currentTime.toLocaleString('en-US', { 
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', 
              hour: '2-digit', minute: '2-digit' 
            })}</div>
          </div>
          <div className="top-bar-right">
            <div className="system-status">
              <span className="status-dot online"></span>
              All Systems Operational
            </div>
          </div>
        </div>

        {renderContent()}
      </main>

      <style>{`
        .management-section { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
        .section-header h2 { margin: 0; font-size: 20px; }
        .count-badge { background: #e3f2fd; color: #1976d2; padding: 4px 12px; border-radius: 12px; font-size: 14px; }
        .table-container { overflow-x: auto; }
        .data-table { width: 100%; border-collapse: collapse; }
        .data-table th, .data-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e0e0e0; }
        .data-table th { background: #f5f5f5; font-weight: 600; color: #333; }
        .data-table tr:hover { background: #fafafa; }
        .data-table code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
        
        .pending-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
        .pending-card { background: #fafafa; border: 2px solid #e0e0e0; border-radius: 12px; overflow: hidden; transition: all 0.3s; }
        .pending-card:hover { border-color: #f57c00; box-shadow: 0 4px 12px rgba(245, 124, 0, 0.15); }
        .pending-header { display: flex; justify-content: space-between; align-items: center; padding: 16px; background: white; border-bottom: 1px solid #e0e0e0; }
        .pending-vehicle { display: flex; align-items: center; gap: 12px; }
        .vehicle-icon { font-size: 32px; }
        .pending-vehicle strong { display: block; font-size: 18px; color: #333; }
        .vehicle-type { font-size: 13px; color: #666; background: #e0e0e0; padding: 2px 8px; border-radius: 4px; }
        .pending-badge { background: #fff3e0; color: #f57c00; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
        .pending-details { padding: 16px; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { font-size: 13px; color: #888; }
        .detail-value { font-size: 14px; color: #333; font-weight: 500; text-align: right; max-width: 60%; }
        .equipment-list { font-size: 12px; line-height: 1.4; }
        .pending-actions { display: flex; gap: 12px; padding: 16px; background: white; border-top: 1px solid #e0e0e0; }
        .verify-btn { flex: 1; padding: 12px; background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .verify-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(17, 153, 142, 0.3); }
        .reject-btn { flex: 1; padding: 12px; background: white; color: #de350b; border: 2px solid #de350b; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .reject-btn:hover { background: #de350b; color: white; }
      `}</style>
    </div>
  );
};

export default Dashboard;
