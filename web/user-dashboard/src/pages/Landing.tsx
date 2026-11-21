import React, { useState, FormEvent, useRef, useEffect, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import ApiClient from '../services/api';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MedicalProfileFields from '../components/MedicalProfileFields';
import {
  EMPTY_MEDICAL_PROFILE_FORM,
  isMedicalProfileFormEmpty,
  toMedicalProfilePayload,
  type MedicalProfileForm,
} from '@shared/types/medicalProfile';
import { API_BASE_URL, ROLE_APP_URLS } from '../config/api';
import TokenStorage from '../utils/tokenStorage';
import { Icon, type IconName, iconSvg } from '@shared/components/ui/Icon';
import { BrandMark } from '@shared/components/ui/primitives';
import '../styles/Landing.css';

// ── Shared field components (defined OUTSIDE Landing to prevent remount) ──
const Field = ({ label, hint, ...rest }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) => {
  const id = useId();
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>{label}</label>
      <input id={id} className="ui-input ui-input--lg" {...rest} />
      {hint && <div className="ui-help">{hint}</div>}
    </div>
  );
};

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'navigation', title: 'Live ambulance tracking', text: 'Patients, families and hospitals see the same live position and ETA.' },
  { icon: 'stethoscope', title: 'AI-assisted triage', text: 'Severity is assessed in seconds and the right ambulance is dispatched.' },
  { icon: 'hospital', title: 'Hospital pre-arrival alerts', text: 'Receiving teams get the patient profile before the ambulance arrives.' },
];

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
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  // Optional Medical Profile captured while creating the patient ID. Collapsed by
  // default so it never gets in the way of an urgent sign-up; the ID is created
  // whether or not any of it is filled in.
  const [medicalProfile, setMedicalProfile] = useState<MedicalProfileForm>({ ...EMPTY_MEDICAL_PROFILE_FORM });
  const [showMedicalProfile, setShowMedicalProfile] = useState(false);
  const [error, setError] = useState('');

  // Arriving here because a session was rejected — say so, rather than looking
  // like the app simply threw the user out. See utils/authInterceptor.ts.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('signedOut') === '1') {
      setError('Your session has ended. Please sign in again.');
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
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
        const icon = L.divIcon({ className: 'ui-marker', html: `<span class="ui-marker__pin ui-marker__pin--brand">${iconSvg('mapPin', 16, 2.4)}</span>`, iconSize: [32, 40], iconAnchor: [16, 38] });
        const marker = L.marker([selectedCoords.lat, selectedCoords.lon], { icon, draggable: true, title: 'Selected address — drag to adjust' }).addTo(map);
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
      // Deliberately does not store the session — see ApiClient.authenticate.
      const { accessToken, user } = await ApiClient.authenticate(email, password);
      if (!ROLE_APP_URLS[user.role]) throw new Error('Unknown role.');

      if (user.role === 'USER') {
        // A patient's session belongs to this origin.
        TokenStorage.setToken(accessToken);
        TokenStorage.setUser(user);
        navigate('/dashboard');
        return;
      }

      // Every other role is only passing through: the token goes to their own
      // app in the URL fragment and nothing is written here. That is what lets
      // a patient stay signed in on this origin — in another tab, mid-case —
      // while somebody signs in as a driver on this very page.
      window.location.href = `${ROLE_APP_URLS[user.role]}#token=${encodeURIComponent(accessToken)}`;
    } catch (err: any) { setError(err.response?.data?.message || err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setSuccess(''); setLoading(true);
    try {
      // Sign-up creates patient accounts only; the server refuses any other role.
      const body: any = { email, password, firstName, lastName, phoneNumber, address };
      if (selectedCoords) { body.latitude = selectedCoords.lat; body.longitude = selectedCoords.lon; }
      // Only sent when the patient actually entered something — an untouched
      // Medical Profile is simply omitted, and the ID is created regardless.
      if (!isMedicalProfileFormEmpty(medicalProfile)) {
        body.medicalProfile = toMedicalProfilePayload(medicalProfile);
      }
      const res = await fetch(`${API_BASE_URL}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Registration failed');
      setSuccess(
        isMedicalProfileFormEmpty(medicalProfile)
          ? 'Account created! You can now log in. You can add your Medical Profile any time from Profile.'
          : 'Account created! You can now log in. Your Medical Profile was saved and can be updated any time from Profile.',
      );
      setMode('login'); setPassword('');
    } catch (err: any) { setError(err.message || 'Registration failed'); }
    finally { setLoading(false); }
  };

  const switchMode = (m: 'login' | 'register') => { setMode(m); setError(''); setSuccess(''); };

  const addressField = (label: string, placeholder: string, required: boolean) => (
    <div className="ui-field">
      <label className="ui-label" htmlFor="reg-address">
        {label}
        {!required && <span className="ui-label__optional">(optional)</span>}
      </label>
      <div className="ui-input-wrap">
        <Icon name="search" size={16} />
        <input
          id="reg-address"
          className="ui-input ui-input--lg"
          type="text"
          value={address}
          onChange={e => handleAddressChange(e.target.value)}
          onFocus={() => { if (addressSuggestions.length > 0) setShowSuggestions(true); }}
          onBlur={e => {
            // Keep the list open while focus moves into it (keyboard users).
            if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setShowSuggestions(false);
          }}
          placeholder={placeholder}
          autoComplete="off"
          required={required}
        />
        {showSuggestions && addressSuggestions.length > 0 && (
          <div className="ui-menu" role="listbox" aria-label="Address suggestions">
            {addressSuggestions.map((s, i) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={i}
                className="ui-menu__item"
                onMouseDown={e => { e.preventDefault(); selectAddress(s); }}
                onClick={() => selectAddress(s)}
              >
                <Icon name="mapPin" size={15} />
                {s.display_name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="lp">
      {/* ── Left: brand panel ──────────────────────── */}
      <aside className="lp-brand" aria-label="About ECS">
        <div className="lp-brand__inner">
          <div className="lp-brand__logo">
            <BrandMark large />
            <div>
              <div className="lp-brand__name">ECS</div>
              <div className="lp-brand__tag">Emergency Coordination System</div>
            </div>
          </div>

          <div className="lp-brand__pitch">
            <div className="lp-brand__live">
              <span className="ui-live" aria-hidden="true" />
              Real-time coordination
            </div>
            <h2 className="lp-brand__headline">Fast. Reliable.<br />Life-Saving.</h2>
            <p className="lp-brand__lead">Connecting patients, hospitals and ambulance drivers in real-time.</p>
          </div>

          <ul className="lp-brand__features">
            {FEATURES.map(f => (
              <li key={f.title}>
                <span className="lp-brand__feature-icon"><Icon name={f.icon} size={18} /></span>
                <div>
                  <div className="lp-brand__feature-title">{f.title}</div>
                  <div className="lp-brand__feature-text">{f.text}</div>
                </div>
              </li>
            ))}
          </ul>

          <div className="lp-brand__roles" aria-label="Who uses ECS">
            {['Patients', 'Drivers', 'Hospitals', 'Dispatch'].map(r => <span key={r}>{r}</span>)}
          </div>
        </div>
      </aside>

      {/* ── Right: form ──────────────────────────────── */}
      <main className="lp-main">
        <div className="lp-form">
          <div className="lp-form__mobile-brand">
            <BrandMark />
            <span>ECS · Emergency Coordination System</span>
          </div>

          <h1 className="lp-form__title">{mode === 'login' ? 'Welcome' : 'Create account'}</h1>
          <p className="lp-form__subtitle">
            {mode === 'login' ? 'Sign in to your ECS account' : 'Join the Emergency Coordination System'}
          </p>

          {/* Tab buttons */}
          <div className="ui-segmented ui-segmented--block lp-form__tabs" role="tablist" aria-label="Sign in or register">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`ui-segmented__item${mode === m ? ' is-active' : ''}`}
              >
                <Icon name={m === 'login' ? 'logIn' : 'userPlus'} size={16} />
                {m === 'login' ? 'Log In' : 'Register'}
              </button>
            ))}
          </div>

          {/* Alerts */}
          {error && (
            <div className="ui-alert tone-danger lp-form__alert" role="alert">
              <Icon name="alertCircle" size={17} />
              <div>{error}</div>
            </div>
          )}
          {success && (
            <div className="ui-alert tone-success lp-form__alert" role="status">
              <Icon name="checkCircle" size={17} />
              <div>{success}</div>
            </div>
          )}

          {/* LOGIN form */}
          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="lp-form__fields" key="login">
              <Field label="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />

              <div className="ui-field">
                <label className="ui-label" htmlFor="login-password">Password</label>
                <div className="ui-input-wrap">
                  <input
                    id="login-password"
                    className="ui-input ui-input--lg lp-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm ui-input-wrap__action"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={17} />
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block">
                {loading ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="logIn" size={17} />}
                {loading ? 'Signing in…' : 'Log In'}
              </button>

              <p className="lp-form__switch">
                No account?{' '}
                <button type="button" onClick={() => switchMode('register')} className="ui-btn ui-btn--link">
                  Create one
                </button>
              </p>
            </form>
          ) : (
            /* REGISTER form */
            <form onSubmit={handleRegister} className="lp-form__fields" key="register">
              {/* Only patients sign up here. Staff logins are tied to a real
                  hospital or ambulance, so an administrator creates them. */}
              <div className="ui-alert tone-info lp-form__alert" role="note">
                <Icon name="info" size={17} />
                <div>
                  This creates a <strong>patient</strong> account for requesting ambulances. Hospital staff and
                  ambulance drivers: your administrator creates your account — sign in with the details they give you.
                </div>
              </div>

              <div className="lp-form__row">
                <Field label="First name" type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" autoComplete="given-name" required />
                <Field label="Last name" type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" autoComplete="family-name" required />
              </div>

              <Field label="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
              <Field label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" minLength={6} autoComplete="new-password" required hint="At least 6 characters." />
              <Field label="Phone number" type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+91 98765 43210" autoComplete="tel" required />

              {/* User address */}
              {addressField('Address', 'Search your address…', false)}

              {/* Optional Medical Profile. Collapsed by default and
                  clearly marked optional; skipping it does not block the ID. */}
              <div className={`lp-medical${showMedicalProfile ? ' is-open' : ''}`}>
                <button
                  type="button"
                  onClick={() => setShowMedicalProfile(v => !v)}
                  aria-expanded={showMedicalProfile}
                  aria-controls="reg-medical"
                  className="lp-medical__toggle"
                >
                  <span className="ui-icon-tile ui-icon-tile--sm"><Icon name="stethoscope" size={17} /></span>
                  <span className="lp-medical__text">
                    <span className="lp-medical__title">
                      Medical Profile <span className="ui-label__optional">(optional)</span>
                    </span>
                    <span className="lp-medical__hint">
                      Blood group, allergies, conditions and medications. You can skip this and add or
                      update it any time from your Profile.
                    </span>
                  </span>
                  <span className="lp-medical__action">
                    {showMedicalProfile ? 'Hide' : 'Add'}
                    <Icon name="chevronDown" size={15} className="lp-medical__chevron" />
                  </span>
                </button>

                {showMedicalProfile && (
                  <div id="reg-medical" className="lp-medical__body">
                    <p className="ui-help" style={{ marginBottom: 14 }}>
                      Every field is optional. Anything you leave blank is recorded as
                      <strong> Not Provided</strong> and shown that way to responders — it is never guessed.
                      Whatever you save here is what triage, hospital pre-alerts and reports will show.
                    </p>
                    <MedicalProfileFields value={medicalProfile} onChange={setMedicalProfile} compact />
                  </div>
                )}
              </div>

              {showMap && (
                <div className="lp-map">
                  <div ref={mapRef} className="lp-map__canvas" role="region" aria-label="Selected address on map — drag the pin to adjust" />
                  <div className="lp-map__caption">
                    <strong>Selected:</strong> {address}
                    <span>Drag the pin to adjust your location</span>
                  </div>
                </div>
              )}

              <button type="submit" disabled={loading} className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block">
                {loading ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="userPlus" size={17} />}
                {loading ? 'Creating account…' : 'Create Account'}
              </button>

              <p className="lp-form__switch">
                Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="ui-btn ui-btn--link">
                  Log in
                </button>
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default Landing;
