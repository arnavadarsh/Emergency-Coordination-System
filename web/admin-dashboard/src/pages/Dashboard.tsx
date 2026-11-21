import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import TokenStorage from '../utils/tokenStorage';
import '../styles/Dashboard.css';
import { formatIstClock, formatIstDate, formatIstDateTime, formatIstFull, formatTimeAgo } from '@shared/utils/datetime';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import CreateAccountModal from '../components/CreateAccountModal';
import DispatchQueue from '../components/admin/DispatchQueue';
import { adminApi, errorText, type AdminAmbulance, type AdminHospital } from '../services/adminApi';
import { normalizeMedicalProfile, type MedicalProfile } from '@shared/types/medicalProfile';
import { API_BASE_URL, SOCKET_URL } from '../config/api';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { Badge, SeverityBadge, StatusBadge, TONE_COLOR, toneClass, type Tone } from '@shared/components/ui/Status';
import { AnimatedNumber, BrandMark, EmptyState, PageError, PageLoading } from '@shared/components/ui/primitives';
import { Modal } from '@shared/components/ui/Modal';
import { NoticeStack, useNotices } from '@shared/components/ui/Notices';


// Loaded on first use: the map pulls in Leaflet, and most visits never open
// either of these.
const OperationsMap = lazy(() => import('../components/OperationsMap'));
const CaseReportModal = lazy(() => import('../components/CaseReportModal'));
// The admin controls are loaded the first time one is opened.
const UserManageModal = lazy(() => import('../components/admin/UserManageModal'));
const HospitalFormModal = lazy(() => import('../components/admin/HospitalFormModal'));
const AmbulanceFormModal = lazy(() => import('../components/admin/AmbulanceFormModal'));
const CaseControlModal = lazy(() => import('../components/admin/CaseControlModal'));
const SystemPanel = lazy(() => import('../components/admin/SystemPanel'));
const AuditPanel = lazy(() => import('../components/admin/AuditPanel'));

// Changes arrive over the socket as they happen. This slow poll only catches
// anything missed while the connection was down.
const FALLBACK_REFRESH_MS = 5 * 60_000;

// Chart colours come from the design system: one brand hue for single-series
// charts, and the badge tones for booking states so a chart and a badge agree.
const CHART = {
  series: '#0891b2',
  grid: '#e2e8f0',
  tick: '#64748b',
};

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
  /** Patient's Medical Profile — carried on the row so it exports with the user report. */
  medicalProfile: MedicalProfile;
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
  patientName: string;
  patientPhone: string | null;
  /** Patient's Medical Profile, resolved live so exports carry the latest values. */
  medicalProfile: MedicalProfile;
}

type TabType = 'dashboard' | 'map' | 'users' | 'hospitals' | 'ambulances' | 'pending' | 'bookings' | 'audit' | 'system';

/** The signed-in admin's own id, read from the token, so the console can stop them locking themselves out. */
const currentAdminId = (): string | null => {
  try {
    const payload = (TokenStorage.getToken() ?? '').split('.')[1];
    return payload ? JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null : null;
  } catch {
    return null;
  }
};

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
  // Booking whose full ECS case report (patient, Medical Profile, triage,
  // dispatch) is open. Null when the report modal is closed.
  const [reportBookingId, setReportBookingId] = useState<string | null>(null);
  
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
  // Presentation only: mobile drawer, the registration awaiting a reject
  // confirmation, and in-page notices in place of window.alert().
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PendingAmbulance | null>(null);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [manageUserId, setManageUserId] = useState<string | null>(null);
  const [hospitalForm, setHospitalForm] = useState<AdminHospital | 'new' | null>(null);
  const [ambulanceForm, setAmbulanceForm] = useState<AdminAmbulance | 'new' | null>(null);
  const [caseControlId, setCaseControlId] = useState<string | null>(null);
  // Full records (capabilities, staff, linked drivers, current trip) for the edit dialogs.
  const [adminHospitals, setAdminHospitals] = useState<AdminHospital[]>([]);
  const [adminAmbulances, setAdminAmbulances] = useState<AdminAmbulance[]>([]);
  // Bumped on every live event, so panels that fetch their own data refetch.
  const [liveTick, setLiveTick] = useState(0);
  const { notices, notify, dismiss } = useNotices();

  const fetchFleetDetails = async () => {
    try {
      const [h, a] = await Promise.all([adminApi.listHospitals(), adminApi.listAmbulances()]);
      setAdminHospitals(h);
      setAdminAmbulances(a);
    } catch (err) {
      console.error('Failed to fetch fleet details:', err);
    }
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
            createdAt: u.createdAt,
            medicalProfile: normalizeMedicalProfile(u.medicalProfile ?? u)
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
          createdAt: u.createdAt,
          medicalProfile: normalizeMedicalProfile(u.medicalProfile ?? u)
        })));
        setTotalUsers(response.data.length);
      } else if (response.data.users) {
        setUsers(response.data.users.map((u: any) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt,
          medicalProfile: normalizeMedicalProfile(u.medicalProfile ?? u)
        })));
        setTotalUsers(response.data.total || response.data.users.length);
      }
    } catch (err) {
      console.error('Failed to fetch filtered users:', err);
    }
  };

  /**
   * Flatten a row for export.
   *
   * The Medical Profile is nested on the row, so it is spread into four named
   * columns here rather than serialised as an object. Fields the patient never
   * supplied export as "Not Provided", which keeps a blank cell from being read
   * as "no allergies".
   */
  const toReportRow = (row: any) => {
    const { medicalProfile, ...rest } = row;
    if (!medicalProfile) return rest;
    const profile = normalizeMedicalProfile(medicalProfile);
    return {
      ...rest,
      bloodGroup: profile.display.bloodGroup,
      allergies: profile.display.allergies,
      chronicConditions: profile.display.chronicConditions,
      currentMedications: profile.display.currentMedications,
    };
  };

  const exportToCSV = (rows: any[], filename: string) => {
    const data = (rows || []).map(toReportRow);
    if (!data || data.length === 0) {
      notify({ tone: 'info', text: 'There is nothing to export yet.' });
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
        createdAt: b.createdAt,
        patientName: b.patientName || 'Patient',
        patientPhone: b.patientPhone ?? null,
        medicalProfile: normalizeMedicalProfile(b.medicalProfile)
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
    
    const refreshAll = () => {
      fetchDashboardData();
      fetchBookings();
      fetchPendingAmbulances();
      fetchFleetDetails();
      setLiveTick(t => t + 1);
    };
    fetchFleetDetails();
    const refreshInterval = setInterval(refreshAll, FALLBACK_REFRESH_MS);
    
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Live updates: the server sends new bookings, dispatch changes and fleet
    // and hospital changes to the admin room. Bursts fold into one refetch.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = null; refreshAll(); }, 500);
    };
    const socket = io(SOCKET_URL, { transports: ['websocket'], auth: cb => cb({ token: TokenStorage.getToken() }) });
    let connectedBefore = false;
    socket.on('connect', () => {
      // Catch up on anything that happened while the connection was down.
      if (connectedBefore) scheduleRefresh();
      connectedBefore = true;
    });
    for (const event of ['booking_created', 'dispatch_assigned', 'dispatch_status_updated', 'dispatch_diverted', 'ambulance_status_updated', 'hospital_status_updated', 'settings_updated']) {
      socket.on(event, scheduleRefresh);
    }
    socket.on('system_announcement', (p: { message: string; tone: Tone }) => {
      notify({ tone: p.tone ?? 'info', title: 'Announcement', text: p.message, sticky: true });
    });

    return () => {
      clearInterval(refreshInterval);
      clearInterval(clockTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.disconnect();
    };
  }, []);

  // Fetch filtered users when filters change
  useEffect(() => {
    if (userSearch || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL' || userPage > 1) {
      fetchFilteredUsers();
    }
  }, [userSearch, userRoleFilter, userStatusFilter, userPage]);

  /** After any admin control: confirm it, and pull fresh data everywhere. */
  const afterAdminChange = (message: string) => {
    notify({ tone: 'success', text: message });
    fetchDashboardData();
    fetchBookings();
    fetchPendingAmbulances();
    fetchFleetDetails();
    setLiveTick(t => t + 1);
    if (userSearch || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL' || userPage > 1) fetchFilteredUsers();
  };

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
      notify({ tone: 'success', text: 'Ambulance verified and approved.' });
    } catch (err) {
      console.error('Failed to verify ambulance:', err);
      notify({ tone: 'danger', title: 'Not verified', text: 'Failed to verify ambulance.' });
    }
  };

  const handleRejectAmbulance = async (ambulanceId: string) => {
    try {
      const token = TokenStorage.getToken();
      await axios.delete(
        `${API_BASE_URL}/ambulances/${ambulanceId}/reject`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchPendingAmbulances();
      notify({ tone: 'info', text: 'Ambulance registration rejected.' });
    } catch (err) {
      console.error('Failed to reject ambulance:', err);
      notify({ tone: 'danger', title: 'Not rejected', text: 'Failed to reject ambulance.' });
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
      notify({ tone: 'danger', text: errorText(err, 'Failed to update user status.') });
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
      notify({ tone: 'danger', text: errorText(err, 'Failed to update user role.') });
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
      notify({ tone: 'danger', text: 'Failed to update hospital status.' });
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
      fetchFleetDetails();
    } catch (err) {
      console.error('Failed to update ambulance status:', err);
      notify({ tone: 'danger', text: errorText(err, 'Failed to update ambulance status.') });
    }
  };


  if (loading) {
    return <PageLoading label="Loading admin console…" />;
  }

  if (error) {
    return <PageError message={error} onRetry={fetchDashboardData} />;
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
      { name: 'Active', value: systemStats.bookingStats.active || 0, tone: 'info' as Tone },
      { name: 'Completed', value: systemStats.bookingStats.completed || 0, tone: 'success' as Tone },
      { name: 'Cancelled', value: systemStats.bookingStats.cancelled || 0, tone: 'neutral' as Tone },
    ] : [
      { name: 'Active', value: systemStats.activeBookings || 0, tone: 'info' as Tone },
      { name: 'Completed', value: systemStats.completedToday || 0, tone: 'success' as Tone },
      { name: 'Cancelled', value: 0, tone: 'neutral' as Tone },
    ];
    const bookingTotal = bookingStatusData.reduce((sum, d) => sum + d.value, 0);

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

    const kpis: { label: string; value: number; icon: IconName; tone: Tone; meta: string; tab?: TabType; alert?: boolean }[] = [
      { label: 'Active bookings', value: systemStats.activeBookings, icon: 'siren', tone: 'danger', meta: 'In progress now', tab: 'bookings', alert: systemStats.activeBookings > 0 },
      { label: 'Emergencies', value: systemStats.emergenciesHandled, icon: 'alertTriangle', tone: 'orange', meta: 'Handled today' },
      { label: 'Completed today', value: systemStats.completedToday, icon: 'checkCircle', tone: 'success', meta: 'Successful transports' },
      { label: 'Ambulances', value: systemStats.totalAmbulances, icon: 'ambulance', tone: 'brand', meta: 'Manage fleet', tab: 'ambulances' },
      { label: 'Hospitals', value: systemStats.totalHospitals, icon: 'hospital', tone: 'info', meta: 'Manage hospitals', tab: 'hospitals' },
      { label: 'Total users', value: systemStats.totalUsers, icon: 'users', tone: 'violet', meta: 'Manage accounts', tab: 'users' },
    ];

    const tooltipStyle = {
      borderRadius: 10,
      border: '1px solid #e2e8f0',
      boxShadow: '0 10px 20px -6px rgba(15,23,42,.12)',
      fontSize: 13,
      padding: '8px 12px',
    };

    return (
      <>
        {pendingAmbulances.length > 0 && (
          <button type="button" className="adm-prompt tone-warning ui-enter" onClick={() => setActiveTab('pending')}>
            <span className="ui-icon-tile ui-icon-tile--sm"><Icon name="badgeCheck" size={18} /></span>
            <span className="adm-prompt__text">
              <strong>{pendingAmbulances.length} ambulance registration{pendingAmbulances.length === 1 ? '' : 's'}</strong> waiting for verification
            </span>
            <span className="adm-prompt__cta">Review <Icon name="arrowRight" size={15} /></span>
          </button>
        )}

        <section className="ui-kpi-grid ui-kpi-grid--3" aria-label="System figures">
          {kpis.map((kpi, i) => {
            const body = (
              <>
                <div className="ui-kpi__top">
                  <span className="ui-kpi__label">{kpi.label}</span>
                  <span className="ui-kpi__icon"><Icon name={kpi.icon} /></span>
                </div>
                <div className="ui-kpi__value"><AnimatedNumber value={kpi.value} /></div>
                <div className="ui-kpi__meta">
                  {kpi.tab ? <span className="adm-kpi-link">{kpi.meta}<Icon name="chevronRight" size={14} /></span> : kpi.meta}
                </div>
              </>
            );
            const className = `ui-card ui-kpi ui-enter ${toneClass(kpi.tone)}${kpi.alert ? ' ui-kpi--alert' : ''}${kpi.tab ? ' ui-card--interactive' : ''}`;
            return kpi.tab ? (
              <button key={kpi.label} type="button" className={className} style={{ ['--i' as string]: i }} onClick={() => setActiveTab(kpi.tab!)}>
                {body}
              </button>
            ) : (
              <div key={kpi.label} className={className} style={{ ['--i' as string]: i }}>{body}</div>
            );
          })}
        </section>

        {/* Chart Visualizations */}
        <div className="adm-charts">
          <section className="ui-card ui-enter adm-chart" style={{ ['--i' as string]: 3 }} aria-labelledby="chart-roles">
            <div className="ui-card__header">
              <div>
                <h2 id="chart-roles" className="ui-card__title">Users by role</h2>
                <div className="ui-card__subtitle">Registered accounts</div>
              </div>
            </div>
            <div className="adm-chart__body">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={roleChartData} margin={{ top: 22, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: CHART.grid }} tick={{ fill: CHART.tick, fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: CHART.tick, fontSize: 12 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'rgba(8,145,178,0.06)' }} contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Accounts" fill={CHART.series} radius={[4, 4, 0, 0]} maxBarSize={44}>
                    <LabelList dataKey="count" position="top" style={{ fill: '#334155', fontSize: 12, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="ui-card ui-enter adm-chart" style={{ ['--i' as string]: 4 }} aria-labelledby="chart-status">
            <div className="ui-card__header">
              <div>
                <h2 id="chart-status" className="ui-card__title">Booking status</h2>
                <div className="ui-card__subtitle">{bookingTotal} bookings in total</div>
              </div>
            </div>
            <div className="adm-chart__body adm-split">
              <div className="adm-split__bar" role="img" aria-label={bookingStatusData.map(d => `${d.name} ${d.value}`).join(', ')}>
                {bookingStatusData.filter(d => d.value > 0).map(d => (
                  <span
                    key={d.name}
                    className="adm-split__seg"
                    style={{ flexGrow: d.value, background: d.tone === 'neutral' ? '#64748b' : TONE_COLOR[d.tone] }}
                    title={`${d.name}: ${d.value}`}
                  />
                ))}
              </div>
              <ul className="adm-split__legend">
                {bookingStatusData.map(d => (
                  <li key={d.name}>
                    <span className="adm-split__key" style={{ background: d.tone === 'neutral' ? '#64748b' : TONE_COLOR[d.tone] }} />
                    <span className="adm-split__name">{d.name}</span>
                    <span className="adm-split__value ui-num">{d.value}</span>
                    <span className="adm-split__pct ui-num">{bookingTotal ? Math.round((d.value / bookingTotal) * 100) : 0}%</span>
                  </li>
                ))}
              </ul>
              {systemStats.bookingStats?.completionRate && (
                <p className="ui-help">Completion rate {systemStats.bookingStats.completionRate}</p>
              )}
            </div>
          </section>

          <section className="ui-card ui-enter adm-chart" style={{ ['--i' as string]: 5 }} aria-labelledby="chart-trend">
            <div className="ui-card__header">
              <div>
                <h2 id="chart-trend" className="ui-card__title">Bookings trend</h2>
                <div className="ui-card__subtitle">Last 7 days</div>
              </div>
              <Badge tone="warning" icon="info" title="These figures are placeholder values, not live booking history.">Sample data</Badge>
            </div>
            <div className="adm-chart__body">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={bookingsTrendData} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.series} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={CHART.series} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: CHART.grid }} tick={{ fill: CHART.tick, fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: CHART.tick, fontSize: 12 }} allowDecimals={false} />
                  <Tooltip cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} contentStyle={tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="bookings"
                    name="Bookings"
                    stroke={CHART.series}
                    strokeWidth={2}
                    fill="url(#trendFill)"
                    dot={{ r: 4, fill: '#fff', stroke: CHART.series, strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: CHART.series, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section className="ui-card ui-enter" style={{ ['--i' as string]: 6 }} aria-labelledby="audit-recent">
          <div className="ui-card__header">
            <div>
              <h2 id="audit-recent" className="ui-card__title"><Icon name="scrollText" size={17} />Recent audit logs</h2>
              <div className="ui-card__subtitle">Latest system and admin actions</div>
            </div>
            <button type="button" onClick={() => setActiveTab('audit')} className="ui-btn ui-btn--ghost ui-btn--sm">
              View all
              <Icon name="chevronRight" size={15} />
            </button>
          </div>
          {recentAudit.length > 0 ? (
            <div className="ui-list">
              {recentAudit.slice(0, 5).map(log => (
                <div key={log.id} className="ui-list__row adm-audit">
                  <span className="ui-icon-tile ui-icon-tile--sm tone-neutral"><Icon name="activity" size={16} /></span>
                  <div className="adm-audit__main">
                    <div className="ui-row">
                      <Badge tone="brand">{log.action.replace(/_/g, ' ')}</Badge>
                      <span className="adm-audit__entity">{log.entity} <code className="ui-code">{String(log.entityId).slice(0, 8)}</code></span>
                    </div>
                    <div className="adm-audit__actor">by {log.actor}</div>
                  </div>
                  <div className="adm-audit__time">{log.timestamp}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="scrollText" title="No recent audit logs">Actions taken in the system will be recorded here.</EmptyState>
          )}
        </section>
      </>
    );
  };

  const renderUsersTab = () => {
    const startIndex = (userPage - 1) * userLimit;
    const endIndex = Math.min(startIndex + userLimit, users.length);
    const paginatedUsers = users.slice(startIndex, endIndex);
    const totalPages = Math.ceil(totalUsers / userLimit);
    const filtered = !!(userSearch || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL');

    return (
      <section className="ui-enter">
        <div className="ui-page-header">
          <div>
            <p className="ui-page-header__text">Create staff accounts, change roles, activate or deactivate accounts, and export reports.</p>
          </div>
          <div className="ui-row">
            <Badge tone="info" large>{totalUsers || users.length} users</Badge>
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => setShowCreateAccount(true)}>
              <Icon name="userPlus" size={16} />
              Create account
            </button>
          </div>
        </div>

        <div className="ui-toolbar">
          <div className="ui-input-wrap ui-toolbar__search">
            <Icon name="search" size={16} />
            <input
              className="ui-input"
              type="text"
              placeholder="Search by name, email, or phone…"
              aria-label="Search users"
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value);
                setUserPage(1);
              }}
            />
          </div>
          <select
            className="ui-select adm-filter"
            aria-label="Filter by role"
            value={userRoleFilter}
            onChange={(e) => {
              setUserRoleFilter(e.target.value);
              setUserPage(1);
            }}
          >
            <option value="ALL">All Roles</option>
            <option value="USER">User</option>
            <option value="DRIVER">Driver</option>
            <option value="HOSPITAL">Hospital</option>
            <option value="ADMIN">Admin</option>
          </select>
          <select
            className="ui-select adm-filter"
            aria-label="Filter by status"
            value={userStatusFilter}
            onChange={(e) => {
              setUserStatusFilter(e.target.value);
              setUserPage(1);
            }}
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          {filtered && (
            <button
              type="button"
              className="ui-btn ui-btn--ghost"
              onClick={() => {
                setUserSearch('');
                setUserRoleFilter('ALL');
                setUserStatusFilter('ALL');
                setUserPage(1);
              }}
            >
              <Icon name="x" size={15} />
              Clear filters
            </button>
          )}
          <button type="button" className="ui-btn ui-btn--secondary" onClick={() => exportToCSV(users, 'users')}>
            <Icon name="download" size={16} />
            Export CSV
          </button>
        </div>

        {paginatedUsers.length === 0 ? (
          <div className="ui-card">
            <EmptyState icon="search" title="No users found">Try adjusting your search or filter criteria.</EmptyState>
          </div>
        ) : (
          <>
            <div className="ui-table-wrap">
              <table className="ui-table ui-table--stack">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                    <th scope="col"><span className="ui-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedUsers.map(user => (
                    <tr key={user.id}>
                      <td data-label="Email">
                        <div className="adm-user">
                          <span className="ui-avatar">{user.email.charAt(0).toUpperCase()}</span>
                          <span className="ui-table__primary">{user.email}</span>
                        </div>
                      </td>
                      <td data-label="Role">
                        <div className="adm-role">
                          <select
                            className="ui-select ui-select--sm"
                            aria-label={`Change role for ${user.email}`}
                            value={user.role}
                            onChange={(e) => handleUpdateUserRole(user.id, e.target.value)}
                          >
                            <option value="USER">USER</option>
                            <option value="DRIVER">DRIVER</option>
                            <option value="HOSPITAL">HOSPITAL</option>
                            <option value="ADMIN">ADMIN</option>
                          </select>
                        </div>
                      </td>
                      <td data-label="Status"><StatusBadge status={user.isActive ? 'ACTIVE' : 'INACTIVE'} variant="dot" /></td>
                      <td data-label="Created" className="ui-table__secondary" title={formatIstFull(user.createdAt)}>{formatIstDate(user.createdAt)}</td>
                      <td data-label="Actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setManageUserId(user.id)}>
                          <Icon name="sliders" size={14} />
                          Manage
                        </button>{' '}
                        <button
                          type="button"
                          onClick={() => handleUpdateUserStatus(user.id, !user.isActive)}
                          className={`ui-btn ui-btn--sm ${user.isActive ? 'ui-btn--danger-soft' : 'ui-btn--secondary'}`}
                        >
                          <Icon name={user.isActive ? 'ban' : 'checkCircle'} size={14} />
                          {user.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <nav className="ui-pagination" aria-label="Pagination">
              <span>
                Showing <strong className="ui-num">{startIndex + 1}–{endIndex}</strong> of <span className="ui-num">{totalUsers || users.length}</span>
              </span>
              <div className="ui-row">
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  onClick={() => setUserPage(Math.max(1, userPage - 1))}
                  disabled={userPage === 1}
                >
                  <Icon name="chevronLeft" size={15} />
                  Previous
                </button>
                <span className="adm-page ui-num">Page {userPage} of {totalPages || 1}</span>
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  onClick={() => setUserPage(Math.min(totalPages, userPage + 1))}
                  disabled={userPage >= totalPages}
                >
                  Next
                  <Icon name="chevronRight" size={15} />
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
    );
  };

  const renderHospitalsTab = () => {
    const filteredHospitals = hospitals.filter(hospital =>
      hospital.name.toLowerCase().includes(hospitalSearch.toLowerCase())
    );

    return (
      <section className="ui-enter">
        <div className="ui-page-header">
          <div>
            <p className="ui-page-header__text">Intake status and live bed capacity across the network. Add hospitals, edit their details and capabilities, or retire them.</p>
          </div>
          <div className="ui-row">
            <Badge tone="info" large>{filteredHospitals.length} hospitals</Badge>
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => setHospitalForm('new')}>
              <Icon name="plus" size={16} />
              Add hospital
            </button>
          </div>
        </div>

        <div className="ui-toolbar">
          <div className="ui-input-wrap ui-toolbar__search">
            <Icon name="search" size={16} />
            <input
              className="ui-input"
              type="text"
              placeholder="Search by hospital name…"
              aria-label="Search hospitals"
              value={hospitalSearch}
              onChange={(e) => setHospitalSearch(e.target.value)}
            />
          </div>
          {hospitalSearch && (
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setHospitalSearch('')}>
              <Icon name="x" size={15} />
              Clear search
            </button>
          )}
        </div>

        {filteredHospitals.length === 0 ? (
          <div className="ui-card">
            <EmptyState icon="hospital" title="No hospitals found">Try adjusting your search criteria.</EmptyState>
          </div>
        ) : (
          <div className="ui-table-wrap">
            <table className="ui-table ui-table--stack">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Address</th>
                  <th scope="col">Status</th>
                  <th scope="col">Beds available</th>
                  <th scope="col">Set status</th>
                  <th scope="col"><span className="ui-sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredHospitals.map(hospital => {
                  const ratio = hospital.totalBeds ? hospital.availableBeds / hospital.totalBeds : 0;
                  const bedTone: Tone = hospital.availableBeds > 10 ? 'success' : hospital.availableBeds > 0 ? 'warning' : 'danger';
                  return (
                    <tr key={hospital.id}>
                      <td data-label="Name" className="ui-table__primary">{hospital.name}</td>
                      <td data-label="Address" className="ui-table__secondary adm-address">{hospital.address}</td>
                      <td data-label="Status"><StatusBadge status={hospital.status} /></td>
                      <td data-label="Beds available">
                        <div className={`adm-beds ${toneClass(bedTone)}`}>
                          <span className="adm-beds__value ui-num"><strong>{hospital.availableBeds}</strong> / {hospital.totalBeds}</span>
                          <div className="ui-meter adm-beds__meter">
                            <div className="ui-meter__fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                          </div>
                        </div>
                      </td>
                      <td data-label="Set status">
                        <select
                          className="ui-select ui-select--sm"
                          aria-label={`Set status for ${hospital.name}`}
                          value={hospital.status}
                          onChange={(e) => handleUpdateHospitalStatus(hospital.id, e.target.value)}
                        >
                          <option value="ACCEPTING">ACCEPTING</option>
                          <option value="LIMITED">LIMITED</option>
                          <option value="DIVERT">DIVERT</option>
                        </select>
                      </td>
                      <td data-label="Edit" style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="ui-btn ui-btn--secondary ui-btn--sm"
                          onClick={() => setHospitalForm(adminHospitals.find(h => h.id === hospital.id) ?? null)}
                          disabled={!adminHospitals.some(h => h.id === hospital.id)}
                        >
                          <Icon name="pencil" size={14} />
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const renderAmbulancesTab = () => {
    const filteredAmbulances = ambulances.filter(ambulance =>
      ambulance.vehicleNumber.toLowerCase().includes(ambulanceSearch.toLowerCase())
    );

    return (
      <section className="ui-enter">
        <div className="ui-page-header">
          <div>
            <p className="ui-page-header__text">Fleet availability. Units marked offline or in maintenance are not dispatched. Add units, edit them, set a position by hand, or retire them.</p>
          </div>
          <div className="ui-row">
            <Badge tone="info" large>{filteredAmbulances.length} ambulances</Badge>
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => setAmbulanceForm('new')}>
              <Icon name="plus" size={16} />
              Add ambulance
            </button>
          </div>
        </div>

        <div className="ui-toolbar">
          <div className="ui-input-wrap ui-toolbar__search">
            <Icon name="search" size={16} />
            <input
              className="ui-input"
              type="text"
              placeholder="Search by vehicle number…"
              aria-label="Search ambulances"
              value={ambulanceSearch}
              onChange={(e) => setAmbulanceSearch(e.target.value)}
            />
          </div>
          {ambulanceSearch && (
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setAmbulanceSearch('')}>
              <Icon name="x" size={15} />
              Clear search
            </button>
          )}
        </div>

        {filteredAmbulances.length === 0 ? (
          <div className="ui-card">
            <EmptyState icon="ambulance" title="No ambulances found">Try adjusting your search criteria.</EmptyState>
          </div>
        ) : (
          <div className="ui-table-wrap">
            <table className="ui-table ui-table--stack">
              <thead>
                <tr>
                  <th scope="col">Vehicle number</th>
                  <th scope="col">Type</th>
                  <th scope="col">Driver</th>
                  <th scope="col">Status</th>
                  <th scope="col">Set status</th>
                  <th scope="col"><span className="ui-sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredAmbulances.map(ambulance => (
                  <tr key={ambulance.id}>
                    <td data-label="Vehicle"><span className="ui-plate">{ambulance.vehicleNumber}</span></td>
                    <td data-label="Type"><Badge tone="neutral">{String(ambulance.vehicleType || '').replace(/_/g, ' ')}</Badge></td>
                    <td data-label="Driver" className="ui-table__secondary">
                      {(() => {
                        const drivers = adminAmbulances.find(a => a.id === ambulance.id)?.drivers ?? [];
                        return drivers.length ? drivers.map(d => d.name || d.email).join(', ') : 'None linked';
                      })()}
                    </td>
                    <td data-label="Status"><StatusBadge status={ambulance.status} /></td>
                    <td data-label="Set status">
                      <select
                        className="ui-select ui-select--sm"
                        aria-label={`Set status for ${ambulance.vehicleNumber}`}
                        value={ambulance.status}
                        onChange={(e) => handleUpdateAmbulanceStatus(ambulance.id, e.target.value)}
                      >
                        <option value="AVAILABLE">AVAILABLE</option>
                        <option value="BUSY">BUSY</option>
                        <option value="OFFLINE">OFFLINE</option>
                        <option value="MAINTENANCE">MAINTENANCE</option>
                      </select>
                    </td>
                    <td data-label="Edit" style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                        onClick={() => setAmbulanceForm(adminAmbulances.find(a => a.id === ambulance.id) ?? null)}
                        disabled={!adminAmbulances.some(a => a.id === ambulance.id)}
                      >
                        <Icon name="pencil" size={14} />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const renderBookingsTab = () => (
    <section className="ui-enter">
      <div className="ui-page-header">
        <div>
          <p className="ui-page-header__text">Every booking, with the patient's blood group, a full case report, and operator control over each case.</p>
        </div>
        <div className="ui-row">
          <Badge tone="info" large>{bookings.length} bookings</Badge>
          <button type="button" className="ui-btn ui-btn--secondary" onClick={() => exportToCSV(bookings, 'bookings')}>
            <Icon name="download" size={16} />
            Export CSV
          </button>
        </div>
      </div>

      <DispatchQueue
        refreshKey={liveTick}
        onManage={setCaseControlId}
        notify={notify}
        onChanged={() => { fetchBookings(); fetchFleetDetails(); }}
      />

      {bookings.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon="clipboardList" title="No bookings found">All bookings will appear here.</EmptyState>
        </div>
      ) : (
        <div className="ui-table-wrap">
          <table className="ui-table ui-table--stack">
            <thead>
              <tr>
                <th scope="col">Booking ID</th>
                <th scope="col">Patient</th>
                <th scope="col">Blood group</th>
                <th scope="col">Status</th>
                <th scope="col">Severity</th>
                <th scope="col">Pickup address</th>
                <th scope="col">Created</th>
                <th scope="col"><span className="ui-sr-only">Report</span></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(booking => (
                <tr key={booking.id}>
                  <td data-label="Booking ID"><code>{booking.id.slice(0, 8)}</code></td>
                  <td data-label="Patient" className="ui-table__primary">{booking.patientName}</td>
                  <td data-label="Blood group">
                    {/* Straight from the patient's Medical Profile; "Not Provided"
                        when they have not recorded a blood group. */}
                    {booking.medicalProfile.bloodGroup ? (
                      <span className="adm-blood"><Icon name="droplet" size={13} />{booking.medicalProfile.display.bloodGroup}</span>
                    ) : (
                      <span className="ui-table__secondary" style={{ fontStyle: 'italic' }}>{booking.medicalProfile.display.bloodGroup}</span>
                    )}
                  </td>
                  <td data-label="Status"><StatusBadge status={booking.status} variant="dot" /></td>
                  <td data-label="Severity"><SeverityBadge severity={booking.severity || 'MEDIUM'} /></td>
                  <td data-label="Pickup" className="adm-address ui-truncate" title={booking.pickupAddress || 'N/A'}>
                    {booking.pickupAddress || 'N/A'}
                  </td>
                  <td data-label="Created" className="ui-table__secondary" style={{ whiteSpace: 'nowrap' }} title={formatIstFull(booking.createdAt)}>{formatIstDateTime(booking.createdAt)}</td>
                  <td data-label="Report" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      onClick={() => setCaseControlId(booking.id)}
                      title="Dispatch, swap the ambulance, change hospital, override status, cancel"
                    >
                      <Icon name="sliders" size={14} />
                      Manage
                    </button>{' '}
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      onClick={() => setReportBookingId(booking.id)}
                      title="Full case report: patient, Medical Profile, triage and dispatch"
                      aria-label="Case report"
                    >
                      <Icon name="fileText" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderPendingTab = () => (
    <section className="ui-enter">
      <div className="ui-page-header">
        <div>
          <p className="ui-page-header__text">New ambulance registrations cannot be dispatched until they are verified.</p>
        </div>
        <Badge tone={pendingAmbulances.length > 0 ? 'warning' : 'success'} large dot>{pendingAmbulances.length} pending</Badge>
      </div>
      {pendingAmbulances.length === 0 ? (
        <div className="ui-card">
          <EmptyState icon="checkCircle" tone="success" title="No pending verifications">All ambulance registrations have been reviewed.</EmptyState>
        </div>
      ) : (
        <div className="adm-pending">
          {pendingAmbulances.map((ambulance, i) => (
            <article key={ambulance.id} className="ui-card ui-accent ui-accent--warning adm-pending__card ui-enter" style={{ ['--i' as string]: i }}>
              <header className="adm-pending__head">
                <span className="ui-icon-tile tone-brand"><Icon name="ambulance" size={22} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="adm-pending__plate ui-mono">{ambulance.vehicleNumber}</div>
                  <Badge tone="neutral">{String(ambulance.vehicleType || '').replace(/_/g, ' ')}</Badge>
                </div>
                <Badge tone="warning" icon="hourglass">Pending</Badge>
              </header>

              <dl className="adm-pending__details">
                {([
                  ['Driver name', ambulance.driverName, 'user'],
                  ['Phone', ambulance.driverPhone, 'phone'],
                  ['License', ambulance.driverLicense, 'idCard'],
                  ['Location', ambulance.locationAddress, 'mapPin'],
                ] as [string, string, IconName][]).map(([label, value, icon]) => (
                  <div key={label} className="adm-pending__row">
                    <dt><Icon name={icon} size={14} />{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                <div className="adm-pending__row adm-pending__row--stack">
                  <dt><Icon name="medKit" size={14} />Equipment</dt>
                  <dd>
                    {ambulance.equipment.length > 0 ? (
                      <span className="ui-row">{ambulance.equipment.map(eq => <Badge key={eq} tone="neutral">{eq}</Badge>)}</span>
                    ) : 'None specified'}
                  </dd>
                </div>
                <div className="adm-pending__row">
                  <dt><Icon name="clock" size={14} />Submitted</dt>
                  <dd title={formatIstFull(ambulance.createdAt)}>{formatIstDateTime(ambulance.createdAt)}</dd>
                </div>
              </dl>

              <footer className="ui-card__footer adm-pending__actions">
                <button type="button" className="ui-btn ui-btn--danger-soft" onClick={() => setRejectTarget(ambulance)}>
                  <Icon name="x" size={16} />
                  Reject
                </button>
                <button type="button" className="ui-btn ui-btn--success" onClick={() => handleVerifyAmbulance(ambulance.id)}>
                  <Icon name="badgeCheck" size={16} />
                  Verify &amp; approve
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'map': return <Suspense fallback={<PageLoading label="Loading map…" />}><OperationsMap /></Suspense>;
      case 'users': return renderUsersTab();
      case 'hospitals': return renderHospitalsTab();
      case 'ambulances': return renderAmbulancesTab();
      case 'pending': return renderPendingTab();
      case 'bookings': return renderBookingsTab();
      case 'audit': return <Suspense fallback={<PageLoading label="Loading audit log…" />}><AuditPanel /></Suspense>;
      case 'system': return <Suspense fallback={<PageLoading label="Loading system controls…" />}><SystemPanel notify={notify} /></Suspense>;
      default: return renderDashboardTab();
    }
  };

  const getTabTitle = () => {
    switch (activeTab) {
      case 'map': return 'Live Operations Map';
      case 'users': return 'User Management';
      case 'hospitals': return 'Hospital Management';
      case 'ambulances': return 'Ambulance Management';
      case 'pending': return 'Pending Verifications';
      case 'bookings': return 'Booking Management';
      case 'audit': return 'Audit Logs';
      case 'system': return 'System Controls';
      default: return 'System Overview';
    }
  };

  const NAV_GROUPS: { label: string; items: { id: TabType; label: string; icon: IconName; badge?: number }[] }[] = [
    {
      label: 'Operations',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
        { id: 'map', label: 'Live Map', icon: 'map' },
        { id: 'bookings', label: 'Bookings', icon: 'clipboardList' },
      ],
    },
    {
      label: 'Network',
      items: [
        { id: 'hospitals', label: 'Hospitals', icon: 'hospital' },
        { id: 'ambulances', label: 'Ambulances', icon: 'ambulance' },
        { id: 'pending', label: 'Pending Verifications', icon: 'badgeCheck', badge: pendingAmbulances.length },
      ],
    },
    {
      label: 'Administration',
      items: [
        { id: 'users', label: 'Users', icon: 'users' },
        { id: 'system', label: 'System', icon: 'sliders' },
        { id: 'audit', label: 'Audit Logs', icon: 'scrollText' },
      ],
    },
  ];

  return (
    <div className="ui-app">
      <a href="#main" className="ui-skip-link">Skip to content</a>
      <div className={`ui-scrim${sidebarOpen ? ' is-visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      <aside className={`ui-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Admin navigation">
        <div className="ui-sidebar__brand">
          <BrandMark />
          <div className="ui-sidebar__brand-text">
            <div className="ui-sidebar__product">ECS Admin</div>
            <div className="ui-sidebar__portal">Operations console</div>
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>

        <nav className="ui-nav" aria-label="Sections">
          {NAV_GROUPS.map(group => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="ui-nav__label">{group.label}</div>
              {group.items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`ui-nav__item${activeTab === item.id ? ' is-active' : ''}`}
                  aria-current={activeTab === item.id ? 'page' : undefined}
                  onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {!!item.badge && (
                    <span className="ui-nav__badge ui-nav__badge--warning" aria-label={`${item.badge} pending`}>{item.badge}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="ui-sidebar__footer">
          <div className="ui-user">
            <span className="ui-avatar" style={{ background: 'var(--violet-soft)', color: 'var(--violet-text)' }}><Icon name="shieldCheck" size={17} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="ui-user__name">Administrator</div>
              <div className="ui-user__meta">Full access</div>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="ui-btn ui-btn--ghost ui-btn--block adm-signout">
            <Icon name="logOut" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="ui-main">
        <header className="ui-topbar">
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--icon ui-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="ui-topbar__titles">
            <h1 className="ui-topbar__title">{getTabTitle()}</h1>
            <div className="ui-topbar__subtitle ui-num">{formatIstClock(currentTime)}</div>
          </div>
          <div className="ui-topbar__actions">
            <span className="ui-badge ui-badge--lg tone-success ui-hide-sm">
              <span className="ui-live" aria-hidden="true" />
              All Systems Operational
            </span>
          </div>
        </header>

        <main id="main" className="ui-content" key={activeTab}>
          {renderContent()}
        </main>
      </div>

      {/* Admin controls — each loads the first time it is opened. */}
      <Suspense fallback={null}>
        {manageUserId && (
          <UserManageModal
            userId={manageUserId}
            currentAdminId={currentAdminId()}
            hospitals={hospitals}
            ambulances={ambulances}
            onClose={() => setManageUserId(null)}
            onChanged={afterAdminChange}
          />
        )}

        {hospitalForm && (
          <HospitalFormModal
            hospital={hospitalForm === 'new' ? null : hospitalForm}
            onClose={() => setHospitalForm(null)}
            onChanged={afterAdminChange}
          />
        )}

        {ambulanceForm && (
          <AmbulanceFormModal
            ambulance={ambulanceForm === 'new' ? null : ambulanceForm}
            onClose={() => setAmbulanceForm(null)}
            onChanged={afterAdminChange}
          />
        )}

        {caseControlId && (
          <CaseControlModal
            bookingId={caseControlId}
            onClose={() => setCaseControlId(null)}
            onChanged={afterAdminChange}
            onOpenReport={id => setReportBookingId(id)}
          />
        )}
      </Suspense>

      {/* Full ECS case report — patient, Medical Profile, triage and dispatch. After the admin controls, so it opens on top of the case panel. */}
      {reportBookingId && (
        <Suspense fallback={null}>
          <CaseReportModal
            bookingId={reportBookingId}
            apiBaseUrl={API_BASE_URL}
            token={TokenStorage.getToken() || ''}
            onClose={() => setReportBookingId(null)}
          />
        </Suspense>
      )}

      {showCreateAccount && (
        <CreateAccountModal
          hospitals={hospitals}
          ambulances={ambulances}
          apiBaseUrl={API_BASE_URL}
          token={TokenStorage.getToken() || ''}
          onClose={() => setShowCreateAccount(false)}
          onCreated={account => {
            setShowCreateAccount(false);
            notify({ tone: 'success', title: 'Account created', text: `${account.email} can now sign in as ${account.role.toLowerCase()}.` });
            fetchDashboardData();
            if (userSearch || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL' || userPage > 1) fetchFilteredUsers();
          }}
        />
      )}

      {rejectTarget && (
        <Modal onClose={() => setRejectTarget(null)} labelledBy="reject-amb-title" describedBy="reject-amb-desc" role="alertdialog">
          <div className="ui-modal__header ui-modal__header--plain">
            <span className="ui-icon-tile tone-danger"><Icon name="x" size={22} /></span>
            <div>
              <h2 id="reject-amb-title" className="ui-modal__title">Reject this registration?</h2>
              <p className="ui-modal__subtitle">{rejectTarget.vehicleNumber} · {rejectTarget.driverName}</p>
            </div>
          </div>
          <div className="ui-modal__body">
            <p id="reject-amb-desc" style={{ color: 'var(--text-2)' }}>
              The registration is removed and the ambulance will not be available for dispatch.
            </p>
          </div>
          <div className="ui-modal__footer">
            <button type="button" className="ui-btn ui-btn--secondary" onClick={() => setRejectTarget(null)} data-autofocus>Cancel</button>
            <button
              type="button"
              className="ui-btn ui-btn--danger"
              onClick={() => {
                const id = rejectTarget.id;
                setRejectTarget(null);
                handleRejectAmbulance(id);
              }}
            >
              Reject registration
            </button>
          </div>
        </Modal>
      )}

      <NoticeStack notices={notices} onDismiss={dismiss} />
    </div>
  );
};

export default Dashboard;
