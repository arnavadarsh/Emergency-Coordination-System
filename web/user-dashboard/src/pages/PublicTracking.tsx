import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import { LiveRouteMap } from '../components/LiveRouteMap';
import { API_CONFIG } from '../config/api';
import { formatIstTime, formatTimeAgo } from '@shared/utils/datetime';
import { Icon } from '@shared/components/ui/Icon';
import { BrandMark } from '@shared/components/ui/primitives';
import '../styles/PublicTracking.css';

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
    <div className="pt">
      <div className="pt__inner">{children}</div>
    </div>
  );

  const brandHeader = (subtitle: string, live = false) => (
    <header className="pt-header">
      <div className="pt-header__brand">
        <BrandMark />
        <div>
          <div className="pt-header__product">Emergency Coordination System</div>
          <h1 className="pt-header__title">Ambulance Tracking</h1>
        </div>
        {live && (
          <span className="pt-header__live" role="status">
            <span className="ui-live" aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      <div className="pt-header__subtitle">{subtitle}</div>
    </header>
  );

  const card = (children: React.ReactNode, className = '') => (
    <section className={`ui-card pt-card ui-enter ${className}`}>{children}</section>
  );

  if (state.kind === 'loading') {
    return shell(
      <>
        {brandHeader('Loading the latest position…')}
        {card(
          <div className="pt-connecting" role="status">
            <span className="ui-spinner" aria-hidden="true" />
            <span>Connecting to the ambulance…</span>
          </div>,
        )}
        <span className="ui-skeleton" style={{ height: 120, borderRadius: 14 }} aria-hidden="true" />
      </>,
    );
  }

  if (state.kind === 'invalid' || state.kind === 'ended') {
    const ended = state.kind === 'ended';
    return shell(
      <>
        {brandHeader(ended ? 'This case has ended' : 'Link not valid')}
        {card(
          <div className="pt-ended">
            <div className={`ui-empty__icon ${ended ? 'tone-success' : 'tone-neutral'}`}>
              <Icon name={ended ? 'checkCircle' : 'lock'} size={24} />
            </div>
            <p className="pt-ended__message">{state.message}</p>
            {ended && state.hospitalName && (
              <p className="pt-ended__hospital">
                The ambulance completed its trip to <strong>{state.hospitalName}</strong>.
              </p>
            )}
            <p className="pt-ended__note">
              {ended
                ? 'Tracking links are live only while a case is in progress, so nobody can keep watching afterwards.'
                : 'Check that you opened the most recent link you were sent.'}
            </p>
          </div>,
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
      {brandHeader(`Case ${view.caseReference}`, true)}

      {/* What is happening, in one line, before anything else. */}
      {card(
        <>
          <div className="pt-stage">
            <h2 className="pt-stage__label">{view.stage.label}</h2>
            <p className="pt-stage__desc">{view.stage.description}</p>
          </div>

          {/* Progress rail — where this case has got to. */}
          <ol className="ui-stepper pt-stepper" aria-label="Progress">
            {STAGE_ORDER.map((stage, index) => {
              const done = index < currentStageIndex;
              const current = index === currentStageIndex;
              return (
                <li
                  key={stage}
                  className={`ui-stepper__step${done ? ' is-done' : ''}${current ? ' is-current' : ''}`}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="ui-stepper__dot">{done ? <Icon name="check" size={14} strokeWidth={3} /> : index + 1}</span>
                  <span className="ui-stepper__label">{STAGE_SHORT[stage]}</span>
                </li>
              );
            })}
          </ol>
        </>,
      )}

      {/* ETA and vehicle, the two numbers people actually want. */}
      <div className="pt-figures ui-enter">
        <div className="pt-figure pt-figure--eta">
          <div className="pt-figure__label">{view.eta.label}</div>
          <div className="pt-figure__value">{view.eta.text}</div>
          {view.eta.expectedArrivalIso && (
            <div className="pt-figure__sub">around {formatIstTime(view.eta.expectedArrivalIso)}</div>
          )}
        </div>
        <div className="pt-figure">
          <div className="pt-figure__label">Ambulance</div>
          <div className="pt-figure__plate">
            <span className="ui-plate"><Icon name="ambulance" size={15} />{view.ambulance.vehicleNumber || 'Assigned'}</span>
          </div>
          {view.ambulance.locationUpdatedAt && (
            <div className="pt-figure__sub">position {formatTimeAgo(view.ambulance.locationUpdatedAt).toLowerCase()}</div>
          )}
        </div>
      </div>

      {/* The map itself. */}
      {card(
        ambulanceLocation || view.target ? (
          <LiveRouteMap
            ambulanceLat={ambulanceLocation?.latitude}
            ambulanceLng={ambulanceLocation?.longitude}
            targetLat={view.target?.latitude}
            targetLng={view.target?.longitude}
            targetLabel={view.target?.label}
            title={headingToHospital ? 'Route to hospital' : 'Route to the patient'}
            ctaLabel="Open in Maps"
          />
        ) : (
          <div className="pt-pad pt-muted">
            <Icon name="mapPin" size={18} />
            The ambulance has not reported its position yet. This page updates on its own.
          </div>
        ),
        'pt-card--flush',
      )}

      {/* Where the patient is being taken — the thing relatives act on. */}
      {view.hospital &&
        card(
          <div className="pt-pad pt-hospital">
            <span className="ui-icon-tile tone-info"><Icon name="hospital" size={22} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="ui-eyebrow">Heading to</div>
              <div className="pt-hospital__name">{view.hospital.name}</div>
              {view.hospital.address && <div className="pt-hospital__address">{view.hospital.address}</div>}
              {view.hospital.location && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${view.hospital.location.latitude},${view.hospital.location.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-btn ui-btn--primary pt-hospital__cta"
                >
                  <Icon name="navigation" size={16} />
                  Directions to the hospital
                </a>
              )}
            </div>
          </div>,
          'ui-accent ui-accent--info',
        )}

      {/* Times so far. */}
      {card(
        <div className="pt-pad">
          <div className="ui-eyebrow" style={{ marginBottom: 10 }}>Progress</div>
          <ol className="pt-timeline">
            {[
              { label: 'Ambulance assigned', at: view.timeline.assignedAt },
              { label: 'Reached the patient', at: view.timeline.arrivedAtPickupAt },
              { label: 'Left for the hospital', at: view.timeline.departedPickupAt },
              { label: 'Arrived at the hospital', at: view.timeline.arrivedAtHospitalAt },
            ].map(row => (
              <li key={row.label} className={row.at ? 'is-done' : ''}>
                <span className="pt-timeline__dot" aria-hidden="true">{row.at && <Icon name="check" size={12} strokeWidth={3} />}</span>
                <span className="pt-timeline__label">{row.label}</span>
                <span className="pt-timeline__time">{row.at ? formatIstTime(row.at) : 'Pending'}</span>
              </li>
            ))}
          </ol>
        </div>,
      )}

      {contactToken && optedOut !== null && optOutCard(optedOut, optOutBusy, changeOptOut)}

      <p className="pt-footnote">
        <Icon name="refresh" size={13} />
        Updated {formatTimeAgo(view.updatedAt).toLowerCase()} · refreshes automatically
        <br />
        <Icon name="lock" size={13} />
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
    <section className="ui-card pt-card pt-pad pt-optout">
      <span className="ui-icon-tile ui-icon-tile--sm tone-neutral"><Icon name={optedOut ? 'bell' : 'messageCircle'} size={17} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="pt-optout__title">
          {optedOut ? 'You have stopped these alerts' : 'Getting these alerts by SMS'}
        </div>
        <p className="pt-optout__text">
          {optedOut
            ? 'You will not be texted about future emergencies for this person. This link still works while the current case is live.'
            : 'You were listed as an emergency contact, so you are texted a link like this when an ambulance is dispatched.'}
        </p>
        <button
          type="button"
          onClick={() => onChange(!optedOut)}
          disabled={busy}
          className={`ui-btn ui-btn--sm ${optedOut ? 'ui-btn--soft' : 'ui-btn--secondary'}`}
        >
          {busy && <span className="ui-spinner" aria-hidden="true" />}
          {busy ? 'Saving…' : optedOut ? 'Start alerts again' : 'Stop alerts'}
        </button>
      </div>
    </section>
  );
}

export default PublicTracking;
