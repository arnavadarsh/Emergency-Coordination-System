import React, { useState, FormEvent, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ApiClient from '../services/api';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── Palette ──────────────────────────────────────────────────
const C = {
  teal: '#00a3bf',
  tealDark: '#007a8e',
  tealSoft: '#e6f7f9',
  navy: '#172b4d',
  text: '#253858',
  sub: '#6b778c',
  muted: '#97a0af',
  border: '#dfe1e6',
  bg: '#f4f5f7',
  white: '#ffffff',
  red: '#de350b',
  green: '#00875a',
};

// ── Inline SVG illustration (hospital + ambulance, no emoji) ──
const Illustration: React.FC = () => (
  <svg viewBox="0 0 480 520" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#005f7a" />
        <stop offset="60%" stopColor="#007a8e" />
        <stop offset="100%" stopColor="#00a3bf" />
      </linearGradient>
      <linearGradient id="skyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#003d54" />
        <stop offset="100%" stopColor="#006a82" />
      </linearGradient>
      <linearGradient id="blobGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00c6e0" stopOpacity="0.25" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.10" />
      </linearGradient>
      <linearGradient id="ambGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#d8eef2" />
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>

    {/* Background */}
    <rect width="480" height="520" fill="url(#bgGrad)" />

    {/* Sky layer */}
    <ellipse cx="240" cy="-60" rx="320" ry="280" fill="url(#skyGrad)" opacity="0.5" />

    {/* Decorative blobs */}
    <ellipse cx="60" cy="160" rx="180" ry="240" fill="url(#blobGrad)" />
    <ellipse cx="400" cy="460" rx="160" ry="120" fill="url(#blobGrad)" />

    {/* Light rays */}
    <line x1="200" y1="0" x2="380" y2="300" stroke="white" strokeWidth="1" opacity="0.07" />
    <line x1="140" y1="0" x2="440" y2="400" stroke="white" strokeWidth="1.5" opacity="0.05" />
    <line x1="280" y1="0" x2="60" y2="350" stroke="white" strokeWidth="1" opacity="0.05" />

    {/* Floating dots */}
    <circle cx="380" cy="80" r="7" fill="#00d4f0" opacity="0.5" filter="url(#glow)" />
    <circle cx="60" cy="240" r="5" fill="#00d4f0" opacity="0.4" />
    <circle cx="430" cy="200" r="4" fill="white" opacity="0.3" />
    <circle cx="100" cy="380" r="3" fill="#00d4f0" opacity="0.3" />
    <circle cx="350" cy="140" r="3" fill="white" opacity="0.25" />

    {/* Road */}
    <path d="M-20 400 Q240 360 500 400" stroke="rgba(255,255,255,0.1)" strokeWidth="60" fill="none" />
    <path d="M-20 400 Q240 360 500 400" stroke="rgba(255,255,255,0.05)" strokeWidth="62" fill="none" />
    {/* Road dashes */}
    <path d="M60 390 Q120 375 180 378" stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeDasharray="14,14" fill="none" />
    <path d="M200 375 Q280 367 360 370" stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeDasharray="14,14" fill="none" />

    {/* Hospital building */}
    {/* Main structure */}
    <rect x="140" y="140" width="200" height="200" rx="4" fill="#e8f5f8" />
    {/* Glass facade main */}
    <rect x="148" y="148" width="184" height="192" rx="3" fill="#c5e8ef" />
    {/* Window grid */}
    {[0, 1, 2, 3].map(row =>
      [0, 1, 2].map(col => (
        <rect key={`w${row}${col}`}
          x={162 + col * 54} y={160 + row * 40}
          width="36" height="26" rx="2"
          fill={row === 0 && col === 1 ? '#7ed6e8' : '#9ecfda'} opacity="0.9" />
      ))
    )}
    {/* Entry */}
    <rect x="192" y="292" width="96" height="48" rx="3" fill="#7ecfe8" />
    <rect x="208" y="292" width="30" height="48" fill="#5bbfd8" />
    <rect x="242" y="292" width="30" height="48" fill="#5bbfd8" />
    {/* Roof / top bar */}
    <rect x="130" y="132" width="220" height="16" rx="3" fill="#b0dde8" />
    {/* Roof accent */}
    <rect x="148" y="120" width="184" height="14" rx="2" fill="#90ccd8" />

    {/* Red cross on hospital */}
    <rect x="228" y="164" width="24" height="52" rx="3" fill="#de350b" />
    <rect x="214" y="178" width="52" height="24" rx="3" fill="#de350b" />
    {/* White inner cross */}
    <rect x="232" y="168" width="16" height="44" rx="2" fill="white" opacity="0.9" />
    <rect x="218" y="182" width="44" height="16" rx="2" fill="white" opacity="0.9" />

    {/* Trees */}
    <rect x="110" y="290" width="10" height="50" rx="2" fill="#006070" />
    <ellipse cx="115" cy="278" rx="22" ry="28" fill="#007a8e" />
    <ellipse cx="115" cy="268" rx="16" ry="20" fill="#00a0b8" />

    <rect x="358" y="288" width="10" height="52" rx="2" fill="#006070" />
    <ellipse cx="363" cy="276" rx="24" ry="30" fill="#007a8e" />
    <ellipse cx="363" cy="264" rx="17" ry="21" fill="#00a0b8" />

    {/* Ambulance */}
    {/* Body */}
    <rect x="60" y="355" width="140" height="58" rx="6" fill="url(#ambGrad)" />
    {/* Cabin */}
    <rect x="160" y="362" width="46" height="46" rx="4" fill="#cde8ef" />
    {/* Windshield */}
    <rect x="165" y="366" width="36" height="28" rx="3" fill="#7ecfe8" opacity="0.9" />
    {/* Red stripe */}
    <rect x="60" y="370" width="140" height="10" fill="#de350b" />
    {/* Cross on ambulance */}
    <rect x="96" y="358" width="8" height="24" rx="1" fill="#de350b" />
    <rect x="90" y="364" width="20" height="8" rx="1" fill="#de350b" />
    <rect x="98" y="360" width="4" height="20" rx="1" fill="white" opacity="0.8" />
    <rect x="92" y="366" width="16" height="4" rx="1" fill="white" opacity="0.8" />
    {/* Wheels */}
    <circle cx="96" cy="415" r="16" fill="#1a3a4a" />
    <circle cx="96" cy="415" r="9" fill="#344d5c" />
    <circle cx="96" cy="415" r="4" fill="#aaccdd" />
    <circle cx="172" cy="415" r="16" fill="#1a3a4a" />
    <circle cx="172" cy="415" r="9" fill="#344d5c" />
    <circle cx="172" cy="415" r="4" fill="#aaccdd" />
    {/* Siren lights */}
    <rect x="74" y="350" width="18" height="8" rx="3" fill="#de350b" filter="url(#glow)" />
    <rect x="96" y="350" width="18" height="8" rx="3" fill="#00a3bf" filter="url(#glow)" />
    {/* Speed lines */}
    <line x1="20" y1="370" x2="55" y2="370" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
    <line x1="10" y1="382" x2="55" y2="382" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="25" y1="394" x2="55" y2="394" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeLinecap="round" />

    {/* Floor reflection */}
    <ellipse cx="240" cy="480" rx="200" ry="16" fill="rgba(0,0,0,0.18)" />

    {/* ECS text above hospital */}
    <text x="240" y="88" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="20" fontWeight="800" fill="rgba(255,255,255,0.75)" letterSpacing="2">EMERGENCY COORDINATION SYSTEM</text>
  </svg>
);


// ── Shared field components (defined OUTSIDE Landing to prevent remount) ──
const inputStyle = (focused: boolean): React.CSSProperties => ({
  width: '100%', padding: '12px 14px', border: `1.5px solid ${focused ? C.teal : C.border}`,
  borderRadius: '8px', fontSize: '14px', color: C.text, outline: 'none', boxSizing: 'border-box',
  background: 'white', transition: 'all 0.2s', fontFamily: 'inherit',
  boxShadow: focused ? `0 0 0 3px rgba(0,163,191,0.12)` : 'none',
});

const Field = ({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => {
  const [foc, setFoc] = useState(false);
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: C.sub, marginBottom: '5px', letterSpacing: '0.3px' }}>{label}</label>
      <input {...rest} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}
        style={{ ...inputStyle(foc), ...rest.style }} />
    </div>
  );
};

const SelectField = ({ label, children, ...rest }: { label: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) => {
  const [foc, setFoc] = useState(false);
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: C.sub, marginBottom: '5px', letterSpacing: '0.3px' }}>{label}</label>
      <select {...rest} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}
        style={{
          width: '100%', padding: '12px 14px', border: `1.5px solid ${foc ? C.teal : C.border}`, borderRadius: '8px', fontSize: '14px', color: C.text, outline: 'none',
          boxSizing: 'border-box', background: 'white', transition: 'all 0.2s', fontFamily: 'inherit', cursor: 'pointer',
          boxShadow: foc ? `0 0 0 3px rgba(0,163,191,0.12)` : 'none', ...rest.style
        }}>
        {children}
      </select>
    </div>
  );
};

// ── Address suggestions ──────────────────────────────────────
interface AddressSuggestion { display_name: string; lat: string; lon: string; }

// ── Main Component ───────────────────────────────────────────
const Landing: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

  const searchAddresses = async (query: string) => {
    if (query.length < 3) { setAddressSuggestions([]); return; }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5`, { headers: { 'User-Agent': 'ECS-Emergency-App' } });
      const data = await res.json();
      setAddressSuggestions(data); setShowSuggestions(true);
    } catch { /* silent */ }
  };

  const handleAddressChange = (val: string) => {
    setAddress(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => searchAddresses(val), 300);
  };

  const selectAddress = (s: AddressSuggestion) => {
    setAddress(s.display_name);
    setSelectedCoords({ lat: parseFloat(s.lat), lon: parseFloat(s.lon) });
    setAddressSuggestions([]); setShowSuggestions(false); setShowMap(true);
  };

  useEffect(() => {
    if (!showMap || !mapRef.current) return;
    if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; markerRef.current = null; }
    setTimeout(() => {
      if (!mapRef.current) return;
      const map = L.map(mapRef.current).setView([20.5937, 78.9629], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
      mapInstanceRef.current = map;
      if (selectedCoords) {
        const icon = L.divIcon({ className: '', html: `<div style="background:#de350b;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="white"/></svg></div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
        const marker = L.marker([selectedCoords.lat, selectedCoords.lon], { icon, draggable: true }).addTo(map);
        marker.on('dragend', async (e) => {
          const pos = e.target.getLatLng();
          setSelectedCoords({ lat: pos.lat, lon: pos.lng });
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.lat}&lon=${pos.lng}`, { headers: { 'User-Agent': 'ECS-Emergency-App' } });
            const data = await res.json();
            setAddress(data.display_name);
          } catch { /* silent */ }
        });
        markerRef.current = marker;
        map.setView([selectedCoords.lat, selectedCoords.lon], 13);
      }
    }, 100);
    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; markerRef.current = null; } };
  }, [showMap, selectedCoords]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const { accessToken, user } = await ApiClient.login(email, password);
      const urls: Record<string, string> = { USER: '/dashboard', HOSPITAL: 'http://localhost:3001/dashboard', DRIVER: 'http://localhost:3003/dashboard', ADMIN: 'http://localhost:3002/dashboard' };
      if (!urls[user.role]) throw new Error('Unknown role.');
      if (user.role === 'USER') navigate('/dashboard');
      else window.location.href = `${urls[user.role]}#token=${encodeURIComponent(accessToken)}`;
    } catch (err: any) { setError(err.response?.data?.message || err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setSuccess(''); setLoading(true);
    try {
      const body: any = { email, password, firstName, lastName, phoneNumber, role: selectedRole };
      if (selectedRole === 'HOSPITAL') { body.hospitalName = hospitalName; body.address = address; if (selectedCoords) { body.latitude = selectedCoords.lat; body.longitude = selectedCoords.lon; } }
      else if (selectedRole === 'DRIVER') { body.licenseNumber = licenseNumber; body.vehicleNumber = vehicleNumber; }
      else if (selectedRole === 'USER') { body.address = address; if (selectedCoords) { body.latitude = selectedCoords.lat; body.longitude = selectedCoords.lon; } }
      const res = await fetch('http://localhost:3000/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Registration failed');
      setSuccess('Account created! You can now log in.'); setMode('login'); setPassword('');
    } catch (err: any) { setError(err.message || 'Registration failed'); }
    finally { setLoading(false); }
  };

  const switchMode = (m: 'login' | 'register') => { setMode(m); setError(''); setSuccess(''); };


  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif', background: C.white }}>
      {/* ── Left: Illustration ──────────────────────── */}
      <div style={{ flex: '0 0 48%', position: 'relative', overflow: 'hidden', display: 'none' }}
        className="landing-left">
        <style>{`@media(min-width:768px){.landing-left{display:block!important}}`}</style>
        <Illustration />
        {/* Overlay tagline */}
        <div style={{ position: 'absolute', bottom: '50px', left: '36px', right: '36px' }}>
          <div style={{ fontSize: '26px', fontWeight: 800, color: 'white', lineHeight: 1.3, marginBottom: '8px', textShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            Fast. Reliable.<br />Life-Saving.
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>
            Connecting patients, hospitals and ambulance drivers in real-time.
          </div>
        </div>
      </div>

      {/* ── Right: Form ──────────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', background: C.white, overflowY: 'auto'
      }}>
        <div style={{ width: '100%', maxWidth: '420px' }}>

          {/* No logo above heading */}

          {/* Heading */}
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: C.navy, margin: '0 0 6px' }}>
            {mode === 'login' ? 'Welcome' : 'Create account'}
          </h1>
          <p style={{ fontSize: '14px', color: C.sub, margin: '0 0 28px' }}>
            {mode === 'login' ? 'Sign in to your ECS account' : 'Join the Emergency Coordination System'}
          </p>

          {/* Tab buttons */}
          <div style={{ display: 'flex', background: C.bg, borderRadius: '10px', padding: '4px', marginBottom: '28px' }}>
            {(['login', 'register'] as const).map(m => (
              <button key={m} onClick={() => switchMode(m)} style={{
                flex: 1, padding: '9px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: 600, transition: 'all 0.2s', fontFamily: 'inherit',
                background: mode === m ? C.white : 'transparent',
                color: mode === m ? C.teal : C.sub,
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}>
                {m === 'login' ? 'Log In' : 'Register'}
              </button>
            ))}
          </div>

          {/* Alerts */}
          {error && (
            <div style={{
              background: '#fff4f2', border: `1px solid ${C.red}`, borderRadius: '8px',
              padding: '12px 14px', marginBottom: '20px', fontSize: '13px', color: C.red, fontWeight: 500,
              display: 'flex', gap: '8px', alignItems: 'flex-start'
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
                <circle cx="12" cy="12" r="10" fill="#de350b" opacity="0.15" />
                <path d="M12 8v5m0 3h.01" stroke="#de350b" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}
          {success && (
            <div style={{
              background: '#e3fcef', border: `1px solid ${C.green}`, borderRadius: '8px',
              padding: '12px 14px', marginBottom: '20px', fontSize: '13px', color: C.green, fontWeight: 500
            }}>
              {success}
            </div>
          )}

          {/* LOGIN form */}
          {mode === 'login' ? (
            <form onSubmit={handleLogin}>
              <Field label="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />

              <div style={{ marginBottom: '24px', position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: C.sub, marginBottom: '5px', letterSpacing: '0.3px' }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password" required
                    style={{
                      width: '100%', padding: '12px 42px 12px 14px', border: `1.5px solid ${C.border}`, borderRadius: '8px',
                      fontSize: '14px', color: C.text, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                      background: 'white', transition: 'all 0.2s'
                    }}
                    onFocus={e => { e.target.style.borderColor = C.teal; e.target.style.boxShadow = `0 0 0 3px rgba(0,163,191,0.12)`; }}
                    onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none'; }} />
                  <button type="button" onClick={() => setShowPassword(p => !p)}
                    style={{
                      position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: '4px'
                    }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      {showPassword
                        ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>
                        : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" /></>
                      }
                    </svg>
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '13px', background: loading ? C.tealDark : C.teal,
                color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '16px', transition: 'all 0.2s',
                fontFamily: 'inherit', letterSpacing: '0.2px',
              }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.background = C.tealDark; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.teal; }}>
                {loading ? 'Signing in…' : 'Log In'}
              </button>

              <p style={{ textAlign: 'center', fontSize: '13px', color: C.sub, margin: 0 }}>
                No account?{' '}
                <button type="button" onClick={() => switchMode('register')}
                  style={{ background: 'none', border: 'none', color: C.teal, fontWeight: 600, cursor: 'pointer', fontSize: '13px', padding: 0, fontFamily: 'inherit' }}>
                  Create one
                </button>
              </p>
            </form>
          ) : (
            /* REGISTER form */
            <form onSubmit={handleRegister}>
              <SelectField label="Account type" value={selectedRole}
                onChange={e => { setSelectedRole(e.target.value as any); setShowMap(false); setAddress(''); setHospitalName(''); setLicenseNumber(''); setVehicleNumber(''); }}>
                <option value="USER">Patient / User</option>
                <option value="HOSPITAL">Hospital Staff</option>
                <option value="DRIVER">Ambulance Driver</option>
              </SelectField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <Field label="First name" type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" required />
                <Field label="Last name" type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" required />
              </div>

              <Field label="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              <Field label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" minLength={6} required />
              <Field label="Phone number" type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+91 98765 43210" required />

              {/* Hospital fields */}
              {selectedRole === 'HOSPITAL' && <>
                <Field label="Hospital name" type="text" value={hospitalName} onChange={e => setHospitalName(e.target.value)} placeholder="City General Hospital" required />
                <div style={{ marginBottom: '16px', position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: C.sub, marginBottom: '5px', letterSpacing: '0.3px' }}>Hospital address</label>
                  <input type="text" value={address} onChange={e => handleAddressChange(e.target.value)}
                    onFocus={e => { if (addressSuggestions.length > 0) setShowSuggestions(true); e.target.style.borderColor = C.teal; e.target.style.boxShadow = `0 0 0 3px rgba(0,163,191,0.12)`; }}
                    onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none'; }}
                    placeholder="Search address…" autoComplete="off" required
                    style={{ width: '100%', padding: '12px 14px', border: `1.5px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', color: C.text, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: 'white' }} />
                  {showSuggestions && addressSuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: `1px solid ${C.border}`, borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: '200px', overflowY: 'auto' }}>
                      {addressSuggestions.map((s, i) => (
                        <div key={i} onMouseDown={e => { e.preventDefault(); selectAddress(s); }}
                          style={{ padding: '10px 14px', fontSize: '13px', color: C.text, cursor: 'pointer', borderBottom: i < addressSuggestions.length - 1 ? `1px solid ${C.border}` : 'none' }}
                          onMouseEnter={e => e.currentTarget.style.background = C.bg}
                          onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                          {s.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>}

              {/* Driver fields */}
              {selectedRole === 'DRIVER' && <>
                <Field label="Driving license number" type="text" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} placeholder="DL-1234567890" required />
                <Field label="Vehicle / ambulance number" type="text" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} placeholder="MH-01-AA-1234" required />
              </>}

              {/* User address */}
              {selectedRole === 'USER' && (
                <div style={{ marginBottom: '16px', position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: C.sub, marginBottom: '5px', letterSpacing: '0.3px' }}>Address (optional)</label>
                  <input type="text" value={address} onChange={e => handleAddressChange(e.target.value)}
                    onFocus={e => { if (addressSuggestions.length > 0) setShowSuggestions(true); e.target.style.borderColor = C.teal; e.target.style.boxShadow = `0 0 0 3px rgba(0,163,191,0.12)`; }}
                    onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none'; }}
                    placeholder="Search your address…" autoComplete="off"
                    style={{ width: '100%', padding: '12px 14px', border: `1.5px solid ${C.border}`, borderRadius: '8px', fontSize: '14px', color: C.text, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: 'white' }} />
                  {showSuggestions && addressSuggestions.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: `1px solid ${C.border}`, borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 50, maxHeight: '180px', overflowY: 'auto' }}>
                      {addressSuggestions.map((s, i) => (
                        <div key={i} onMouseDown={e => { e.preventDefault(); selectAddress(s); }}
                          style={{ padding: '10px 14px', fontSize: '13px', color: C.text, cursor: 'pointer', borderBottom: i < addressSuggestions.length - 1 ? `1px solid ${C.border}` : 'none' }}
                          onMouseEnter={e => e.currentTarget.style.background = C.bg}
                          onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                          {s.display_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {showMap && (
                <div style={{ marginBottom: '16px', borderRadius: '10px', overflow: 'hidden', border: `1.5px solid ${C.teal}`, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                  <div ref={mapRef} style={{ height: '220px', width: '100%' }} />
                  <div style={{ padding: '10px 14px', background: C.bg, borderTop: `1px solid ${C.border}`, fontSize: '12px', color: C.sub }}>
                    <strong>Selected:</strong> {address}<br />
                    <span>Drag the pin to adjust your location</span>
                  </div>
                </div>
              )}

              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '13px', background: loading ? C.tealDark : C.teal,
                color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '14px', transition: 'all 0.2s', fontFamily: 'inherit',
              }}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.background = C.tealDark; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.teal; }}>
                {loading ? 'Creating account…' : 'Create Account'}
              </button>

              <p style={{ textAlign: 'center', fontSize: '13px', color: C.sub, margin: 0 }}>
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')}
                  style={{ background: 'none', border: 'none', color: C.teal, fontWeight: 600, cursor: 'pointer', fontSize: '13px', padding: 0, fontFamily: 'inherit' }}>
                  Log in
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Landing;
