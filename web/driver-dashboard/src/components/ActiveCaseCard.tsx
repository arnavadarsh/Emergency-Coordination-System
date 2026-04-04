import React from 'react';

// User dashboard palette
const C = {
  card:         '#ffffff',
  cardBg:       '#f5f7fa',
  cardBorder:   '#e0e0e0',
  textPrimary:  '#172b4d',
  textSecondary:'#6b778c',
  textMuted:    '#97a0af',
  accent:       '#00a3bf',
  accentSoft:   '#e6f7f9',
  red:          '#de350b',
  green:        '#00875a',
};

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

const SEV: Record<string, { color: string; bg: string }> = {
  CRITICAL: { color: '#de350b', bg: '#fff4f2' },
  HIGH:     { color: '#ff8b00', bg: '#fff8f0' },
  MEDIUM:   { color: '#ffab00', bg: '#fffbe6' },
  LOW:      { color: '#00875a', bg: '#e3fcef' },
};

const STEPS: Record<string, { label: string; next: string | null; btn: string | null; btnColor: string }> = {
  ASSIGNED:          { label: 'Assigned',            next: 'start',    btn: '🚑 Start Emergency Route',  btnColor: '#de350b' },
  DISPATCHED:        { label: 'Dispatched',           next: 'start',    btn: '🚑 Start Emergency Route',  btnColor: '#de350b' },
  EN_ROUTE_PICKUP:   { label: 'En Route to Patient',  next: 'pickup',   btn: '📍 Arrived at Patient',     btnColor: '#ff8b00' },
  EN_ROUTE:          { label: 'En Route',             next: 'pickup',   btn: '📍 Arrived at Patient',     btnColor: '#ff8b00' },
  AT_PICKUP:         { label: 'With Patient',          next: 'hospital', btn: '🏥 En Route to Hospital',   btnColor: '#0066cc' },
  EN_ROUTE_HOSPITAL: { label: 'En Route to Hospital', next: 'arrive',   btn: '🏥 Arrived at Hospital',    btnColor: '#0066cc' },
  AT_HOSPITAL:       { label: 'At Hospital',           next: 'complete', btn: '✅ Complete Dispatch',      btnColor: '#00875a' },
};

const ActiveCaseCard: React.FC<ActiveCaseCardProps> = ({
  dispatch, onStartJourney, onArrivedPickup, onEnRouteHospital, onArrivedHospital, onComplete
}) => {
  const { booking, status } = dispatch;
  const sev = booking.severity || 'MEDIUM';
  const sc = SEV[sev] ?? SEV.MEDIUM;
  const step = STEPS[status];

  const handleCTA = () => {
    if (!step) return;
    if (step.next === 'start')    onStartJourney();
    if (step.next === 'pickup')   onArrivedPickup();
    if (step.next === 'hospital') onEnRouteHospital();
    if (step.next === 'arrive')   onArrivedHospital();
    if (step.next === 'complete') onComplete();
  };

  return (
    <div style={{ background: C.card, borderRadius: '12px', border: `1px solid ${C.cardBorder}`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      {/* Severity bar */}
      <div style={{ height: '4px', background: sc.color }} />

      {/* Header row */}
      <div style={{ padding: '14px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '13px', color: C.textMuted, fontWeight: 600 }}>
          #{booking.id.slice(0, 8).toUpperCase()}
        </span>
        <span style={{ padding: '4px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
          background: sc.bg, color: sc.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {sev}
        </span>
      </div>

      {/* Patient info */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.cardBorder}` }}>
        <div style={{ fontSize: '11px', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '10px' }}>
          Patient Information
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: C.textPrimary, marginBottom: '4px' }}>
              {booking.patientName || 'Patient'}
            </div>
            <div style={{ fontSize: '14px', color: C.textSecondary, lineHeight: 1.5 }}>
              {booking.description || (booking.bookingType === 'EMERGENCY' ? 'Emergency medical assistance required' : 'Scheduled medical transport')}
            </div>
          </div>
          {booking.patientPhone && (
            <a href={`tel:${booking.patientPhone}`} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
              background: C.accentSoft, color: C.accent,
              padding: '10px 14px', borderRadius: '10px', textDecoration: 'none',
              border: `1px solid ${C.accent}`, minWidth: '58px', flexShrink: 0, fontWeight: 600,
            }}>
              <span style={{ fontSize: '20px' }}>📞</span>
              <span style={{ fontSize: '10px', fontWeight: 700 }}>CALL</span>
            </a>
          )}
        </div>
      </div>

      {/* Route */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.cardBorder}` }}>
        <div style={{ fontSize: '11px', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '12px' }}>
          Route
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 12px', background: C.cardBg, borderRadius: '8px' }}>
            <span style={{ fontSize: '16px' }}>📍</span>
            <div>
              <div style={{ fontSize: '11px', color: C.textMuted, fontWeight: 600, marginBottom: '2px' }}>PICKUP</div>
              <div style={{ fontSize: '14px', color: C.textPrimary, fontWeight: 600 }}>{booking.pickupLocation}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 12px', background: C.cardBg, borderRadius: '8px' }}>
            <span style={{ fontSize: '16px' }}>🏥</span>
            <div>
              <div style={{ fontSize: '11px', color: C.textMuted, fontWeight: 600, marginBottom: '2px' }}>HOSPITAL</div>
              <div style={{ fontSize: '14px', color: C.textPrimary, fontWeight: 600 }}>{booking.selectedHospitalName || booking.dropoffLocation}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      <div style={{ padding: '10px 20px', background: C.accentSoft, borderBottom: `1px solid ${C.cardBorder}` }}>
        <span style={{ fontSize: '13px', color: C.textSecondary }}>Status: </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: C.accent }}>{step?.label || status.replace(/_/g, ' ')}</span>
      </div>

      {/* CTA */}
      {step?.btn && (
        <div style={{ padding: '16px 20px' }}>
          <button onClick={handleCTA} style={{
            width: '100%', padding: '14px', background: step.btnColor,
            color: 'white', border: 'none', borderRadius: '10px',
            fontSize: '16px', fontWeight: 700, cursor: 'pointer',
            boxShadow: `0 4px 12px ${step.btnColor}4D`,
            transition: 'transform 0.2s,box-shadow 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 16px ${step.btnColor}66`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = `0 4px 12px ${step.btnColor}4D`; }}
          >
            {step.btn}
          </button>
        </div>
      )}
    </div>
  );
};

export default ActiveCaseCard;
