import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import TokenStorage from '../utils/tokenStorage';
import '../styles/Dashboard.css';
import { BarChart, Bar, PieChart, Pie, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

const API_BASE_URL = 'http://localhost:3000/api';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

interface SystemStats {
  totalUsers: number;
  totalHospitals: number;
  totalAmbulances: number;
  activeBookings: number;
  completedToday: number;
  emergenciesHandled: number;
  avgResponseTime?: number;
  usersByRole?: {
    admin: number;
    hospital: number;
    driver: number;
    user: number;
  };
  activeUsers?: number;
  bookingStats?: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
    completionRate: string;
  };
  ambulanceStats?: {
    total: number;
    available: number;
    busy: number;
    maintenance: number;
    verified: number;
    utilization: string;
  };
  hospitalCapacity?: {
    totalBeds: number;
    availableBeds: number;
    occupiedBeds: number;
    utilization: string;
  };
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
  
  // Filter and Pagination State
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('ALL');
  const [userStatusFilter, setUserStatusFilter] = useState('ALL');
  const [userPage, setUserPage] = useState(1);
  const [userLimit] = useState(10);
  const [totalUsers, setTotalUsers] = useState(0);
  
  const [hospitalSearch, setHospitalSearch] = useState('');
  const [ambulanceSearch, setAmbulanceSearch] = useState('');
  
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
        emergenciesHandled: data.stats?.emergenciesHandled || 0,
        usersByRole: data.stats?.usersByRole,
        bookingStats: data.stats?.bookingStats
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

      // Fetch users separately if not filtered
      if (!userSearch && userRoleFilter === 'ALL' && userStatusFilter === 'ALL') {
        if (data.users) {
          setUsers(data.users.map((u: any) => ({
            id: u.id,
            email: u.email,
            role: u.role,
            isActive: u.isActive,
            createdAt: u.createdAt
          })));
          setTotalUsers(data.users.length);
        }
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

  const fetchFilteredUsers = async () => {
    try {
      const token = TokenStorage.getToken();
      const params = new URLSearchParams();
      params.append('page', userPage.toString());
      params.append('limit', userLimit.toString());
      if (userSearch) params.append('search', userSearch);
      if (userRoleFilter !== 'ALL') params.append('role', userRoleFilter);
      if (userStatusFilter !== 'ALL') params.append('status', userStatusFilter === 'ACTIVE' ? 'true' : 'false');

      const response = await axios.get(`${API_BASE_URL}/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (Array.isArray(response.data)) {
        setUsers(response.data.map((u: any) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt
        })));
        setTotalUsers(response.data.length);
      } else if (response.data.users) {
        setUsers(response.data.users.map((u: any) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt
        })));
        setTotalUsers(response.data.total || response.data.users.length);
      }
    } catch (err) {
      console.error('Failed to fetch filtered users:', err);
    }
  };

  const exportToCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) {
      alert('No data to export');
      return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          const value = row[header];
          const stringValue = value === null || value === undefined ? '' : String(value);
          // Escape commas and quotes
          return stringValue.includes(',') || stringValue.includes('"') 
            ? `"${stringValue.replace(/"/g, '""')}"` 
            : stringValue;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  // Fetch filtered users when filters change
  useEffect(() => {
    if (userSearch || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL' || userPage > 1) {
      fetchFilteredUsers();
    }
  }, [userSearch, userRoleFilter, userStatusFilter, userPage]);

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

  const renderDashboardTab = () => {
    // Prepare data for charts
    const roleChartData = systemStats.usersByRole ? [
      { name: 'Users', count: systemStats.usersByRole.user || 0 },
      { name: 'Drivers', count: systemStats.usersByRole.driver || 0 },
      { name: 'Hospitals', count: systemStats.usersByRole.hospital || 0 },
      { name: 'Admins', count: systemStats.usersByRole.admin || 0 },
    ] : [
      { name: 'Users', count: 0 },
      { name: 'Drivers', count: 0 },
      { name: 'Hospitals', count: 0 },
      { name: 'Admins', count: 0 },
    ];

    const bookingStatusData = systemStats.bookingStats ? [
      { name: 'Active', value: systemStats.bookingStats.active || 0 },
      { name: 'Completed', value: systemStats.bookingStats.completed || 0 },
      { name: 'Cancelled', value: systemStats.bookingStats.cancelled || 0 },
    ] : [
      { name: 'Active', value: systemStats.activeBookings || 0 },
      { name: 'Completed', value: systemStats.completedToday || 0 },
      { name: 'Cancelled', value: 0 },
    ];

    // Mock line chart data (bookings trend over days) - in real scenario, fetch from API
    const bookingsTrendData = [
      { day: 'Mon', bookings: 45 },
      { day: 'Tue', bookings: 52 },
      { day: 'Wed', bookings: 48 },
      { day: 'Thu', bookings: 61 },
      { day: 'Fri', bookings: 55 },
      { day: 'Sat', bookings: 42 },
      { day: 'Sun', bookings: 38 },
    ];

    return (
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

        {/* Chart Visualizations */}
        <div className="charts-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px', marginBottom: '20px' }}>
          <div className="chart-card" style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>Users by Role</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={roleChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#0088FE" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card" style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>Booking Status Distribution</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={bookingStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {bookingStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card" style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', gridColumn: 'span 1' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>Bookings Trend (Last 7 Days)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={bookingsTrendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="bookings" stroke="#8884d8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
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
  };

  const renderUsersTab = () => {
    const startIndex = (userPage - 1) * userLimit;
    const endIndex = Math.min(startIndex + userLimit, users.length);
    const paginatedUsers = users.slice(startIndex, endIndex);
    const totalPages = Math.ceil(totalUsers / userLimit);

    return (
      <div className="management-section">
        <div className="section-header">
          <h2>User Management</h2>
          <span className="count-badge">{totalUsers || users.length} users</span>
        </div>

        {/* Search and Filter Controls */}
        <div className="filter-controls" style={{ marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', background: 'white', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ flex: '1 1 300px' }}>
            <input
              type="text"
              placeholder="🔍 Search by name, email, or phone..."
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value);
                setUserPage(1);
              }}
              style={{ 
                width: '100%', 
                padding: '10px 16px', 
                border: '2px solid #e0e0e0', 
                borderRadius: '8px',
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#0066cc'}
              onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
            />
          </div>
          
          <select
            value={userRoleFilter}
            onChange={(e) => {
              setUserRoleFilter(e.target.value);
              setUserPage(1);
            }}
            style={{ 
              padding: '10px 16px', 
              border: '2px solid #e0e0e0', 
              borderRadius: '8px',
              fontSize: '14px',
              cursor: 'pointer',
              background: 'white'
            }}
          >
            <option value="ALL">All Roles</option>
            <option value="USER">User</option>
            <option value="DRIVER">Driver</option>
            <option value="HOSPITAL">Hospital</option>
            <option value="ADMIN">Admin</option>
          </select>

          <select
            value={userStatusFilter}
            onChange={(e) => {
              setUserStatusFilter(e.target.value);
              setUserPage(1);
            }}
            style={{ 
              padding: '10px 16px', 
              border: '2px solid #e0e0e0', 
              borderRadius: '8px',
              fontSize: '14px',
              cursor: 'pointer',
              background: 'white'
            }}
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>

          <button
            onClick={() => exportToCSV(users, 'users')}
            style={{
              padding: '10px 20px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'transform 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <span>📥</span> Export CSV
          </button>

          {(userSearch || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL') && (
            <button
              onClick={() => {
                setUserSearch('');
                setUserRoleFilter('ALL');
                setUserStatusFilter('ALL');
                setUserPage(1);
              }}
              style={{
                padding: '10px 20px',
                background: '#f5f5f5',
                color: '#666',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Clear Filters
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>Loading users...</div>
            <div style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #0066cc', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }}></div>
          </div>
        ) : paginatedUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
            <div style={{ fontSize: '18px', color: '#666', marginBottom: '8px' }}>No users found</div>
            <div style={{ fontSize: '14px', color: '#999' }}>Try adjusting your search or filter criteria</div>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table enhanced-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUsers.map(user => (
                    <tr key={user.id} className="table-row-hover">
                      <td>{user.email}</td>
                      <td>
                        <select 
                          value={user.role} 
                          onChange={(e) => handleUpdateUserRole(user.id, e.target.value)} 
                          style={{ 
                            padding: '8px 12px', 
                            borderRadius: '6px',
                            border: '2px solid #e0e0e0',
                            cursor: 'pointer',
                            fontSize: '14px'
                          }}
                        >
                          <option value="USER">USER</option>
                          <option value="DRIVER">DRIVER</option>
                          <option value="HOSPITAL">HOSPITAL</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </td>
                      <td>
                        <span className={`status-badge ${user.isActive ? 'status-active' : 'status-inactive'}`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button 
                          onClick={() => handleUpdateUserStatus(user.id, !user.isActive)} 
                          className={`action-btn ${user.isActive ? 'action-btn-danger' : 'action-btn-success'}`}
                        >
                          {user.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="pagination-controls" style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginTop: '20px',
              padding: '16px',
              background: 'white',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <div style={{ color: '#666', fontSize: '14px' }}>
                Showing {startIndex + 1}-{endIndex} of {totalUsers || users.length}
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setUserPage(Math.max(1, userPage - 1))}
                  disabled={userPage === 1}
                  style={{
                    padding: '8px 16px',
                    background: userPage === 1 ? '#f5f5f5' : '#0066cc',
                    color: userPage === 1 ? '#999' : 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: userPage === 1 ? 'not-allowed' : 'pointer',
                    fontWeight: '600',
                    fontSize: '14px'
                  }}
                >
                  ← Previous
                </button>
                
                <div style={{ 
                  padding: '8px 16px', 
                  background: '#f5f5f5', 
                  borderRadius: '6px',
                  fontWeight: '600',
                  fontSize: '14px'
                }}>
                  Page {userPage} of {totalPages || 1}
                </div>
                
                <button
                  onClick={() => setUserPage(Math.min(totalPages, userPage + 1))}
                  disabled={userPage >= totalPages}
                  style={{
                    padding: '8px 16px',
                    background: userPage >= totalPages ? '#f5f5f5' : '#0066cc',
                    color: userPage >= totalPages ? '#999' : 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: userPage >= totalPages ? 'not-allowed' : 'pointer',
                    fontWeight: '600',
                    fontSize: '14px'
                  }}
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderHospitalsTab = () => {
    const filteredHospitals = hospitals.filter(hospital =>
      hospital.name.toLowerCase().includes(hospitalSearch.toLowerCase())
    );

    return (
      <div className="management-section">
        <div className="section-header">
          <h2>Hospital Management</h2>
          <span className="count-badge">{filteredHospitals.length} hospitals</span>
        </div>

        {/* Search Control */}
        <div className="filter-controls" style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center', background: 'white', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ flex: '1 1 300px' }}>
            <input
              type="text"
              placeholder="🔍 Search by hospital name..."
              value={hospitalSearch}
              onChange={(e) => setHospitalSearch(e.target.value)}
              style={{ 
                width: '100%', 
                padding: '10px 16px', 
                border: '2px solid #e0e0e0', 
                borderRadius: '8px',
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#0066cc'}
              onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
            />
          </div>
          
          {hospitalSearch && (
            <button
              onClick={() => setHospitalSearch('')}
              style={{
                padding: '10px 20px',
                background: '#f5f5f5',
                color: '#666',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Clear Search
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>Loading hospitals...</div>
            <div style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #0066cc', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }}></div>
          </div>
        ) : filteredHospitals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏥</div>
            <div style={{ fontSize: '18px', color: '#666', marginBottom: '8px' }}>No hospitals found</div>
            <div style={{ fontSize: '14px', color: '#999' }}>Try adjusting your search criteria</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table enhanced-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th>Beds (Available/Total)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredHospitals.map(hospital => (
                  <tr key={hospital.id} className="table-row-hover">
                    <td><strong>{hospital.name}</strong></td>
                    <td>{hospital.address}</td>
                    <td>
                      <span className={`status-badge status-${hospital.status.toLowerCase()}`}>
                        {hospital.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: '600', color: hospital.availableBeds > 10 ? '#00875a' : '#de350b' }}>
                          {hospital.availableBeds}
                        </span> / {hospital.totalBeds}
                        <div style={{ 
                          width: '60px', 
                          height: '6px', 
                          background: '#e0e0e0', 
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}>
                          <div style={{ 
                            width: `${(hospital.availableBeds / hospital.totalBeds) * 100}%`, 
                            height: '100%', 
                            background: hospital.availableBeds > 10 ? '#00875a' : '#de350b',
                            transition: 'width 0.3s'
                          }}></div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <select 
                        value={hospital.status} 
                        onChange={(e) => handleUpdateHospitalStatus(hospital.id, e.target.value)} 
                        style={{ 
                          padding: '8px 12px', 
                          borderRadius: '6px',
                          border: '2px solid #e0e0e0',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
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
        )}
      </div>
    );
  };

  const renderAmbulancesTab = () => {
    const filteredAmbulances = ambulances.filter(ambulance =>
      ambulance.vehicleNumber.toLowerCase().includes(ambulanceSearch.toLowerCase())
    );

    return (
      <div className="management-section">
        <div className="section-header">
          <h2>Ambulance Management</h2>
          <span className="count-badge">{filteredAmbulances.length} ambulances</span>
        </div>

        {/* Search Control */}
        <div className="filter-controls" style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center', background: 'white', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ flex: '1 1 300px' }}>
            <input
              type="text"
              placeholder="🔍 Search by vehicle number..."
              value={ambulanceSearch}
              onChange={(e) => setAmbulanceSearch(e.target.value)}
              style={{ 
                width: '100%', 
                padding: '10px 16px', 
                border: '2px solid #e0e0e0', 
                borderRadius: '8px',
                fontSize: '14px',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#0066cc'}
              onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
            />
          </div>
          
          {ambulanceSearch && (
            <button
              onClick={() => setAmbulanceSearch('')}
              style={{
                padding: '10px 20px',
                background: '#f5f5f5',
                color: '#666',
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Clear Search
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            <div style={{ fontSize: '18px', marginBottom: '8px' }}>Loading ambulances...</div>
            <div style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #0066cc', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }}></div>
          </div>
        ) : filteredAmbulances.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚑</div>
            <div style={{ fontSize: '18px', color: '#666', marginBottom: '8px' }}>No ambulances found</div>
            <div style={{ fontSize: '14px', color: '#999' }}>Try adjusting your search criteria</div>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table enhanced-table">
              <thead>
                <tr>
                  <th>Vehicle Number</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAmbulances.map(ambulance => (
                  <tr key={ambulance.id} className="table-row-hover">
                    <td><strong>{ambulance.vehicleNumber}</strong></td>
                    <td>
                      <span style={{ 
                        padding: '4px 10px', 
                        background: '#f0f0f0', 
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '500'
                      }}>
                        {ambulance.vehicleType}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge status-${ambulance.status.toLowerCase()}`}>
                        {ambulance.status}
                      </span>
                    </td>
                    <td>
                      <select 
                        value={ambulance.status} 
                        onChange={(e) => handleUpdateAmbulanceStatus(ambulance.id, e.target.value)} 
                        style={{ 
                          padding: '8px 12px', 
                          borderRadius: '6px',
                          border: '2px solid #e0e0e0',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
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
        )}
      </div>
    );
  };

  const renderBookingsTab = () => (
    <div className="management-section">
      <div className="section-header">
        <h2>Booking Management</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span className="count-badge">{bookings.length} bookings</span>
          <button
            onClick={() => exportToCSV(bookings, 'bookings')}
            style={{
              padding: '8px 16px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'transform 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <span>📥</span> Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
          <div style={{ fontSize: '18px', marginBottom: '8px' }}>Loading bookings...</div>
          <div style={{ width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid #0066cc', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }}></div>
        </div>
      ) : bookings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
          <div style={{ fontSize: '18px', color: '#666', marginBottom: '8px' }}>No bookings found</div>
          <div style={{ fontSize: '14px', color: '#999' }}>All bookings will appear here</div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table enhanced-table">
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Status</th>
                <th>Severity</th>
                <th>Pickup Address</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(booking => (
                <tr key={booking.id} className="table-row-hover">
                  <td><code style={{ background: '#f0f0f0', padding: '4px 8px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '13px' }}>{booking.id.slice(0, 8)}</code></td>
                  <td>
                    <span className={`status-badge status-${booking.status.toLowerCase().replace('_', '-')}`}>
                      {booking.status}
                    </span>
                  </td>
                  <td>
                    <span className={`severity-badge severity-${(booking.severity || 'MEDIUM').toLowerCase()}`}>
                      {booking.severity || 'MEDIUM'}
                    </span>
                  </td>
                  <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {booking.pickupAddress || 'N/A'}
                  </td>
                  <td>{new Date(booking.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
        .data-table code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
        
        /* Enhanced Table Styling */
        .enhanced-table tbody tr { transition: all 0.2s ease; }
        .table-row-hover:hover { 
          background: linear-gradient(to right, #f0f7ff 0%, #ffffff 100%);
          transform: translateX(4px);
          box-shadow: -4px 0 0 #0066cc;
        }
        
        /* Status Badges with Better Colors */
        .status-badge {
          padding: 6px 14px;
          border-radius: 16px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          display: inline-block;
        }
        
        .status-active, .status-available, .status-accepting {
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
          color: white;
        }
        
        .status-inactive, .status-offline, .status-divert {
          background: linear-gradient(135deg, #de350b 0%, #ff6b6b 100%);
          color: white;
        }
        
        .status-busy, .status-limited, .status-in-progress {
          background: linear-gradient(135deg, #ff8b00 0%, #ffc837 100%);
          color: white;
        }
        
        .status-maintenance {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .status-completed {
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
          color: white;
        }
        
        .status-cancelled {
          background: linear-gradient(135deg, #de350b 0%, #ff6b6b 100%);
          color: white;
        }
        
        /* Severity Badges */
        .severity-badge {
          padding: 6px 14px;
          border-radius: 16px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          display: inline-block;
        }
        
        .severity-critical {
          background: linear-gradient(135deg, #de350b 0%, #ff0000 100%);
          color: white;
          animation: pulse 2s infinite;
        }
        
        .severity-high {
          background: linear-gradient(135deg, #ff8b00 0%, #ffc837 100%);
          color: white;
        }
        
        .severity-medium {
          background: linear-gradient(135deg, #0066cc 0%, #4a90e2 100%);
          color: white;
        }
        
        .severity-low {
          background: linear-gradient(135deg, #6b778c 0%, #97a0af 100%);
          color: white;
        }
        
        /* Action Buttons */
        .action-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .action-btn-danger {
          background: linear-gradient(135deg, #de350b 0%, #ff6b6b 100%);
          color: white;
        }
        
        .action-btn-danger:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(222, 53, 11, 0.3);
        }
        
        .action-btn-success {
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
          color: white;
        }
        
        .action-btn-success:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(17, 153, 142, 0.3);
        }
        
        /* Loading Animation */
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
        
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
