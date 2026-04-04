import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { tokenStorage } from '../utils/tokenStorage';
import { DriverRouteMap } from '../components/DriverRouteMap';
import ActiveCaseCard from '../components/ActiveCaseCard';
import ChecklistModal from '../components/ChecklistModal';

const API_BASE_URL = 'http://localhost:3000/api';

// ── Palette (matches user dashboard) ─────────────────────────
const C = {
  pageBg:       '#f5f7fa',
  sidebar:      '#ffffff',
  sidebarBorder:'#e0e0e0',
  card:         '#ffffff',
  cardBorder:   '#e0e0e0',
  input:        '#f5f7fa',
  textPrimary:  '#172b4d',
  textSecondary:'#6b778c',
  textMuted:    '#97a0af',
  accent:       '#00a3bf',
  accentSoft:   '#e6f7f9',
  accentHover:  '#008a9e',
  red:          '#de350b',
  redSoft:      '#fff4f2',
  green:        '#00875a',
  greenSoft:    '#e3fcef',
};

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
  address?: string;
  ambulanceId: string;
  ambulance?: { vehicleNumber: string; type: string; status: string; currentLatitude?: number; currentLongitude?: number };
}

type TabType = 'active' | 'history' | 'profile';
const ACTIVE_STATUSES = ['ASSIGNED','DISPATCHED','EN_ROUTE','EN_ROUTE_PICKUP','AT_PICKUP','EN_ROUTE_HOSPITAL','AT_HOSPITAL'];

function sevColor(s?: string) {
  return s === 'CRITICAL' ? '#de350b' : s === 'HIGH' ? '#ff8b00' : s === 'MEDIUM' ? '#ffab00' : '#00875a';
}
function statusLabel(s: string) { return s.replace(/_/g, ' '); }

// ── Sidebar NavButton ─────────────────────────────────────────
function NavItem({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '12px 16px', borderRadius: '8px', border: 'none',
      cursor: 'pointer', textAlign: 'left', width: '100%',
      background: active ? C.accentSoft : 'transparent',
      color: active ? C.accent : C.textSecondary,
      fontWeight: active ? 600 : 500, fontSize: '14px',
      transition: 'all 0.2s',
    }}>
      <span style={{ fontSize: '18px' }}>{icon}</span>
      {label}
    </button>
  );
}

// ── Card ──────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.card, borderRadius: '12px',
      border: `1px solid ${C.cardBorder}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Field label ───────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>
      {children}
    </div>
  );
}

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
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', phoneNumber: '', address: '' });

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
          phoneNumber: p.phoneNumber==='N/A'?'':p.phoneNumber, address: p.address||'' });
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
            patientName: d.booking?.user?.name||d.booking?.userName||'Patient',
            patientPhone: d.booking?.user?.phoneNumber||d.booking?.userPhone,
            description: d.booking?.triageData?.chiefComplaint||d.booking?.description,
          }
        }));
        setDispatches(fmt);
        setActiveDispatch(fmt.find((d: Dispatch) => ACTIVE_STATUSES.includes(d.status))||null);
      } else { setDispatches([]); setActiveDispatch(null); }
      setLoading(false); setError(null);
    } catch (err: any) { setError(err.response?.data?.message||'Failed to load data'); setLoading(false); }
  };

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const socket = io('http://localhost:3000', { transports: ['websocket'] });
    socket.on('dispatch_assigned', fetchData);
    socket.on('dispatch_status_updated', fetchData);
    socket.on('dispatch_diverted', (p: any) => { if (p?.newHospital) alert(`Diverted to ${p.newHospital.name}`); fetchData(); });
    return () => { socket.off('dispatch_assigned', fetchData); socket.off('dispatch_status_updated', fetchData); socket.disconnect(); };
  }, []);

  const updateStatus = async (dispatchId: string, newStatus: string) => {
    try {
      const token = tokenStorage.getToken();
      await axios.patch(`${API_BASE_URL}/dispatch/${dispatchId}/status`, { status: newStatus }, { headers: { Authorization: `Bearer ${token}` } });
      await fetchData();
    } catch { alert('Failed to update status'); }
  };

  const handleUpdateProfile = async () => {
    try {
      const token = tokenStorage.getToken();
      await axios.patch(`${API_BASE_URL}/users/profile`, profileForm, { headers: { Authorization: `Bearer ${token}` } });
      setEditingProfile(false); await fetchData();
    } catch { alert('Failed to update profile'); }
  };

  const handleLogout = () => { tokenStorage.clearToken(); navigate('/'); };

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', background: C.pageBg, flexDirection:'column', gap:'16px' }}>
      <div style={{ width:'36px', height:'36px', borderRadius:'50%', border:`3px solid ${C.accentSoft}`, borderTopColor: C.accent, animation:'spin 0.8s linear infinite' }} />
      <div style={{ fontSize:'14px', color: C.textSecondary }}>Loading dashboard…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', background: C.pageBg, flexDirection:'column', gap:'12px' }}>
      <div style={{ fontSize:'36px' }}>⚠️</div>
      <div style={{ fontSize:'16px', color: C.red, fontWeight:600 }}>{error}</div>
      <button onClick={fetchData} style={{ padding:'10px 24px', background: C.accent, color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:600 }}>Retry</button>
    </div>
  );

  const historyDispatches = dispatches
    .filter(d => !ACTIVE_STATUSES.includes(d.status))
    .filter(d => historyFilter==='ALL'||d.status===historyFilter)
    .filter(d => !historySearch ||
      d.booking.pickupLocation.toLowerCase().includes(historySearch.toLowerCase()) ||
      (d.booking.selectedHospitalName||'').toLowerCase().includes(historySearch.toLowerCase()) ||
      d.booking.id.includes(historySearch));

  const isAvailable = !activeDispatch;
  const NAV: { id: TabType; icon: string; label: string }[] = [
    { id:'active',  icon:'🚑', label:'Active Dispatch' },
    { id:'history', icon:'📋', label:'Booking History' },
    { id:'profile', icon:'👤', label:'Profile' },
  ];

  return (
    <div style={{ display:'flex', minHeight:'100vh', background: C.pageBg, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', color: C.textPrimary }}>
      <style>{`*{box-sizing:border-box} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:${C.pageBg}} ::-webkit-scrollbar-thumb{background:${C.cardBorder};border-radius:9999px}`}</style>

      {showChecklist && driverProfile?.ambulanceId && activeDispatch && (
        <ChecklistModal
          ambulanceId={driverProfile.ambulanceId}
          severity={activeDispatch.booking.severity}
          requiredEquipment={(activeDispatch.booking as any).triageData?.ambulance?.equipment}
          onConfirm={() => { setShowChecklist(false); updateStatus(activeDispatch.id, 'EN_ROUTE_PICKUP'); }}
          onClose={() => setShowChecklist(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────── */}
      <aside style={{ width:'260px', flexShrink:0, background: C.sidebar, borderRight:`1px solid ${C.sidebarBorder}`,
        display:'flex', flexDirection:'column', position:'sticky', top:0, height:'100vh',
        boxShadow:'2px 0 8px rgba(0,0,0,0.05)' }}>

        {/* Logo */}
        <div style={{ padding:'24px', borderBottom:`1px solid ${C.sidebarBorder}` }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'12px' }}>
            <span style={{ fontSize:'28px' }}>🚑</span>
            <span style={{ fontSize:'20px', fontWeight:700, color: C.textPrimary }}>ECS Driver</span>
          </div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:'6px',
            padding:'5px 12px', borderRadius:'12px', fontSize:'12px', fontWeight:600,
            background: isAvailable ? C.greenSoft : C.redSoft,
            color: isAvailable ? C.green : C.red }}>
            <div style={{ width:'7px', height:'7px', borderRadius:'50%', background: isAvailable ? C.green : C.red }} />
            {isAvailable ? 'AVAILABLE' : 'ON DISPATCH'}
          </div>
        </div>

        {/* Vehicle */}
        {driverProfile?.ambulance && (
          <div style={{ padding:'14px 24px', borderBottom:`1px solid ${C.sidebarBorder}` }}>
            <div style={{ fontSize:'13px', color: C.textPrimary, fontWeight:600 }}>{driverProfile.ambulance.vehicleNumber}</div>
            <div style={{ fontSize:'12px', color: C.textSecondary }}>{driverProfile.ambulance.type}</div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex:1, padding:'16px', display:'flex', flexDirection:'column', gap:'4px' }}>
          {NAV.map(n => <NavItem key={n.id} icon={n.icon} label={n.label} active={activeTab===n.id} onClick={() => setActiveTab(n.id)} />)}
        </nav>

        {/* Driver info + logout */}
        <div style={{ padding:'16px 24px', borderTop:`1px solid ${C.sidebarBorder}` }}>
          <div style={{ fontSize:'14px', fontWeight:600, color: C.textPrimary, marginBottom:'2px' }}>{driverProfile?.name}</div>
          <div style={{ fontSize:'12px', color: C.textSecondary, marginBottom:'12px' }}>Lic: {driverProfile?.licenseNumber}</div>
          <button onClick={handleLogout} style={{ width:'100%', padding:'10px 12px',
            background:'white', color: C.textSecondary, border:`1px solid ${C.cardBorder}`,
            borderRadius:'8px', cursor:'pointer', fontSize:'13px', fontWeight:500,
            display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', transition:'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.cardBorder; e.currentTarget.style.color = C.textSecondary; }}>
            Sign Out →
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────── */}
      <main style={{ flex:1, overflowY:'auto', padding:'32px' }}>

        {/* Active Dispatch */}
        {activeTab==='active' && (
          <div style={{ maxWidth:'700px', margin:'0 auto' }}>
            <h1 style={{ fontSize:'28px', fontWeight:700, color: C.textPrimary, margin:'0 0 4px' }}>Active Dispatch</h1>
            <p style={{ fontSize:'15px', color: C.textSecondary, margin:'0 0 24px' }}>
              {activeDispatch ? 'Respond quickly — a patient is waiting.' : 'No active dispatch. Waiting for assignment.'}
            </p>

            {activeDispatch ? (
              <>
                <ActiveCaseCard
                  dispatch={activeDispatch}
                  onStartJourney={() => setShowChecklist(true)}
                  onArrivedPickup={() => updateStatus(activeDispatch.id,'AT_PICKUP')}
                  onEnRouteHospital={() => updateStatus(activeDispatch.id,'EN_ROUTE_HOSPITAL')}
                  onArrivedHospital={() => updateStatus(activeDispatch.id,'AT_HOSPITAL')}
                  onComplete={() => updateStatus(activeDispatch.id,'COMPLETED')}
                />

                {['ASSIGNED','DISPATCHED','EN_ROUTE_PICKUP','EN_ROUTE'].includes(activeDispatch.status) && (
                  <Card style={{ overflow:'hidden', marginTop:'20px' }}>
                    <div style={{ padding:'14px 20px', borderBottom:`1px solid ${C.cardBorder}` }}>
                      <span style={{ fontSize:'14px', fontWeight:600, color: C.textPrimary }}>🗺 Route to Patient</span>
                    </div>
                    <DriverRouteMap ambulanceLat={driverProfile?.ambulance?.currentLatitude} ambulanceLng={driverProfile?.ambulance?.currentLongitude}
                      targetLat={activeDispatch.booking.pickupLatitude} targetLng={activeDispatch.booking.pickupLongitude}
                      targetLabel={activeDispatch.booking.pickupLocation} title="Route To Patient" ctaLabel="Open in Maps" />
                  </Card>
                )}

                {['AT_PICKUP','EN_ROUTE_HOSPITAL','AT_HOSPITAL'].includes(activeDispatch.status) && (
                  <Card style={{ overflow:'hidden', marginTop:'20px' }}>
                    <div style={{ padding:'14px 20px', borderBottom:`1px solid ${C.cardBorder}` }}>
                      <span style={{ fontSize:'14px', fontWeight:600, color: C.textPrimary }}>🏥 Route to Hospital</span>
                    </div>
                    <DriverRouteMap ambulanceLat={driverProfile?.ambulance?.currentLatitude} ambulanceLng={driverProfile?.ambulance?.currentLongitude}
                      targetLat={activeDispatch.booking.destinationLatitude} targetLng={activeDispatch.booking.destinationLongitude}
                      targetLabel={activeDispatch.booking.selectedHospitalName||activeDispatch.booking.dropoffLocation}
                      title="Route To Hospital" ctaLabel="Open in Maps" />
                  </Card>
                )}
              </>
            ) : (
              <Card style={{ padding:'60px 24px', textAlign:'center' }}>
                <div style={{ fontSize:'56px', marginBottom:'16px' }}>🟢</div>
                <h2 style={{ margin:'0 0 8px', fontSize:'20px', fontWeight:600, color: C.textPrimary }}>You're Available</h2>
                <p style={{ margin:0, fontSize:'14px', color: C.textSecondary, lineHeight:1.6 }}>
                  Waiting for dispatch. A new case will appear here automatically.
                </p>
              </Card>
            )}
          </div>
        )}

        {/* Booking History */}
        {activeTab==='history' && (
          <div style={{ maxWidth:'700px', margin:'0 auto' }}>
            <h1 style={{ fontSize:'28px', fontWeight:700, color: C.textPrimary, margin:'0 0 4px' }}>Booking History</h1>
            <p style={{ fontSize:'15px', color: C.textSecondary, margin:'0 0 24px' }}>All your past dispatches.</p>

            <div style={{ display:'flex', gap:'10px', marginBottom:'20px', flexWrap:'wrap' }}>
              <input value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                placeholder="Search location or ID…"
                style={{ flex:1, minWidth:'200px', padding:'10px 14px', border:`1px solid ${C.cardBorder}`,
                  borderRadius:'8px', fontSize:'14px', outline:'none', background:'white', color: C.textPrimary,
                  transition:'all 0.2s', fontFamily:'inherit' }}
                onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = `0 0 0 3px rgba(0,163,191,0.1)`; }}
                onBlur={e => { e.target.style.borderColor = C.cardBorder; e.target.style.boxShadow = 'none'; }} />
              {(['ALL','COMPLETED','CANCELLED'] as const).map(f => (
                <button key={f} onClick={() => setHistoryFilter(f)} style={{
                  padding:'10px 14px', borderRadius:'8px', border:'1px solid',
                  borderColor: historyFilter===f ? C.accent : C.cardBorder,
                  background: historyFilter===f ? C.accentSoft : 'white',
                  color: historyFilter===f ? C.accent : C.textSecondary,
                  fontWeight: historyFilter===f ? 600 : 500, fontSize:'13px', cursor:'pointer', transition:'all 0.2s',
                }}>
                  {f}
                </button>
              ))}
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              {historyDispatches.length > 0 ? historyDispatches.map(d => (
                <Card key={d.id} style={{ padding:'18px 20px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'12px' }}>
                    <div>
                      <div style={{ fontFamily:'monospace', fontSize:'12px', color: C.textMuted, marginBottom:'2px' }}>
                        #{d.booking.id.slice(0,12).toUpperCase()}
                      </div>
                      <div style={{ fontSize:'15px', fontWeight:600, color: C.textPrimary }}>{d.booking.patientName||'Patient'}</div>
                    </div>
                    <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', justifyContent:'flex-end' }}>
                      {d.booking.severity && (
                        <span style={{ padding:'3px 10px', borderRadius:'10px', fontSize:'11px', fontWeight:600,
                          color:'white', background: sevColor(d.booking.severity), textTransform:'uppercase', letterSpacing:'0.5px' }}>
                          {d.booking.severity}
                        </span>
                      )}
                      <span style={{ padding:'3px 10px', borderRadius:'10px', fontSize:'11px', fontWeight:600, color:'white',
                        background: d.status==='COMPLETED' ? C.green : C.red, textTransform:'uppercase', letterSpacing:'0.5px' }}>
                        {statusLabel(d.status)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:'8px', alignItems:'center', fontSize:'13px', color: C.textSecondary, marginBottom:'10px',
                    padding:'10px 12px', background: C.pageBg, borderRadius:'8px' }}>
                    <span>📍</span>
                    <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.booking.pickupLocation}</span>
                    <span>→</span>
                    <span>🏥</span>
                    <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.booking.selectedHospitalName||d.booking.dropoffLocation}</span>
                  </div>
                  <div style={{ fontSize:'12px', color: C.textMuted }}>{new Date(d.assignedAt).toLocaleString()}</div>
                </Card>
              )) : (
                <Card style={{ padding:'48px 24px', textAlign:'center' }}>
                  <div style={{ fontSize:'40px', marginBottom:'12px' }}>📋</div>
                  <div style={{ fontSize:'16px', fontWeight:600, color: C.textSecondary, marginBottom:'6px' }}>No History Found</div>
                  <div style={{ fontSize:'13px', color: C.textMuted }}>Completed dispatches will appear here.</div>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Profile */}
        {activeTab==='profile' && (
          <div style={{ maxWidth:'560px', margin:'0 auto' }}>
            <h1 style={{ fontSize:'28px', fontWeight:700, color: C.textPrimary, margin:'0 0 24px' }}>My Profile</h1>

            {driverProfile?.ambulance && (
              <Card style={{ padding:'20px', marginBottom:'16px', background: C.accentSoft, borderColor: C.accent }}>
                <FieldLabel>Assigned Vehicle</FieldLabel>
                <div style={{ fontSize:'20px', fontWeight:700, color: C.textPrimary, marginBottom:'2px' }}>{driverProfile.ambulance.vehicleNumber}</div>
                <div style={{ fontSize:'13px', color: C.textSecondary }}>{driverProfile.ambulance.type} · Status: {driverProfile.ambulance.status}</div>
              </Card>
            )}

            <Card>
              <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.cardBorder}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:'16px', fontWeight:600, color: C.textPrimary }}>Personal Information</span>
                {!editingProfile ? (
                  <button onClick={() => setEditingProfile(true)} style={{ padding:'7px 16px', background: C.accentSoft, color: C.accent,
                    border:`1px solid ${C.accent}`, borderRadius:'8px', cursor:'pointer', fontWeight:600, fontSize:'13px' }}>
                    Edit Profile
                  </button>
                ) : (
                  <div style={{ display:'flex', gap:'8px' }}>
                    <button onClick={() => setEditingProfile(false)} style={{ padding:'7px 14px', background:'white', color: C.textSecondary,
                      border:`1px solid ${C.cardBorder}`, borderRadius:'8px', cursor:'pointer', fontWeight:600, fontSize:'13px' }}>Cancel</button>
                    <button onClick={handleUpdateProfile} style={{ padding:'7px 14px', background: C.green, color:'white',
                      border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:600, fontSize:'13px' }}>Save Changes</button>
                  </div>
                )}
              </div>

              <div style={{ padding:'20px', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:'16px' }}>
                {!editingProfile ? (
                  [['Name', driverProfile?.name],['Email', driverProfile?.email],
                   ['Phone', driverProfile?.phoneNumber],['License', driverProfile?.licenseNumber],
                   ['Address', driverProfile?.address||'Not set']].map(([label, val]) => (
                    <div key={label as string} style={{ padding:'14px', background: C.pageBg, borderRadius:'8px' }}>
                      <FieldLabel>{label}</FieldLabel>
                      <div style={{ fontSize:'15px', color: C.textPrimary, fontWeight:500 }}>{val}</div>
                    </div>
                  ))
                ) : (
                  [['First Name','firstName'],['Last Name','lastName'],['Phone','phoneNumber'],['Address','address']].map(([label, key]) => (
                    <div key={key}>
                      <label style={{ display:'block', fontSize:'13px', fontWeight:600, color: C.textPrimary, marginBottom:'6px' }}>{label}</label>
                      <input value={(profileForm as any)[key]} onChange={e => setProfileForm(p => ({...p,[key]:e.target.value}))}
                        style={{ width:'100%', padding:'11px 12px', border:`1px solid ${C.cardBorder}`, borderRadius:'8px',
                          fontSize:'14px', outline:'none', fontFamily:'inherit', color: C.textPrimary, background:'white', transition:'all 0.2s' }}
                        onFocus={e => { e.target.style.borderColor = C.accent; e.target.style.boxShadow = `0 0 0 3px rgba(0,163,191,0.1)`; }}
                        onBlur={e => { e.target.style.borderColor = C.cardBorder; e.target.style.boxShadow='none'; }} />
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        )}

      </main>
    </div>
  );
}

export default Dashboard;
