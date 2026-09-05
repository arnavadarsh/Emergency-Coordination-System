import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import { LiveRouteMap } from '../components/LiveRouteMap';
import { API_CONFIG } from '../config/api';
import { formatIstTime, formatTimeAgo } from '../utils/datetime';

/**
 * The page a family member opens from the SMS.
 *
 * No login, no app, no account — a link and a browser. Everything on it is
 * about the response, never the patient: where the ambulance is, how long it
 * will be, what stage the case has reached, and which hospital it is heading
 * to. The API refuses to send anything else, and it stops answering entirely
 * once the case ends.
 *
 * Built for someone reading it one-handed, on a phone, while worried.
 */

const POLL_INTERVAL_MS = 8000;

const C = {
  ink: '#172b4d',
  sub: '#6b778c',
  muted: '#97a0af',
  line: '#e4e7ec',
  soft: '#f4f5f7',
  blue: '#0066cc',
  blueSoft: '#e3f5ff',
  green: '#00875a',
  greenSoft: '#e3fcef',
  red: '#de350b',
  amber: '#ff8b00',
};

interface TrackingPoint {
  latitude: number;
  longitude: number;
}

interface TrackingView {
  caseReference: string;
  stage: { code: string; label: string; description: string; step: number; totalSteps: number };
  ambulance: { vehicleNumber: string | null; location: TrackingPoint | null; locationUpdatedAt: string | null };
  target: (TrackingPoint & { kind: 'PICKUP' | 'HOSPITAL'; label: string }) | null;
  hospital: { name: string; address: string | null; location: TrackingPoint | null } | null;
  eta: { minutes: number | null; text: string; expectedArrivalIso: string | null; label: string };
  timeline: {
    assignedAt: string | null;
    arrivedAtPickupAt: string | null;
    departedPickupAt: string | null;
    arrivedAtHospitalAt: string | null;
  };
  updatedAt: string;
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'live'; view: TrackingView }
  | { kind: 'ended'; message: string; hospitalName?: string | null }
  | { kind: 'invalid'; message: string };

const STAGE_ORDER = ['ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'EN_ROUTE_HOSPITAL', 'AT_HOSPITAL'];
const STAGE_SHORT: Record<string, string> = {
  ASSIGNED: 'Assigned',
  EN_ROUTE_PICKUP: 'To patient',
  AT_PICKUP: 'With patient',
  EN_ROUTE_HOSPITAL: 'To hospital',
  AT_HOSPITAL: 'Arrived',
};

function PublicTracking() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const contactToken = searchParams.get('c');

  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  const [optOutBusy, setOptOutBusy] = useState(false);
  // Re-renders the "updated Ns ago" line between polls.
  const [, setTick] = useState(0);
  const stoppedRef = useRef(false);

  const fetchView = useCallback(async () => {
    if (!token || stoppedRef.current) return;
    try {
      const res = await axios.get<TrackingView>(`${API_CONFIG.BASE_URL}/tracking/public/${token}`);
      setState({ kind: 'live', view: res.data });
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;

      if (status === 410) {
        // The case is over — the link is meant to stop working.
        stoppedRef.current = true;
        setState({
          kind: 'ended',
          message: body?.message || 'This case has ended, so tracking has stopped.',
          hospitalName: body?.hospitalName ?? null,
        });
      } else if (status === 404) {
        stoppedRef.current = true;
        setState({ kind: 'invalid', message: body?.message || 'This tracking link is not valid.' });
      } else {
        // A network blip should not blank out a page someone is watching:
        // keep the last view and try again on the next poll.
        setState(previous => (previous.kind === 'live' ? previous : { kind: 'loading' }));
      }
    }
  }, [token]);

  useEffect(() => {
    fetchView();
    const poll = setInterval(fetchView, POLL_INTERVAL_MS);
    const clock = setInterval(() => setTick(value => value + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [fetchView]);

  useEffect(() => {
    if (!contactToken) return;
    axios
      .get(`${API_CONFIG.BASE_URL}/tracking/public/opt-out/${contactToken}`)
      .then(res => setOptedOut(Boolean(res.data?.optedOut)))
      .catch(() => setOptedOut(null));
  }, [contactToken]);

  const changeOptOut = async (optOut: boolean) => {
    if (!contactToken) return;
    setOptOutBusy(true);
    try {
      const res = await axios.post(`${API_CONFIG.BASE_URL}/tracking/public/opt-out/${contactToken}`, { optOut });
      setOptedOut(Boolean(res.data?.optedOut));
    } catch {
      // Nothing actionable for the reader — leave the control as it was.
    } finally {
      setOptOutBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#f5f7fa', padding: '16px', boxSizing: 'border-box' }}>
      <style>{`@keyframes ecsPulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>{children}</div>
    </div>
  );

  const brandHeader = (subtitle: string) => (
    <div style={{ background: 'linear-gradient(135deg, #0066cc 0%, #00a3bf 100%)', color: 'white', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
      <div style={{ fontSize: '13px', opacity: 0.9, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Emergency Coordination System
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, marginTop: '4px' }}>Ambulance Tracking</div>
      <div style={{ fontSize: '14px', opacity: 0.92, marginTop: '6px' }}>{subtitle}</div>
    </div>
  );

  const card = (children: React.ReactNode, extra: React.CSSProperties = {}) => (
    <div style={{ background: 'white', border: `1px solid ${C.line}`, borderRadius: '14px', padding: '18px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', ...extra }}>
      {children}
    </div>
  );

  if (state.kind === 'loading') {
    return shell(
      <>
        {brandHeader('Loading the latest position…')}
        {card(
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: C.sub }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: C.blue, animation: 'ecsPulse 1.2s ease-in-out infinite' }} />
            <span style={{ fontSize: '14px' }}>Connecting to the ambulance…</span>
          </div>,
        )}
      </>,
    );
  }

  if (state.kind === 'invalid' || state.kind === 'ended') {
    const ended = state.kind === 'ended';
    return shell(
      <>
        {brandHeader(ended ? 'This case has ended' : 'Link not valid')}
        {card(
          <>
            <div style={{ fontSize: '34px', marginBottom: '10px' }}>{ended ? '✅' : '🔒'}</div>
            <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: C.ink }}>{state.message}</p>
            {ended && state.hospitalName && (
              <p style={{ margin: '0 0 8px', fontSize: '15px', color: C.ink }}>
                The ambulance completed its trip to <strong>{state.hospitalName}</strong>.
              </p>
            )}
            <p style={{ margin: 0, fontSize: '13px', color: C.sub, lineHeight: 1.6 }}>
              {ended
                ? 'Tracking links are live only while a case is in progress, so nobody can keep watching afterwards.'
                : 'Check that you opened the most recent link you were sent.'}
            </p>
          </>,
        )}
        {contactToken && optedOut !== null && optOutCard(optedOut, optOutBusy, changeOptOut)}
      </>,
    );
  }

  const { view } = state;
  const ambulanceLocation = view.ambulance.location;
  const currentStageIndex = STAGE_ORDER.indexOf(view.stage.code);
  const headingToHospital = view.target?.kind === 'HOSPITAL';

  return shell(
    <>
      {brandHeader(`Case ${view.caseReference}`)}

      {/* What is happening, in one line, before anything else. */}
      {card(
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: C.green, animation: 'ecsPulse 1.6s ease-in-out infinite' }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: C.green, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Live</span>
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: '22px', lineHeight: 1.25, color: C.ink }}>{view.stage.label}</h1>
          <p style={{ margin: 0, fontSize: '14px', color: C.sub, lineHeight: 1.55 }}>{view.stage.description}</p>
        </>,
      )}

      {/* ETA and vehicle, the two numbers people actually want. */}
      {card(
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
          <div style={{ background: C.blueSoft, borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: C.sub, marginBottom: '4px' }}>{view.eta.label}</div>
            <div style={{ fontSize: '26px', fontWeight: 700, color: C.blue }}>{view.eta.text}</div>
            {view.eta.expectedArrivalIso && (
              <div style={{ fontSize: '12px', color: C.sub, marginTop: '4px' }}>
                around {formatIstTime(view.eta.expectedArrivalIso)}
              </div>
            )}
          </div>
          <div style={{ background: C.soft, borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: C.sub, marginBottom: '4px' }}>Ambulance</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: C.ink }}>
              {view.ambulance.vehicleNumber || 'Assigned'}
            </div>
            {view.ambulance.locationUpdatedAt && (
              <div style={{ fontSize: '12px', color: C.sub, marginTop: '4px' }}>
                position {formatTimeAgo(view.ambulance.locationUpdatedAt).toLowerCase()}
              </div>
            )}
          </div>
        </div>,
      )}

      {/* Progress rail — where this case has got to. */}
      {card(
        <div style={{ display: 'flex', gap: '4px' }}>
          {STAGE_ORDER.map((stage, index) => {
            const done = index <= currentStageIndex;
            return (
              <div key={stage} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: '6px', borderRadius: '3px', background: done ? C.green : C.line, marginBottom: '8px' }} />
                <div style={{ fontSize: '11px', fontWeight: index === currentStageIndex ? 700 : 500, color: index === currentStageIndex ? C.green : done ? C.sub : C.muted, lineHeight: 1.3 }}>
                  {STAGE_SHORT[stage]}
                </div>
              </div>
            );
          })}
        </div>,
      )}

      {/* The map itself. */}
      {card(
        ambulanceLocation || view.target ? (
          <div style={{ margin: '-18px' }}>
            <LiveRouteMap
              ambulanceLat={ambulanceLocation?.latitude}
              ambulanceLng={ambulanceLocation?.longitude}
              targetLat={view.target?.latitude}
              targetLng={view.target?.longitude}
              targetLabel={view.target?.label}
              title={headingToHospital ? 'Route to hospital' : 'Route to the patient'}
              ctaLabel="Open in Maps"
            />
          </div>
        ) : (
          <p style={{ margin: 0, color: C.sub, fontSize: '14px' }}>
            The ambulance has not reported its position yet. This page updates on its own.
          </p>
        ),
      )}

      {/* Where the patient is being taken — the thing relatives act on. */}
      {view.hospital &&
        card(
          <>
            <div style={{ fontSize: '12px', color: C.sub, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
              Heading to
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: C.ink }}>{view.hospital.name}</div>
            {view.hospital.address && (
              <div style={{ fontSize: '14px', color: C.sub, marginTop: '4px' }}>{view.hospital.address}</div>
            )}
            {view.hospital.location && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${view.hospital.location.latitude},${view.hospital.location.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '12px', padding: '9px 14px', borderRadius: '8px', background: C.blue, color: 'white', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}
              >
                Directions to the hospital
              </a>
            )}
          </>,
          { borderLeft: `4px solid ${C.blue}` },
        )}

      {/* Times so far. */}
      {card(
        <>
          <div style={{ fontSize: '12px', color: C.sub, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>
            Progress
          </div>
          {[
            { label: 'Ambulance assigned', at: view.timeline.assignedAt },
            { label: 'Reached the patient', at: view.timeline.arrivedAtPickupAt },
            { label: 'Left for the hospital', at: view.timeline.departedPickupAt },
            { label: 'Arrived at the hospital', at: view.timeline.arrivedAtHospitalAt },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '7px 0', borderBottom: `1px solid ${C.soft}`, fontSize: '14px' }}>
              <span style={{ color: row.at ? C.ink : C.muted }}>{row.label}</span>
              <span style={{ color: row.at ? C.green : C.muted, fontWeight: row.at ? 600 : 400, whiteSpace: 'nowrap' }}>
                {row.at ? formatIstTime(row.at) : 'Pending'}
              </span>
            </div>
          ))}
        </>,
      )}

      {contactToken && optedOut !== null && optOutCard(optedOut, optOutBusy, changeOptOut)}

      <p style={{ fontSize: '12px', color: C.muted, textAlign: 'center', lineHeight: 1.7, margin: '4px 0 24px' }}>
        Updated {formatTimeAgo(view.updatedAt).toLowerCase()} · refreshes automatically
        <br />
        This page shows the ambulance only — no patient details are shared. It stops working when the case ends.
      </p>
    </>,
  );
}

/**
 * The contact's own control over future messages, shown only to someone who
 * arrived through their personal link. Reversible, because a mis-tap in a
 * stressful moment should not silence future emergencies for good.
 */
function optOutCard(optedOut: boolean, busy: boolean, onChange: (optOut: boolean) => void) {
  return (
    <div style={{ background: 'white', border: `1px solid ${C.line}`, borderRadius: '14px', padding: '16px 18px', marginBottom: '14px' }}>
      <div style={{ fontSize: '14px', color: C.ink, fontWeight: 600, marginBottom: '4px' }}>
        {optedOut ? 'You have stopped these alerts' : 'Getting these alerts by SMS'}
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '13px', color: C.sub, lineHeight: 1.55 }}>
        {optedOut
          ? 'You will not be texted about future emergencies for this person. This link still works while the current case is live.'
          : 'You were listed as an emergency contact, so you are texted a link like this when an ambulance is dispatched.'}
      </p>
      <button
        onClick={() => onChange(!optedOut)}
        disabled={busy}
        style={{ padding: '9px 14px', borderRadius: '8px', border: `1px solid ${optedOut ? C.green : C.line}`, background: optedOut ? C.greenSoft : 'white', color: optedOut ? C.green : C.sub, fontSize: '13px', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
      >
        {busy ? 'Saving…' : optedOut ? 'Start alerts again' : 'Stop alerts'}
      </button>
    </div>
  );
}

export default PublicTracking;
