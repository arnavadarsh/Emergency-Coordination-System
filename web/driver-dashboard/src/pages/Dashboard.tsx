import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { tokenStorage } from '../utils/tokenStorage';
import ActiveCaseCard from '../components/ActiveCaseCard';
import CaseChat from '../components/CaseChat';
import { useCaseChats } from '../hooks/useCaseChats';
import { useLocationSharing } from '../utils/useLocationSharing';
import { formatIstDateTime, formatIstFull } from '@shared/utils/datetime';
import { normalizeMedicalProfile, type MedicalProfile } from '@shared/types/medicalProfile';
import { API_BASE_URL, SOCKET_URL } from '../config/api';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { SeverityBadge, StatusBadge } from '@shared/components/ui/Status';
import { BrandMark, EmptyState, PageError, PageLoading, initialsOf } from '@shared/components/ui/primitives';
import '../styles/Dashboard.css';


// ── Interfaces ────────────────────────────────────────────────
interface Booking {
  id: string;
  userId: string;
  pickupLocation: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  dropoffLocation: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  selectedHospitalName?: string;
  selectedHospitalAddress?: string;
  bookingType: 'EMERGENCY' | 'SCHEDULED';
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  createdAt: string;
  patientName?: string;
  patientPhone?: string;
  description?: string;
  /** Patient's standing clinical background, resolved from their profile.
   *  Always present — unset fields read "Not Provided". */
  medicalProfile: MedicalProfile;
}

interface Dispatch {
  id: string;
  bookingId: string;
  ambulanceId: string;
  driverId: string;
  status: string;
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
  photoUrl?: string | null;
  address?: string;
  ambulanceId: string;
  ambulance?: { vehicleNumber: string; type: string; status: string; currentLatitude?: number; currentLongitude?: number };
}

type TabType = 'active' | 'history' | 'profile';
// Loaded when first shown: the map pulls in Leaflet, and neither is needed
// until there is a trip to run.
const DriverRouteMap = lazy(() => import('../components/DriverRouteMap').then(m => ({ default: m.DriverRouteMap })));
const ChecklistModal = lazy(() => import('../components/ChecklistModal'));

const ACTIVE_STATUSES = ['ASSIGNED','DISPATCHED','EN_ROUTE','EN_ROUTE_PICKUP','AT_PICKUP','EN_ROUTE_HOSPITAL','AT_HOSPITAL'];

// New trips and status changes arrive over the socket. This slow poll only
// catches anything missed while the connection was down.
const FALLBACK_REFRESH_MS = 5 * 60_000;

// ── Main ──────────────────────────────────────────────────────
function Dashboard() {
  const navigate = useNavigate();
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [activeDispatch, setActiveDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [showChecklist, setShowChecklist] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [historySearch, setHistorySearch] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', phoneNumber: '', address: '', profilePhotoUrl: '' });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Chat lives at dashboard level so it keeps receiving while the driver is on another tab.
  const chatRooms = useMemo(
    () => (activeDispatch?.booking?.id ? [{ bookingId: activeDispatch.booking.id, dispatchId: activeDispatch.id }] : []),
    [activeDispatch?.booking?.id, activeDispatch?.id],
  );
  const chat = useCaseChats({
    rooms: chatRooms,
    role: 'driver',
    senderName: driverProfile?.name || 'Driver',
    apiBaseUrl: API_BASE_URL,
    getToken: () => tokenStorage.getToken(),
  });

  // Live GPS: reported for as long as this dashboard is open and an ambulance is linked.
  const sharing = useLocationSharing(driverProfile?.ambulanceId || null, Boolean(activeDispatch));
  // The device's own fix is fresher than the copy that came back from the server.
  const ambulanceLat = sharing.latitude ?? driverProfile?.ambulance?.currentLatitude;
  const ambulanceLng = sharing.longitude ?? driverProfile?.ambulance?.currentLongitude;

  const fetchData = async () => {
    try {
      const token = tokenStorage.getToken();
      const { data } = await axios.get(`${API_BASE_URL}/dashboard/driver`, { headers: { Authorization: `Bearer ${token}` } });
      if (data.driver) {
        const p: DriverProfile = {
          id: data.driver.id, email: data.driver.email,
          firstName: data.driver.firstName || '', lastName: data.driver.lastName || '',
          name: data.driver.name || `${data.driver.firstName||''} ${data.driver.lastName||''}`.trim() || 'Driver',
          licenseNumber: data.driver.licenseNumber || 'N/A',
          phoneNumber: data.driver.phoneNumber || 'N/A',
          photoUrl: data.driver.photoUrl || null,
          address: data.driver.address || '', ambulanceId: data.driver.ambulanceId || '',
          ambulance: data.ambulance ? {
            vehicleNumber: data.ambulance.vehicleNumber || 'N/A', type: data.ambulance.type || 'STANDARD',
            status: data.ambulance.status || 'AVAILABLE',
            currentLatitude: data.ambulance.currentLatitude != null ? Number(data.ambulance.currentLatitude) : undefined,
            currentLongitude: data.ambulance.currentLongitude != null ? Number(data.ambulance.currentLongitude) : undefined,
          } : undefined
        };
        setDriverProfile(p);
        setProfileForm({ firstName: p.firstName||'', lastName: p.lastName||'',
          phoneNumber: p.phoneNumber==='N/A'?'':p.phoneNumber, address: p.address||'',
          profilePhotoUrl: p.photoUrl||'' });
      }
      if (data.dispatches?.length) {
        const fmt = data.dispatches.map((d: any): Dispatch => ({
          id: d.id, bookingId: d.bookingId||d.booking?.id,
          ambulanceId: d.ambulanceId, driverId: d.driverId, status: d.status||'ASSIGNED',
          assignedAt: d.assignedAt||d.createdAt, completedAt: d.completedAt,
          booking: {
            id: d.booking?.id||d.bookingId, userId: d.booking?.userId||'',
            pickupLocation: d.booking?.pickupLocation||d.booking?.pickupAddress||'Not specified',
            pickupLatitude: d.booking?.pickupLatitude!=null?Number(d.booking.pickupLatitude):undefined,
            pickupLongitude: d.booking?.pickupLongitude!=null?Number(d.booking.pickupLongitude):undefined,
            dropoffLocation: d.booking?.dropoffLocation||d.booking?.destinationAddress||'Not specified',
            destinationLatitude: d.booking?.destinationLatitude!=null?Number(d.booking.destinationLatitude):undefined,
            destinationLongitude: d.booking?.destinationLongitude!=null?Number(d.booking.destinationLongitude):undefined,
            selectedHospitalName: d.booking?.selectedHospitalName||d.hospital?.name||'Hospital',
            selectedHospitalAddress: d.booking?.selectedHospitalAddress||d.hospital?.address||'',
            bookingType: d.booking?.bookingType||'EMERGENCY', severity: d.booking?.severity||'MEDIUM',
            status: d.booking?.status||'IN_PROGRESS', createdAt: d.booking?.createdAt||d.assignedAt,
            patientName: d.booking?.patientName||d.booking?.user?.name||d.booking?.userName||'Patient',
            patientPhone: d.booking?.patientPhone||d.booking?.user?.phoneNumber||d.booking?.userPhone,
            description: d.booking?.triageData?.chiefComplaint||d.booking?.description,
            // Read live from the patient's profile on every poll, so a profile
            // edit shows up here without the case being re-created.
            medicalProfile: normalizeMedicalProfile(d.booking?.medicalProfile),
          }
        }));
        setDispatches(fmt);
        setActiveDispatch(fmt.find((d: Dispatch) => ACTIVE_STATUSES.includes(d.status))||null);
      } else { setDispatches([]); setActiveDispatch(null); }
      setLoading(false); setError(null);
    } catch (err: any) { setError(err.response?.data?.message||'Failed to load data'); setLoading(false); }
  };

  useEffect(() => { fetchData(); const t = setInterval(fetchData, FALLBACK_REFRESH_MS); return () => clearInterval(t); }, []);
  useEffect(() => {
    // Signed-in sockets only; the server places this driver in their
    // ambulance's room, which is where their trips are announced.
    const socket = io(SOCKET_URL, { transports: ['websocket'], auth: cb => cb({ token: tokenStorage.getToken() }) });
    let connectedBefore = false;
    const onConnect = () => {
      // Catch up on anything that happened while the connection was down.
      if (connectedBefore) fetchData();
      connectedBefore = true;
    };
    const onRerouteSearchStarted = (p: any) => {
      toast.error(p?.message || 'Assigned hospital is currently unable to accept the patient. Searching for the next best hospital.', { duration: 7000 });
      fetchData();
    };
    const onDispatchDiverted = (p: any) => {
      const oldName = p?.oldHospital?.name || 'previous hospital';
      const newName = p?.newHospital?.name || 'new hospital';
      toast.success(`Route updated: ${oldName} -> ${newName}`, { duration: 7000 });
      fetchData();
    };
    const onRerouteEscalated = () => {
      toast.error('No suitable hospital is available. Continue care and wait for admin instructions.', { duration: 10000 });
      fetchData();
    };
    // A message from the operations team, shown however long it takes to read.
    const onAnnouncement = (p: { message: string; tone?: string }) => {
      const show = p?.tone === 'danger' ? toast.error : p?.tone === 'success' ? toast.success : toast;
      show(`Announcement: ${p.message}`, { duration: 12000 });
    };
    socket.on('system_announcement', onAnnouncement);
    socket.on('connect', onConnect);
    socket.on('dispatch_assigned', fetchData);
    socket.on('dispatch_status_updated', fetchData);
    socket.on('hospital_reroute_search_started', onRerouteSearchStarted);
    socket.on('dispatch_diverted', onDispatchDiverted);
    socket.on('hospital_reroute_escalated', onRerouteEscalated);
    return () => {
      socket.off('connect', onConnect);
      socket.off('system_announcement', onAnnouncement);
      socket.off('dispatch_assigned', fetchData);
      socket.off('dispatch_status_updated', fetchData);
      socket.off('hospital_reroute_search_started', onRerouteSearchStarted);
      socket.off('dispatch_diverted', onDispatchDiverted);
      socket.off('hospital_reroute_escalated', onRerouteEscalated);
      socket.disconnect();
    };
  }, []);

  const updateStatus = async (dispatchId: string, newStatus: string) => {
    try {
      const token = tokenStorage.getToken();
      await axios.patch(`${API_BASE_URL}/dispatch/${dispatchId}/status`, { status: newStatus }, { headers: { Authorization: `Bearer ${token}` } });
      await fetchData();
    } catch { toast.error('Failed to update status'); }
  };

  const handleUpdateProfile = async () => {
    try {
      const token = tokenStorage.getToken();
      await axios.patch(`${API_BASE_URL}/users/profile`, profileForm, { headers: { Authorization: `Bearer ${token}` } });
      setEditingProfile(false); await fetchData();
      toast.success('Profile updated successfully!');
    } catch { toast.error('Failed to update profile'); }
  };

  const handleLogout = () => { tokenStorage.clearToken(); navigate('/'); };


  if (loading) return <PageLoading label="Loading your dispatch…" />;

  if (error) return <PageError message={error} onRetry={fetchData} />;

  const historyDispatches = dispatches
    .filter(d => !ACTIVE_STATUSES.includes(d.status))
    .filter(d => historyFilter==='ALL'||d.status===historyFilter)
    .filter(d => !historySearch ||
      d.booking.pickupLocation.toLowerCase().includes(historySearch.toLowerCase()) ||
      (d.booking.selectedHospitalName||'').toLowerCase().includes(historySearch.toLowerCase()) ||
      d.booking.id.includes(historySearch));

  const isAvailable = !activeDispatch;
  const NAV: { id: TabType; icon: IconName; label: string }[] = [
    { id:'active',  icon:'siren', label:'Active Dispatch' },
    { id:'history', icon:'history', label:'Booking History' },
    { id:'profile', icon:'user', label:'Profile' },
  ];
  const TITLES: Record<TabType, { title: string; subtitle: string }> = {
    active: {
      title: 'Active Dispatch',
      subtitle: activeDispatch ? 'Respond quickly — a patient is waiting.' : 'No active dispatch. Waiting for assignment.',
    },
    history: { title: 'Booking History', subtitle: 'All your past dispatches.' },
    profile: { title: 'My Profile', subtitle: 'How patients and hospitals see you' },
  };
  const availability = (
    <span className={`ui-badge ui-badge--lg ${isAvailable ? 'tone-success' : 'tone-danger'}`}>
      <span className={`ui-live${isAvailable ? '' : ' ui-live--static'}`} aria-hidden="true" />
      {isAvailable ? 'Available' : 'On dispatch'}
    </span>
  );
  const SHARING_LABELS: Record<typeof sharing.status, { text: string; tone: string; help: string } | null> = {
    off: null,
    starting: { text: 'Finding location…', tone: 'tone-neutral', help: 'Waiting for this device to report its position.' },
    sharing: { text: 'Sharing location', tone: 'tone-success', help: 'Your position is being sent to dispatch, the patient and the hospital.' },
    denied: { text: 'Location blocked', tone: 'tone-danger', help: 'Allow location access for this site in your browser, then reload. Without it, dispatch and the patient cannot see where you are.' },
    unsupported: { text: 'No location on this device', tone: 'tone-danger', help: 'This browser cannot report a position.' },
    error: { text: 'Location not updating', tone: 'tone-warning', help: 'The position could not be read or sent. It retries automatically.' },
  };
  const sharingLabel = SHARING_LABELS[sharing.status];
  const locationBadge = sharingLabel && (
    <span className={`ui-badge ui-badge--lg ${sharingLabel.tone}`} title={sharingLabel.help} role="status">
      <Icon name="locate" size={14} />
      {sharingLabel.text}
    </span>
  );
  const goToCase = activeDispatch && ['AT_PICKUP','EN_ROUTE_HOSPITAL','AT_HOSPITAL'].includes(activeDispatch.status);

  return (
    <div className="ui-app">
      <a href="#main" className="ui-skip-link">Skip to content</a>

      {showChecklist && driverProfile?.ambulanceId && activeDispatch && (
        <Suspense fallback={null}><ChecklistModal
          ambulanceId={driverProfile.ambulanceId}
          severity={activeDispatch.booking.severity}
          requiredEquipment={(activeDispatch.booking as any).triageData?.ambulance?.equipment}
          onConfirm={() => { setShowChecklist(false); updateStatus(activeDispatch.id, 'EN_ROUTE_PICKUP'); }}
          onClose={() => setShowChecklist(false)}
        /></Suspense>
      )}

      <div className={`ui-scrim${sidebarOpen ? ' is-visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      {/* ── Sidebar ─────────────────────────────── */}
      <aside className={`ui-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Driver navigation">
        <div className="ui-sidebar__brand">
          <BrandMark />
          <div className="ui-sidebar__brand-text">
            <div className="ui-sidebar__product">ECS Driver</div>
            <div className="ui-sidebar__portal">Ambulance crew</div>
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icon name="x" />
          </button>
        </div>

        <div className="ui-sidebar__context">
          <div className="ui-row">{availability}</div>
          {driverProfile?.ambulance && (
            <div className="drv-vehicle">
              <span className="ui-plate"><Icon name="ambulance" size={14} />{driverProfile.ambulance.vehicleNumber}</span>
              <span className="ui-sidebar__context-meta">{driverProfile.ambulance.type}</span>
            </div>
          )}
        </div>

        <nav className="ui-nav" aria-label="Sections">
          {NAV.map(n => (
            <button
              key={n.id}
              type="button"
              className={`ui-nav__item${activeTab===n.id ? ' is-active' : ''}`}
              aria-current={activeTab===n.id ? 'page' : undefined}
              onClick={() => { setActiveTab(n.id); setSidebarOpen(false); }}
            >
              <Icon name={n.icon} />
              {n.label}
              {n.id==='active' && chat.totalUnread > 0 && (
                <span className="ui-nav__badge" aria-label={`${chat.totalUnread} unread messages`}>{chat.totalUnread}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="ui-sidebar__footer">
          <div className="ui-user">
            <span className="ui-avatar">{initialsOf(driverProfile?.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="ui-user__name ui-truncate">{driverProfile?.name}</div>
              <div className="ui-user__meta ui-truncate">Lic: {driverProfile?.licenseNumber}</div>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="ui-btn ui-btn--ghost ui-btn--block drv-signout">
            <Icon name="logOut" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────── */}
      <div className="ui-main">
        <header className="ui-topbar ui-topbar--wrap">
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--icon ui-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div className="ui-topbar__titles">
            <h1 className="ui-topbar__title">{TITLES[activeTab].title}</h1>
            <div className="ui-topbar__subtitle">{TITLES[activeTab].subtitle}</div>
          </div>
          <div className="ui-topbar__actions">{locationBadge}{availability}</div>
        </header>

        <main id="main" className="ui-content ui-content--narrow" key={activeTab}>
          {/* Active Dispatch */}
          {activeTab==='active' && (
            activeDispatch ? (
              <div className="ui-stack">
                <ActiveCaseCard
                  dispatch={activeDispatch}
                  onStartJourney={() => setShowChecklist(true)}
                  onArrivedPickup={() => updateStatus(activeDispatch.id,'AT_PICKUP')}
                  onEnRouteHospital={() => updateStatus(activeDispatch.id,'EN_ROUTE_HOSPITAL')}
                  onArrivedHospital={() => updateStatus(activeDispatch.id,'AT_HOSPITAL')}
                  onComplete={() => updateStatus(activeDispatch.id,'COMPLETED')}
                />

                {['ASSIGNED','DISPATCHED','EN_ROUTE_PICKUP','EN_ROUTE'].includes(activeDispatch.status) && (
                  <section className="ui-card ui-enter" style={{ ['--i' as string]: 1 }}>
                    <Suspense fallback={null}><DriverRouteMap ambulanceLat={ambulanceLat} ambulanceLng={ambulanceLng}
                      targetLat={activeDispatch.booking.pickupLatitude} targetLng={activeDispatch.booking.pickupLongitude}
                      targetLabel={activeDispatch.booking.pickupLocation} title="Route to patient" ctaLabel="Open in Maps" /></Suspense>
                  </section>
                )}

                {goToCase && (
                  <section className="ui-card ui-enter" style={{ ['--i' as string]: 1 }}>
                    <Suspense fallback={null}><DriverRouteMap ambulanceLat={ambulanceLat} ambulanceLng={ambulanceLng}
                      targetLat={activeDispatch.booking.destinationLatitude} targetLng={activeDispatch.booking.destinationLongitude}
                      targetLabel={activeDispatch.booking.selectedHospitalName||activeDispatch.booking.dropoffLocation}
                      title="Route to hospital" ctaLabel="Open in Maps" /></Suspense>
                  </section>
                )}

                <div className="ui-enter" style={{ ['--i' as string]: 2 }}>
                  <CaseChat
                    bookingId={activeDispatch.booking.id}
                    currentRole="driver"
                    title="Chat with Patient"
                    active={activeTab === 'active'}
                    connected={chat.connected}
                    thread={chat.threads[activeDispatch.booking.id]}
                    onSend={text => chat.send(activeDispatch.booking.id, text)}
                    onSendImage={file => { void chat.sendImage(activeDispatch.booking.id, file); }}
                    onRetry={clientId => chat.retry(activeDispatch.booking.id, clientId)}
                    apiBaseUrl={API_BASE_URL}
                    onVisibilityChange={visible => chat.setRoomVisible(activeDispatch.booking.id, visible)}
                  />
                </div>
              </div>
            ) : (
              <div className="ui-card ui-enter drv-standby">
                <div className="drv-standby__radar" aria-hidden="true">
                  <span /><span />
                  <Icon name="radio" size={28} />
                </div>
                <h2 className="drv-standby__title">You're available</h2>
                <p className="drv-standby__text">Waiting for dispatch. A new case will appear here automatically.</p>
                {driverProfile?.ambulance && (
                  <div className="ui-row" style={{ justifyContent: 'center', marginTop: 4 }}>
                    <span className="ui-plate"><Icon name="ambulance" size={14} />{driverProfile.ambulance.vehicleNumber}</span>
                    <span className="ui-help">{driverProfile.ambulance.type}</span>
                  </div>
                )}
              </div>
            )
          )}

          {/* Booking History */}
          {activeTab==='history' && (
            <>
              <div className="ui-toolbar">
                <div className="ui-input-wrap ui-toolbar__search">
                  <Icon name="search" size={16} />
                  <input
                    className="ui-input"
                    value={historySearch}
                    onChange={e => setHistorySearch(e.target.value)}
                    placeholder="Search location or ID…"
                    aria-label="Search history"
                  />
                </div>
                <div className="ui-segmented" role="tablist" aria-label="Filter by outcome">
                  {(['ALL','COMPLETED','CANCELLED'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      role="tab"
                      aria-selected={historyFilter===f}
                      className={`ui-segmented__item${historyFilter===f ? ' is-active' : ''}`}
                      onClick={() => setHistoryFilter(f)}
                    >
                      {f === 'ALL' ? 'All' : f === 'COMPLETED' ? 'Completed' : 'Cancelled'}
                    </button>
                  ))}
                </div>
              </div>

              {historyDispatches.length > 0 ? (
                <div className="ui-stack drv-history">
                  {historyDispatches.map((d, i) => (
                    <article key={d.id} className="ui-card drv-history__item ui-enter" style={{ ['--i' as string]: Math.min(i, 8) }}>
                      <div className="drv-history__head">
                        <div style={{ minWidth: 0 }}>
                          <div className="drv-history__ref ui-mono">#{d.booking.id.slice(0,12).toUpperCase()}</div>
                          <div className="drv-history__patient">{d.booking.patientName||'Patient'}</div>
                        </div>
                        <div className="ui-row" style={{ justifyContent: 'flex-end' }}>
                          {d.booking.severity && <SeverityBadge severity={d.booking.severity} emphasizeCritical={false} />}
                          <StatusBadge status={d.status} />
                        </div>
                      </div>
                      <div className="drv-history__route">
                        <span className="drv-history__stop"><Icon name="mapPin" size={15} /><span className="ui-truncate">{d.booking.pickupLocation}</span></span>
                        <Icon name="arrowRight" size={15} className="drv-history__arrow" />
                        <span className="drv-history__stop"><Icon name="hospital" size={15} /><span className="ui-truncate">{d.booking.selectedHospitalName||d.booking.dropoffLocation}</span></span>
                      </div>
                      <div className="drv-history__time" title={formatIstFull(d.assignedAt)}>
                        <Icon name="clock" size={13} />
                        {formatIstDateTime(d.assignedAt)}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="ui-card">
                  <EmptyState icon="clipboardList" title="No history found">
                    {historySearch || historyFilter !== 'ALL' ? 'Try a different search or filter.' : 'Completed dispatches will appear here.'}
                  </EmptyState>
                </div>
              )}
            </>
          )}

          {/* Profile */}
          {activeTab==='profile' && (
            <div className="ui-stack">
              {/* How patients and the receiving hospital see you on their tracking / pre-arrival screens. */}
              <section className="ui-card ui-enter drv-identity">
                <span className="ui-avatar ui-avatar--lg drv-identity__avatar">
                  {driverProfile?.photoUrl ? (
                    <img src={driverProfile.photoUrl} alt={driverProfile.name}
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  ) : initialsOf(driverProfile?.name)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="ui-eyebrow">Identity shown to patients &amp; hospitals</div>
                  <div className="drv-identity__name">{driverProfile?.name}</div>
                  <div className="ui-help">
                    {driverProfile?.ambulance?.vehicleNumber || 'No vehicle assigned'}
                    {!driverProfile?.photoUrl && ' · Add a Photo URL below to show your photo'}
                  </div>
                </div>
              </section>

              {driverProfile?.ambulance && (
                <section className="ui-card ui-enter drv-assigned" style={{ ['--i' as string]: 1 }}>
                  <span className="ui-icon-tile"><Icon name="ambulance" size={22} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ui-eyebrow">Assigned vehicle</div>
                    <div className="drv-assigned__plate ui-mono">{driverProfile.ambulance.vehicleNumber}</div>
                  </div>
                  <div className="ui-row">
                    <span className="ui-badge tone-neutral">{driverProfile.ambulance.type}</span>
                    <StatusBadge status={driverProfile.ambulance.status} />
                  </div>
                </section>
              )}

              <section className="ui-card ui-enter" style={{ ['--i' as string]: 2 }} aria-labelledby="personal-title">
                <div className="ui-card__header">
                  <h2 id="personal-title" className="ui-card__title"><Icon name="idCard" size={17} />Personal information</h2>
                  {!editingProfile ? (
                    <button type="button" onClick={() => setEditingProfile(true)} className="ui-btn ui-btn--secondary ui-btn--sm">
                      <Icon name="pencil" size={14} />
                      Edit profile
                    </button>
                  ) : (
                    <div className="ui-row">
                      <button type="button" onClick={() => setEditingProfile(false)} className="ui-btn ui-btn--ghost ui-btn--sm">Cancel</button>
                      <button type="button" onClick={handleUpdateProfile} className="ui-btn ui-btn--success ui-btn--sm">
                        <Icon name="save" size={14} />
                        Save changes
                      </button>
                    </div>
                  )}
                </div>

                <div className="ui-card__body">
                  {!editingProfile ? (
                    <dl className="ui-dl">
                      {([['Name', driverProfile?.name],['Email', driverProfile?.email],
                         ['Phone', driverProfile?.phoneNumber],['License', driverProfile?.licenseNumber],
                         ['Address', driverProfile?.address||'Not set']] as [string, string | undefined][]).map(([label, val]) => (
                        <div key={label} className={`ui-dl__item${label === 'Address' ? ' ui-dl__item--wide' : ''}`}>
                          <dt>{label}</dt>
                          <dd className={!val || val === 'Not set' || val === 'N/A' ? 'is-empty' : undefined}>{val || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <div className="ui-form-grid">
                      {[['First Name','firstName'],['Last Name','lastName'],['Phone','phoneNumber'],['Address','address'],['Photo URL','profilePhotoUrl']].map(([label, key]) => (
                        <div key={key} className={`ui-field${key === 'address' || key === 'profilePhotoUrl' ? ' is-wide' : ''}`}>
                          <label className="ui-label" htmlFor={`profile-${key}`}>{label}</label>
                          <input
                            id={`profile-${key}`}
                            className="ui-input"
                            value={(profileForm as any)[key]}
                            onChange={e => setProfileForm(p => ({...p,[key]:e.target.value}))}
                            type={key === 'phoneNumber' ? 'tel' : key === 'profilePhotoUrl' ? 'url' : 'text'}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default Dashboard;
