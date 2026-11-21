import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import TokenStorage from '../utils/tokenStorage';
import { API_CONFIG } from '../config/api';
import { formatIstClock, formatIstFull, formatIstTime, formatTimeAgo } from '@shared/utils/datetime';
import DriverIdentity, { type DriverInfo } from '../components/DriverIdentity';
import MedicalProfilePanel from '@shared/components/MedicalProfilePanel';
import {
  medicalProfileAlerts,
  normalizeMedicalProfile,
  type MedicalProfile,
} from '@shared/types/medicalProfile';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { Badge, SeverityBadge, StatusBadge, severityMeta, statusMeta, toneClass, type Tone } from '@shared/components/ui/Status';
import { AnimatedNumber, BrandMark, EmptyState, PageError, PageLoading } from '@shared/components/ui/primitives';
import { Modal } from '@shared/components/ui/Modal';
import { NoticeStack, useNotices } from '@shared/components/ui/Notices';
import '../styles/Dashboard.css';

const API_BASE_URL = API_CONFIG.BASE_URL;
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

// Changes arrive over the socket as they happen. This slow poll only catches
// anything missed while the connection was down.
const FALLBACK_REFRESH_MS = 5 * 60_000;

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

interface PreArrivalAlert {
  dispatchId: string;
  bookingId: string;
  ambulanceId: string;
  ambulanceVehicleNumber: string;
  driver?: DriverInfo | null;
  ambulanceLocation: { latitude: number | null; longitude: number | null };
  patientSeverity: string;
  emergencyType: string | null;
  triage: {
    breathing: boolean;
    bleeding: boolean;
    conscious: boolean;
    painLevel: number;
    pregnancy: boolean;
  } | null;
  /** Patient's Medical Profile, taken from their profile when the alert was
   *  raised. Unset fields arrive as null and are shown as "Not Provided". */
  medicalProfile?: MedicalProfile | null;
  etaMinutes: number | null;
  status: string;
  alertedAt: string;
}

type TabType = 'dashboard' | 'beds' | 'emergencies' | 'history' | 'prearrivals';

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
  const [preArrivalAlerts, setPreArrivalAlerts] = useState<PreArrivalAlert[]>([]);
  const socketRef = useRef<Socket | null>(null);
  // Presentation only: the mobile navigation drawer, and the alert awaiting
  // a reject-and-reroute confirmation.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PreArrivalAlert | null>(null);
  const { notices, notify, dismiss } = useNotices();

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

      // Seed pre-arrival alerts from the HTTP response (covers alerts emitted before the dashboard was opened)
      if (data.preArrivalAlerts && data.preArrivalAlerts.length > 0) {
        setPreArrivalAlerts(prev => {
          const merged = [...prev];
          for (const alert of data.preArrivalAlerts) {
            const idx = merged.findIndex(a => a.dispatchId === alert.dispatchId);
            if (idx === -1) {
              merged.unshift(alert);
            } else {
              merged[idx] = { ...merged[idx], ...alert };
            }
          }
          return merged;
        });
      }
      
      setLoading(false);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.response?.data?.message || 'Failed to load dashboard data');
      setLoading(false);
    }
  };

  // Several events can land together (an alert, then its status change); fold
  // them into one refetch.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      fetchDashboardData();
    }, 400);
  };

  useEffect(() => {
    fetchDashboardData();

    const refreshInterval = setInterval(fetchDashboardData, FALLBACK_REFRESH_MS);

    // Update clock every second
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(clockTimer);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // Track latest hospitalInfo.id in a ref so the socket connect handler can read it
  const hospitalIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    hospitalIdRef.current = hospitalInfo.id;
  }, [hospitalInfo.id]);

  // Socket.IO connection for real-time pre-arrival alerts
  useEffect(() => {
    // The server only accepts a signed-in socket, and places a hospital account
    // in its own hospital's room from the token. Read the token on every
    // (re)connect rather than once.
    const socket = io(SOCKET_URL, {
      auth: cb => cb({ token: TokenStorage.getToken() }),
    });
    socketRef.current = socket;
    let connectedBefore = false;

    socket.on('connect', () => {
      // Catch up on anything that happened while the connection was down.
      if (connectedBefore) scheduleRefresh();
      connectedBefore = true;
      // Re-join hospital room on every (re)connect so we never miss alerts after a reconnect
      if (hospitalIdRef.current) {
        socket.emit('join_hospital', { hospitalId: hospitalIdRef.current });
      }
    });

    socket.on('connect_error', (err) => {
      console.error('[PreArrival] Socket connection error:', err.message);
    });

    socket.on('disconnect', (reason) => {
      console.warn('[PreArrival] Socket disconnected:', reason);
    });

    socket.on('pre_arrival_alert', (alert: PreArrivalAlert) => {
      setPreArrivalAlerts(prev => {
        const existingIndex = prev.findIndex(a => a.dispatchId === alert.dispatchId);
        if (existingIndex !== -1) {
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], ...alert };
          return updated;
        }
        return [alert, ...prev];
      });
      scheduleRefresh();
    });

    // Update status on existing alerts when dispatch progresses
    socket.on('dispatch_status_updated', (data: { dispatchId: string; status: string }) => {
      setPreArrivalAlerts(prev =>
        prev.map(a => a.dispatchId === data.dispatchId ? { ...a, status: data.status } : a)
      );
      // Counts (incoming, completed today) move with the status.
      scheduleRefresh();
    });

    // An admin changed this hospital's status or beds.
    socket.on('hospital_status_updated', scheduleRefresh);

    // A message from the operations team.
    socket.on('system_announcement', (p: { message: string; tone?: Tone }) => {
      notify({ tone: p?.tone ?? 'info', title: 'Announcement', text: p.message, sticky: true });
    });

    // Moves the incoming ambulance on this hospital's view as it reports in.
    socket.on('ambulance_location_updated', (payload: { id: string; latitude: number | null; longitude: number | null }) => {
      setPreArrivalAlerts(prev =>
        prev.map(a => a.ambulanceId === payload.id
          ? { ...a, ambulanceLocation: { latitude: payload.latitude, longitude: payload.longitude } }
          : a)
      );
    });

    socket.on('hospital_reroute_search_started', (payload: any) => {
      if (payload?.message) notify({ tone: 'warning', title: 'Rerouting', text: payload.message, sticky: true });
      fetchDashboardData();
    });

    socket.on('dispatch_diverted', (payload: any) => {
      setPreArrivalAlerts(prev => prev.filter(a => a.dispatchId !== payload?.dispatchId));
      fetchDashboardData();
    });

    socket.on('hospital_reroute_escalated', () => {
      notify({
        tone: 'danger',
        title: 'Escalated to admin',
        text: 'No suitable hospital is currently available. Admin intervention is required.',
        sticky: true,
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Join hospital-specific room once hospitalId is available (handles case where
  // fetchDashboardData completes after socket is already connected)
  useEffect(() => {
    if (!hospitalInfo.id || !socketRef.current) return;
    socketRef.current.emit('join_hospital', { hospitalId: hospitalInfo.id });
  }, [hospitalInfo.id]);

  const handleLogout = () => {
    TokenStorage.removeToken();
    navigate('/');
  };
  
  const handleStatusChange = async (newStatus: string) => {
    const hospitalId = hospitalInfo.id;
    if (!hospitalId) {
      notify({ tone: 'warning', text: 'Hospital data is still loading. Please try again in a moment.' });
      return;
    }
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/hospitals/${hospitalId}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setHospitalInfo(prev => ({ ...prev, status: newStatus }));
    } catch (err) {
      console.error('Failed to update hospital status:', err);
      notify({ tone: 'danger', title: 'Status not changed', text: 'Failed to update hospital status.' });
    }
  };

  const handleCapabilityStatusChange = async (capabilityType: string, newStatus: string) => {
    const hospitalId = hospitalInfo.id;
    if (!hospitalId) {
      notify({ tone: 'warning', text: 'Hospital data is still loading. Please try again in a moment.' });
      return;
    }
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/hospitals/${hospitalId}/capability`,
        { capabilityType, status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setCapabilities(prev =>
        prev.map(cap =>
          cap.type === capabilityType ? { ...cap, status: newStatus } : cap
        )
      );
    } catch (err) {
      console.error('Failed to update capability status:', err);
      notify({ tone: 'danger', title: 'Capability not changed', text: 'Failed to update capability status.' });
    }
  };
  
  const handleUpdateBeds = async (availableBeds: number) => {
    const hospitalId = hospitalInfo.id;
    if (!hospitalId) {
      notify({ tone: 'warning', text: 'Hospital data is still loading. Please try again in a moment.' });
      return;
    }
    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/hospitals/${hospitalId}/beds`,
        { availableBeds },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setStats(prev => ({
        ...prev,
        availableBeds,
        occupiedBeds: prev.totalBeds - availableBeds,
      }));
      notify({ tone: 'success', text: `Available beds set to ${availableBeds}.` });
    } catch (err) {
      console.error('Failed to update bed count:', err);
      notify({ tone: 'danger', title: 'Beds not updated', text: 'Failed to update bed count.' });
    }
  };

  const handleRejectIncoming = async (dispatchId: string) => {
    const hospitalId = hospitalInfo.id;
    if (!hospitalId) {
      notify({ tone: 'warning', text: 'Hospital data is still loading. Please try again in a moment.' });
      return;
    }

    try {
      const token = TokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/hospitals/${hospitalId}/dispatches/${dispatchId}/reject`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPreArrivalAlerts(prev => prev.filter(alert => alert.dispatchId !== dispatchId));
      await fetchDashboardData();
    } catch (err) {
      console.error('Failed to reject incoming patient:', err);
      notify({ tone: 'danger', title: 'Reroute failed', text: 'Failed to reroute this patient.' });
    }
  };

  const bedUtilization = stats.totalBeds > 0 ? Math.round((stats.occupiedBeds / stats.totalBeds) * 100) : 0;

  if (loading) {
    return <PageLoading label="Loading hospital dashboard…" />;
  }

  if (error) {
    return <PageError message={error} onRetry={fetchDashboardData} />;
  }

  const isOpen = (status: string) => status !== 'COMPLETED' && status !== 'CANCELLED';
  const activeAlerts = preArrivalAlerts.filter(a => isOpen(a.status));
  // Open cases first, soonest arrival at the top — the order staff receive them in.
  const orderedAlerts = [...preArrivalAlerts].sort((a, b) => {
    const open = Number(isOpen(b.status)) - Number(isOpen(a.status));
    if (open !== 0) return open;
    return (a.etaMinutes ?? Number.POSITIVE_INFINITY) - (b.etaMinutes ?? Number.POSITIVE_INFINITY);
  });
  const nextArrival = orderedAlerts.find(a => isOpen(a.status));
  const hasCriticalInbound = activeAlerts.some(a => a.patientSeverity === 'CRITICAL');
  const activeBookings = recentBookings.filter(b => isOpen(b.status));
  const bedTone: Tone = bedUtilization >= 90 ? 'danger' : bedUtilization >= 75 ? 'warning' : 'success';

  const NAV: { id: TabType; label: string; icon: IconName; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'prearrivals', label: 'Pre-Arrival', icon: 'ambulance', badge: activeAlerts.length },
    { id: 'emergencies', label: 'Emergency Cases', icon: 'siren' },
    { id: 'beds', label: 'Bed Management', icon: 'bed' },
    { id: 'history', label: 'History', icon: 'history' },
  ];

  const TITLES: Record<TabType, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard Overview', subtitle: 'Live intake, capacity and inbound ambulances' },
    prearrivals: { title: 'Pre-Arrival Alerts', subtitle: 'Ambulances heading to this hospital' },
    emergencies: { title: 'Emergency Cases', subtitle: 'Open cases linked to this hospital' },
    beds: { title: 'Bed Management', subtitle: 'Keep available capacity accurate for dispatch' },
    history: { title: 'Booking History', subtitle: 'Recent bookings for this hospital' },
  };

  const selectTab = (tab: TabType) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  return (
    <div className="ui-app">
      <a href="#main" className="ui-skip-link">Skip to content</a>
      <div className={`ui-scrim${sidebarOpen ? ' is-visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      <aside className={`ui-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Hospital navigation">
        <div className="ui-sidebar__brand">
          <BrandMark />
          <div className="ui-sidebar__brand-text">
            <div className="ui-sidebar__product">ECS Hospital</div>
            <div className="ui-sidebar__portal">Emergency department</div>
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>

        <div className="ui-sidebar__context">
          <div className="ui-sidebar__context-title">{hospitalInfo.name}</div>
          <div className="ui-row">
            <StatusBadge status={hospitalInfo.status} />
          </div>
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
              {!!item.badge && (
                <span className="ui-nav__badge" aria-label={`${item.badge} active`}>{item.badge}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="ui-sidebar__footer">
          <button type="button" onClick={handleLogout} className="ui-btn ui-btn--ghost ui-btn--block hosp-signout">
            <Icon name="logOut" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="ui-main">
        <header className="ui-topbar ui-topbar--wrap">
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--icon ui-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="ui-topbar__titles">
            <h1 className="ui-topbar__title">{TITLES[activeTab].title}</h1>
            <div className="ui-topbar__subtitle ui-num">{formatIstClock(currentTime)}</div>
          </div>
          <div className="ui-topbar__actions">
            <div className="ui-segmented" role="radiogroup" aria-label="Hospital intake status">
              {(['ACCEPTING', 'LIMITED', 'DIVERT'] as const).map(value => {
                const meta = statusMeta(value);
                const active = hospitalInfo.status === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`ui-segmented__item ${toneClass(meta.tone)}${active ? ' is-active' : ''}`}
                    onClick={() => handleStatusChange(value)}
                  >
                    {meta.icon && <Icon name={meta.icon} size={15} />}
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        <main id="main" className="ui-content" key={activeTab}>
          {hospitalInfo.status === 'DIVERT' && (
            <div className="ui-alert tone-danger hosp-banner ui-enter" role="status">
              <Icon name="ban" size={18} />
              <div>
                <div className="ui-alert__title">This hospital is on divert</div>
                New ambulances are being routed to other hospitals until intake is reopened.
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <>
              {nextArrival && (
                <button
                  type="button"
                  className={`hosp-incoming ui-enter ${hasCriticalInbound ? 'tone-danger' : 'tone-info'}`}
                  onClick={() => selectTab('prearrivals')}
                >
                  <span className="ui-icon-tile">
                    <Icon name="siren" size={22} />
                  </span>
                  <span className="hosp-incoming__text">
                    <span className="hosp-incoming__title">
                      <span className="ui-live" aria-hidden="true" />
                      {activeAlerts.length} ambulance{activeAlerts.length === 1 ? '' : 's'} inbound
                    </span>
                    <span className="hosp-incoming__meta">
                      Next: {severityMeta(nextArrival.patientSeverity).label} patient
                      {nextArrival.emergencyType ? ` · ${nextArrival.emergencyType}` : ''}
                      {nextArrival.etaMinutes != null ? ` · ${nextArrival.etaMinutes} min away` : ''}
                      {nextArrival.ambulanceVehicleNumber ? ` · ${nextArrival.ambulanceVehicleNumber}` : ''}
                    </span>
                  </span>
                  <span className="hosp-incoming__cta">
                    View pre-arrival
                    <Icon name="arrowRight" size={16} />
                  </span>
                </button>
              )}

              <section className="ui-kpi-grid ui-kpi-grid--3" aria-label="Key figures">
                <div className={`ui-card ui-kpi ui-enter ${stats.incomingAmbulances > 0 ? 'tone-danger ui-kpi--alert' : 'tone-neutral'}`} style={{ ['--i' as string]: 0 }}>
                  <div className="ui-kpi__top">
                    <span className="ui-kpi__label">Incoming ambulances</span>
                    <span className="ui-kpi__icon"><Icon name="ambulance" /></span>
                  </div>
                  <div className="ui-kpi__value"><AnimatedNumber value={stats.incomingAmbulances} /></div>
                  <div className="ui-kpi__meta">
                    {stats.incomingAmbulances > 0 ? (
                      <Badge tone="danger" dot>En route now</Badge>
                    ) : (
                      'None en route'
                    )}
                  </div>
                </div>

                <div className={`ui-card ui-kpi ui-enter ${stats.activeEmergencies > 0 ? 'tone-orange' : 'tone-neutral'}`} style={{ ['--i' as string]: 1 }}>
                  <div className="ui-kpi__top">
                    <span className="ui-kpi__label">Active emergencies</span>
                    <span className="ui-kpi__icon"><Icon name="siren" /></span>
                  </div>
                  <div className="ui-kpi__value"><AnimatedNumber value={stats.activeEmergencies} /></div>
                  <div className="ui-kpi__meta">{stats.activeEmergencies > 0 ? <Badge tone="orange" icon="alertTriangle">Urgent</Badge> : 'All clear'}</div>
                </div>

                <div className={`ui-card ui-kpi ui-enter ${toneClass(bedTone)}`} style={{ ['--i' as string]: 2 }}>
                  <div className="ui-kpi__top">
                    <span className="ui-kpi__label">Available beds</span>
                    <span className="ui-kpi__icon"><Icon name="bed" /></span>
                  </div>
                  <div className="ui-kpi__value">
                    <AnimatedNumber value={stats.availableBeds} />
                    <span className="ui-kpi__unit">/ {stats.totalBeds}</span>
                  </div>
                  <div className="ui-kpi__meta">{stats.occupiedBeds} occupied</div>
                </div>

                <div className={`ui-card ui-kpi ui-enter ${toneClass(bedTone)}`} style={{ ['--i' as string]: 3 }}>
                  <div className="ui-kpi__top">
                    <span className="ui-kpi__label">Bed utilization</span>
                    <span className="ui-kpi__icon"><Icon name="gauge" /></span>
                  </div>
                  <div className="ui-kpi__value">
                    <AnimatedNumber value={bedUtilization} />
                    <span className="ui-kpi__unit">%</span>
                  </div>
                  <div className="ui-kpi__meta" style={{ display: 'block' }}>
                    <div className="ui-meter" role="meter" aria-valuenow={bedUtilization} aria-valuemin={0} aria-valuemax={100} aria-label="Bed utilization">
                      <div className="ui-meter__fill" style={{ width: `${Math.min(100, bedUtilization)}%` }} />
                    </div>
                  </div>
                </div>

                <div className="ui-card ui-kpi ui-enter tone-success" style={{ ['--i' as string]: 4 }}>
                  <div className="ui-kpi__top">
                    <span className="ui-kpi__label">Completed today</span>
                    <span className="ui-kpi__icon"><Icon name="checkCircle" /></span>
                  </div>
                  <div className="ui-kpi__value"><AnimatedNumber value={stats.completedToday} /></div>
                  <div className="ui-kpi__meta">Bookings processed</div>
                </div>

                <div className="ui-card ui-kpi ui-enter tone-brand" style={{ ['--i' as string]: 5 }}>
                  <div className="ui-kpi__top">
                    <span className="ui-kpi__label">Capabilities</span>
                    <span className="ui-kpi__icon"><Icon name="stethoscope" /></span>
                  </div>
                  <div className="ui-kpi__value"><AnimatedNumber value={capabilities.length} /></div>
                  <div className="ui-kpi__meta">{capabilities.map(c => c.type).join(' · ') || 'None listed'}</div>
                </div>
              </section>

              <div className="hosp-columns">
                <section className="ui-card ui-enter" style={{ ['--i' as string]: 3 }} aria-labelledby="cap-title">
                  <div className="ui-card__header">
                    <div>
                      <h2 id="cap-title" className="ui-card__title"><Icon name="sliders" size={17} />Capability status</h2>
                      <div className="ui-card__subtitle">Set intake per unit — dispatch routes around anything not accepting</div>
                    </div>
                  </div>
                  {capabilities.length === 0 ? (
                    <EmptyState icon="stethoscope" title="No capabilities listed">Capabilities configured for this hospital will appear here.</EmptyState>
                  ) : (
                    <div className="ui-list">
                      {capabilities.map(capability => (
                        <div key={capability.type} className="ui-list__row hosp-capability">
                          <div className="hosp-capability__info">
                            <div className="hosp-capability__name">{capability.name}</div>
                            <div className="hosp-capability__type">{capability.type}</div>
                          </div>
                          <div className="ui-segmented" role="radiogroup" aria-label={`${capability.name} status`}>
                            {(['ACCEPTING', 'LIMITED', 'DIVERT'] as const).map(value => {
                              const meta = statusMeta(value);
                              const active = capability.status === value;
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  className={`ui-segmented__item ${toneClass(meta.tone)}${active ? ' is-active' : ''}`}
                                  onClick={() => handleCapabilityStatusChange(capability.type, value)}
                                >
                                  {active && meta.icon && <Icon name={meta.icon} size={14} />}
                                  {meta.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="ui-card ui-enter" style={{ ['--i' as string]: 4 }} aria-labelledby="recent-title">
                  <div className="ui-card__header">
                    <div>
                      <h2 id="recent-title" className="ui-card__title"><Icon name="clipboardList" size={17} />Recent bookings</h2>
                      <div className="ui-card__subtitle">Newest first, colour-coded by severity</div>
                    </div>
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => selectTab('history')}>
                      View all
                      <Icon name="chevronRight" size={15} />
                    </button>
                  </div>
                  {recentBookings.length === 0 ? (
                    <EmptyState icon="clipboardList" title="No bookings yet">Bookings routed to this hospital will appear here.</EmptyState>
                  ) : (
                    <div className="ui-list">
                      {recentBookings.map(booking => <BookingRow key={booking.id} booking={booking} />)}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}

          {activeTab === 'prearrivals' && (
            <>
              <div className="ui-page-header">
                <div>
                  <h2 className="ui-page-header__title">Incoming ambulances</h2>
                  <p className="ui-page-header__text">
                    Live pre-arrival alerts for {hospitalInfo.name}, soonest arrival first.
                  </p>
                </div>
                {activeAlerts.length > 0 && (
                  <Badge tone="danger" large dot>{activeAlerts.length} active</Badge>
                )}
              </div>

              {orderedAlerts.length === 0 ? (
                <div className="ui-card">
                  <EmptyState icon="ambulance" title={`No incoming ambulances for ${hospitalInfo.name}`}>
                    Pre-arrival alerts appear here as soon as a dispatch is assigned to this hospital.
                  </EmptyState>
                </div>
              ) : (
                <div className="hosp-alerts">
                  {orderedAlerts.map((alert, index) => {
                    const active = isOpen(alert.status);
                    const sev = severityMeta(alert.patientSeverity);
                    const medical = normalizeMedicalProfile(alert.medicalProfile);
                    const medicalAlerts = medicalProfileAlerts(medical);
                    const hasGps = alert.ambulanceLocation.latitude != null && alert.ambulanceLocation.longitude != null;
                    return (
                      <article
                        key={alert.dispatchId}
                        className={`ui-card ui-accent ui-accent--${active ? sev.tone : 'neutral'} hosp-alert ui-enter${active ? '' : ' is-closed'}`}
                        style={{ ['--i' as string]: index }}
                        aria-label={`${sev.label} patient, ${alert.status.replace(/_/g, ' ').toLowerCase()}`}
                      >
                        <header className="hosp-alert__head">
                          <div className="ui-row">
                            <SeverityBadge severity={alert.patientSeverity} large />
                            {alert.emergencyType && <Badge tone="info" icon="stethoscope" large>{alert.emergencyType}</Badge>}
                            <StatusBadge status={alert.status} large />
                          </div>
                          {alert.etaMinutes != null && (
                            <div className={`hosp-eta ${toneClass(active ? sev.tone : 'neutral')}`}>
                              <span className="hosp-eta__value ui-num">{alert.etaMinutes}</span>
                              <span className="hosp-eta__unit">min</span>
                              <span className="hosp-eta__label">ETA</span>
                            </div>
                          )}
                        </header>

                        <div className="hosp-alert__body">
                          <div className="hosp-alert__col">
                            <DriverIdentity
                              driver={alert.driver}
                              vehicleNumber={alert.ambulanceVehicleNumber}
                              accentColor="#0e7490"
                              compact
                            />

                            <dl className="ui-dl hosp-alert__facts">
                              <div className="ui-dl__item">
                                <dt>Ambulance location</dt>
                                <dd className={hasGps ? 'ui-num' : 'is-empty'}>
                                  {hasGps
                                    ? `${Number(alert.ambulanceLocation.latitude).toFixed(4)}, ${Number(alert.ambulanceLocation.longitude).toFixed(4)}`
                                    : 'Awaiting GPS'}
                                </dd>
                              </div>
                              <div className="ui-dl__item">
                                <dt>Alerted</dt>
                                <dd title={formatIstFull(alert.alertedAt)}>
                                  {formatTimeAgo(alert.alertedAt)}
                                  <span className="hosp-alert__time"> · {formatIstTime(alert.alertedAt)}</span>
                                </dd>
                              </div>
                            </dl>

                            {alert.triage && (
                              <div className="hosp-triage">
                                <div className="ui-eyebrow">Triage notes</div>
                                <div className="ui-row">
                                  <TriageChip ok={alert.triage.breathing} label="Breathing" />
                                  <TriageChip ok={!alert.triage.bleeding} label="Bleeding" value={alert.triage.bleeding ? 'Yes' : 'No'} />
                                  <TriageChip ok={alert.triage.conscious} label="Conscious" />
                                  <Badge tone={alert.triage.painLevel >= 7 ? 'orange' : 'neutral'} icon="activity" large>
                                    Pain {alert.triage.painLevel}/10
                                  </Badge>
                                  {alert.triage.pregnancy && <Badge tone="violet" icon="baby" large>Pregnancy</Badge>}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="hosp-alert__col">
                            {/* Medical Profile — included automatically with every
                                pre-alert, using the patient's most recently saved
                                details. Fields they never supplied read "Not Provided"
                                rather than an assumed value. */}
                            {medicalAlerts.length > 0 && (
                              <div className="ui-alert tone-warning">
                                <Icon name="alertTriangle" size={18} />
                                <div>
                                  <div className="ui-alert__title">Prepare for</div>
                                  <ul>
                                    {medicalAlerts.map(item => <li key={item}>{item}</li>)}
                                  </ul>
                                </div>
                              </div>
                            )}
                            <MedicalProfilePanel
                              profile={medical}
                              compact
                              accentColor={active ? undefined : '#94a3b8'}
                              footnote={
                                medical.hasData
                                  ? 'Latest details from the patient profile.'
                                  : 'The patient has not recorded any medical information.'
                              }
                            />
                          </div>
                        </div>

                        {active && (
                          <footer className="ui-card__footer hosp-alert__footer">
                            <span className="ui-help">Unable to receive this patient?</span>
                            <button type="button" className="ui-btn ui-btn--danger-soft ui-btn--sm" onClick={() => setRejectTarget(alert)}>
                              <Icon name="route" size={15} />
                              Reject and reroute
                            </button>
                          </footer>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'emergencies' && (
            <section className="ui-card ui-enter" aria-labelledby="em-title">
              <div className="ui-card__header">
                <div>
                  <h2 id="em-title" className="ui-card__title"><Icon name="siren" size={17} />Active emergency cases</h2>
                  <div className="ui-card__subtitle">Open bookings for this hospital</div>
                </div>
                <Badge tone={stats.activeEmergencies > 0 ? 'danger' : 'neutral'} large dot>{stats.activeEmergencies} active</Badge>
              </div>
              {activeBookings.length > 0 ? (
                <div className="ui-list">
                  {activeBookings.map(booking => <BookingRow key={booking.id} booking={booking} />)}
                </div>
              ) : (
                <EmptyState icon="checkCircle" tone="success" title="No active emergency cases">
                  New emergencies routed to this hospital will appear here.
                </EmptyState>
              )}
            </section>
          )}

          {activeTab === 'history' && (
            <section className="ui-card ui-enter" aria-labelledby="hist-title">
              <div className="ui-card__header">
                <div>
                  <h2 id="hist-title" className="ui-card__title"><Icon name="history" size={17} />Booking history</h2>
                  <div className="ui-card__subtitle">All recent bookings, newest first</div>
                </div>
                <Badge tone="info" large>{recentBookings.length} total</Badge>
              </div>
              {recentBookings.length > 0 ? (
                <div className="ui-list">
                  {recentBookings.map(booking => <BookingRow key={booking.id} booking={booking} />)}
                </div>
              ) : (
                <EmptyState icon="history" title="No booking history">Completed and cancelled bookings will appear here.</EmptyState>
              )}
            </section>
          )}

          {activeTab === 'beds' && (
            <>
              <section className="ui-kpi-grid ui-kpi-grid--4" aria-label="Bed capacity">
                {[
                  { label: 'Total beds', value: stats.totalBeds, icon: 'bedDouble' as IconName, tone: 'brand' as Tone },
                  { label: 'Available', value: stats.availableBeds, icon: 'bed' as IconName, tone: 'success' as Tone },
                  { label: 'Occupied', value: stats.occupiedBeds, icon: 'users' as IconName, tone: 'warning' as Tone },
                  { label: 'Utilization', value: bedUtilization, icon: 'gauge' as IconName, tone: bedTone, unit: '%' },
                ].map((kpi, i) => (
                  <div key={kpi.label} className={`ui-card ui-kpi ui-enter ${toneClass(kpi.tone)}`} style={{ ['--i' as string]: i }}>
                    <div className="ui-kpi__top">
                      <span className="ui-kpi__label">{kpi.label}</span>
                      <span className="ui-kpi__icon"><Icon name={kpi.icon} /></span>
                    </div>
                    <div className="ui-kpi__value">
                      <AnimatedNumber value={kpi.value} />
                      {kpi.unit && <span className="ui-kpi__unit">{kpi.unit}</span>}
                    </div>
                  </div>
                ))}
              </section>

              <section className="ui-card ui-enter hosp-beds" style={{ ['--i' as string]: 4 }} aria-labelledby="beds-title">
                <div className="ui-card__header">
                  <div>
                    <h2 id="beds-title" className="ui-card__title"><Icon name="bed" size={17} />Update available beds</h2>
                    <div className="ui-card__subtitle">Dispatch uses this number to decide where to send patients</div>
                  </div>
                </div>
                <div className="ui-card__body">
                  <div className="ui-field">
                    <label className="ui-label" htmlFor="available-beds">Available beds</label>
                    <div className="hosp-beds__row">
                      <div className="hosp-stepper">
                        <button
                          type="button"
                          className="ui-btn ui-btn--secondary ui-btn--icon ui-btn--lg"
                          onClick={() => setBedUpdateValue(Math.max(0, bedUpdateValue - 1))}
                          aria-label="Decrease by one"
                        >
                          <Icon name="minus" />
                        </button>
                        <input
                          id="available-beds"
                          type="number"
                          className="ui-input ui-input--lg ui-num hosp-stepper__input"
                          value={bedUpdateValue}
                          onChange={(e) => setBedUpdateValue(parseInt(e.target.value) || 0)}
                          min={0}
                          max={stats.totalBeds}
                          aria-describedby="beds-help"
                        />
                        <button
                          type="button"
                          className="ui-btn ui-btn--secondary ui-btn--icon ui-btn--lg"
                          onClick={() => setBedUpdateValue(Math.min(stats.totalBeds, bedUpdateValue + 1))}
                          aria-label="Increase by one"
                        >
                          <Icon name="plus" />
                        </button>
                      </div>
                      <button type="button" className="ui-btn ui-btn--success ui-btn--lg" onClick={() => handleUpdateBeds(bedUpdateValue)}>
                        <Icon name="save" size={17} />
                        Update beds
                      </button>
                    </div>
                    <div id="beds-help" className="ui-help">Of {stats.totalBeds} total beds. Currently recorded: {stats.availableBeds}.</div>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {rejectTarget && (
        <Modal onClose={() => setRejectTarget(null)} labelledBy="reject-title" describedBy="reject-desc" role="alertdialog">
          <div className="ui-modal__header ui-modal__header--plain">
            <span className="ui-icon-tile tone-danger"><Icon name="route" size={22} /></span>
            <div>
              <h2 id="reject-title" className="ui-modal__title">Reject and reroute this patient?</h2>
              <p className="ui-modal__subtitle">
                {severityMeta(rejectTarget.patientSeverity).label} patient · {rejectTarget.ambulanceVehicleNumber}
                {rejectTarget.etaMinutes != null ? ` · ${rejectTarget.etaMinutes} min away` : ''}
              </p>
            </div>
          </div>
          <div className="ui-modal__body">
            <p id="reject-desc" style={{ color: 'var(--text-2)' }}>
              The ambulance will be sent to the next best hospital. Use this only when you cannot safely receive the patient.
            </p>
          </div>
          <div className="ui-modal__footer">
            <button type="button" className="ui-btn ui-btn--secondary" onClick={() => setRejectTarget(null)} data-autofocus>
              Keep patient
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--danger"
              onClick={() => {
                const dispatchId = rejectTarget.dispatchId;
                setRejectTarget(null);
                handleRejectIncoming(dispatchId);
              }}
            >
              Reject and reroute
            </button>
          </div>
        </Modal>
      )}

      <NoticeStack notices={notices} onDismiss={dismiss} />
    </div>
  );
};

/** One row in the bookings lists, accented by severity. */
function BookingRow({ booking }: { booking: Booking }) {
  const sev = severityMeta(booking.severity);
  return (
    <div className={`ui-list__row ui-accent ui-accent--${sev.tone} hosp-booking`}>
      <div className="hosp-booking__id ui-mono">{booking.id}</div>
      <div className="hosp-booking__badges">
        <StatusBadge status={booking.type} />
        <SeverityBadge severity={booking.severity} />
      </div>
      <div className="hosp-booking__status">
        <StatusBadge status={booking.status} variant="dot" />
      </div>
      <div className="hosp-booking__meta">
        {booking.eta && <span className="hosp-booking__eta ui-num"><Icon name="timer" size={14} />ETA {booking.eta}</span>}
        <span className="hosp-booking__time">{booking.time}</span>
      </div>
    </div>
  );
}

/** Yes/no triage observation. Green when reassuring, red when not — always with the word. */
function TriageChip({ ok, label, value }: { ok: boolean; label: string; value?: string }) {
  return (
    <Badge tone={ok ? 'success' : 'danger'} icon={ok ? 'check' : 'alertTriangle'} large>
      {label}: {value ?? (ok ? 'Yes' : 'No')}
    </Badge>
  );
}

export default Dashboard;

