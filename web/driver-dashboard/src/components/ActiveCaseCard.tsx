import React from 'react';
import MedicalProfilePanel from '@shared/components/MedicalProfilePanel';
import {
  medicalProfileAlerts,
  normalizeMedicalProfile,
  type MedicalProfile,
} from '@shared/types/medicalProfile';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { SeverityBadge, StatusBadge, severityMeta, toneClass } from '@shared/components/ui/Status';

interface Booking {
  id: string;
  pickupLocation: string;
  dropoffLocation: string;
  selectedHospitalName?: string;
  bookingType: 'EMERGENCY' | 'SCHEDULED';
  severity?: string;
  status: string;
  createdAt: string;
  patientName?: string;
  patientPhone?: string;
  description?: string;
  medicalProfile?: MedicalProfile | null;
}

interface Dispatch { id: string; status: string; assignedAt: string; booking: Booking; }

interface ActiveCaseCardProps {
  dispatch: Dispatch;
  onStartJourney: () => void;
  onArrivedPickup: () => void;
  onEnRouteHospital: () => void;
  onArrivedHospital: () => void;
  onComplete: () => void;
}

type CtaStyle = 'emergency' | 'primary' | 'success';

const STEPS: Record<string, { label: string; next: string | null; btn: string | null; icon: IconName; style: CtaStyle }> = {
  ASSIGNED:          { label: 'Assigned',            next: 'start',    btn: 'Start emergency route', icon: 'siren',       style: 'emergency' },
  DISPATCHED:        { label: 'Dispatched',          next: 'start',    btn: 'Start emergency route', icon: 'siren',       style: 'emergency' },
  EN_ROUTE_PICKUP:   { label: 'En Route to Patient', next: 'pickup',   btn: 'Arrived at patient',    icon: 'mapPin',      style: 'primary' },
  EN_ROUTE:          { label: 'En Route',            next: 'pickup',   btn: 'Arrived at patient',    icon: 'mapPin',      style: 'primary' },
  AT_PICKUP:         { label: 'With Patient',        next: 'hospital', btn: 'En route to hospital',  icon: 'navigation',  style: 'primary' },
  EN_ROUTE_HOSPITAL: { label: 'En Route to Hospital', next: 'arrive',  btn: 'Arrived at hospital',   icon: 'hospital',    style: 'primary' },
  AT_HOSPITAL:       { label: 'At Hospital',         next: 'complete', btn: 'Complete dispatch',     icon: 'checkCircle', style: 'success' },
};

/** Where each status sits on the five-stage progress rail. */
const STAGE_INDEX: Record<string, number> = {
  ASSIGNED: 0, DISPATCHED: 0, EN_ROUTE_PICKUP: 1, EN_ROUTE: 1, AT_PICKUP: 2, EN_ROUTE_HOSPITAL: 3, AT_HOSPITAL: 4,
};
const STAGES = ['Assigned', 'To patient', 'With patient', 'To hospital', 'At hospital'];

const ActiveCaseCard: React.FC<ActiveCaseCardProps> = ({
  dispatch, onStartJourney, onArrivedPickup, onEnRouteHospital, onArrivedHospital, onComplete
}) => {
  const { booking, status } = dispatch;
  const sev = booking.severity || 'MEDIUM';
  const sevMeta = severityMeta(sev);
  const step = STEPS[status];
  const stage = STAGE_INDEX[status] ?? -1;
  const medical = normalizeMedicalProfile(booking.medicalProfile);
  const alerts = medicalProfileAlerts(medical);

  const handleCTA = () => {
    if (!step) return;
    if (step.next === 'start')    onStartJourney();
    if (step.next === 'pickup')   onArrivedPickup();
    if (step.next === 'hospital') onEnRouteHospital();
    if (step.next === 'arrive')   onArrivedHospital();
    if (step.next === 'complete') onComplete();
  };

  return (
    <article className={`ui-card drv-case ${toneClass(sevMeta.tone)}${sev === 'CRITICAL' ? ' is-critical' : ''} ui-enter`} aria-label="Active case">
      {/* Severity banner — the first thing read */}
      <header className="drv-case__banner">
        <div className="ui-row">
          <SeverityBadge severity={sev} large />
          <StatusBadge status={booking.bookingType} large />
        </div>
        <span className="drv-case__ref ui-mono">#{booking.id.slice(0, 8).toUpperCase()}</span>
      </header>

      {/* Lifecycle */}
      <div className="drv-case__progress">
        <ol className="ui-stepper" aria-label={`Progress: ${step?.label || status.replace(/_/g, ' ')}`}>
          {STAGES.map((label, i) => (
            <li
              key={label}
              className={`ui-stepper__step${i < stage ? ' is-done' : ''}${i === stage ? ' is-current' : ''}`}
              aria-current={i === stage ? 'step' : undefined}
            >
              <span className="ui-stepper__dot">{i < stage ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}</span>
              <span className="ui-stepper__label">{label}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Patient */}
      <section className="drv-case__section drv-case__patient">
        <div className="drv-case__patient-text">
          <div className="ui-eyebrow">Patient</div>
          <div className="drv-case__name">{booking.patientName || 'Patient'}</div>
          <p className="drv-case__complaint">
            {booking.description || (booking.bookingType === 'EMERGENCY' ? 'Emergency medical assistance required' : 'Scheduled medical transport')}
          </p>
        </div>
        {booking.patientPhone && (
          <a href={`tel:${booking.patientPhone}`} className="ui-btn ui-btn--secondary ui-btn--lg drv-case__call" aria-label={`Call patient ${booking.patientPhone}`}>
            <Icon name="phone" size={18} />
            Call
          </a>
        )}
      </section>

      {/* Medical Profile — the patient's standing clinical background, shown
          on the case card itself so the responder can spot allergies, existing
          conditions and current medication while triaging, without navigating
          away. Supporting information: it does not change the triage priority. */}
      <section className="drv-case__section drv-case__medical">
        {alerts.length > 0 && (
          <div className="ui-alert tone-warning">
            <Icon name="alertTriangle" size={18} />
            <div>
              <div className="ui-alert__title">Note before treating</div>
              <ul>
                {alerts.map(alert => <li key={alert}>{alert}</li>)}
              </ul>
            </div>
          </div>
        )}
        <MedicalProfilePanel
          profile={medical}
          compact
          footnote={
            medical.hasData
              ? 'Latest details from the patient profile.'
              : 'The patient has not recorded any medical information.'
          }
          style={{ border: 'none', padding: 0 }}
        />
      </section>

      {/* Route */}
      <section className="drv-case__section">
        <ol className="ui-route" aria-label="Route">
          <li className={`ui-route__stop ${stage <= 1 ? 'tone-danger' : 'tone-neutral'}`}>
            <span className="ui-route__marker"><Icon name="mapPin" size={12} strokeWidth={2.5} /></span>
            <div>
              <div className="ui-route__label">Pickup</div>
              <div className="ui-route__value">{booking.pickupLocation}</div>
            </div>
          </li>
          <li className={`ui-route__stop ${stage >= 2 ? 'tone-info' : 'tone-neutral'}`}>
            <span className="ui-route__marker"><Icon name="hospital" size={12} strokeWidth={2.5} /></span>
            <div>
              <div className="ui-route__label">Hospital</div>
              <div className="ui-route__value">{booking.selectedHospitalName || booking.dropoffLocation}</div>
            </div>
          </li>
        </ol>
      </section>

      {/* Next action — one large, unmistakable control */}
      {step?.btn && (
        <footer className="drv-case__action">
          <div className="drv-case__status">
            <span className="ui-live" aria-hidden="true" />
            Now: <strong>{step.label}</strong>
          </div>
          <button type="button" onClick={handleCTA} className={`ui-btn ui-btn--xl ui-btn--block ui-btn--${step.style}`}>
            <Icon name={step.icon} size={20} />
            {step.btn}
          </button>
        </footer>
      )}
    </article>
  );
};

export default ActiveCaseCard;
