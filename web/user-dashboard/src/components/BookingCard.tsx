import React from 'react';
import StatusBadge from './StatusBadge';
import { formatIstDateTime } from '@shared/utils/datetime';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { severityMeta } from '@shared/components/ui/Status';

interface Booking {
  id: string;
  bookingType: 'EMERGENCY' | 'SCHEDULED';
  severity?: string;
  status: string;
  pickupLocation: string;
  scheduledTime?: string;
  createdAt: string;
  hospital?: { name: string; address?: string };
  dispatch?: {
    status: string;
    hospital?: { name: string };
    ambulance?: { vehicleNumber: string; type: string };
  };
}

interface BookingCardProps {
  booking: Booking;
  onTrack?: () => void;
  onCancel?: () => void;
  showActions?: boolean;
}

/**
 * The statuses that mean a request is still live, so it belongs under Current
 * Bookings rather than History.
 *
 * CREATED was missing. A booking is CREATED the moment it is raised and only
 * becomes ASSIGNED once auto-dispatch finds a free ambulance — so whenever the
 * fleet is fully committed, a brand-new request stayed CREATED and disappeared
 * from Current, filed under History while the patient was still waiting for it.
 *
 * CONFIRMED was listed but is not one of the backend's statuses (see
 * BookingStatus: PENDING, CREATED, ASSIGNED, IN_PROGRESS, COMPLETED,
 * CANCELLED), so it never matched anything.
 */
const ACTIVE_STATUSES = ['PENDING', 'CREATED', 'ASSIGNED', 'IN_PROGRESS'];

const BookingCard: React.FC<BookingCardProps> = ({ booking, onTrack, onCancel, showActions = true }) => {
  const isActive = ACTIVE_STATUSES.includes(booking.status);
  const isEmergency = booking.bookingType === 'EMERGENCY';

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    // The backend runs in UTC and sends true UTC instants, so this just renders in IST.
    // (A manual +5:30 shift used to live here, compensating for a driver-level timezone bug.)
    return formatIstDateTime(dateStr) || dateStr;
  };


  // Severity drives the accent rail for emergencies; scheduled trips stay calm blue.
  const accentTone = isEmergency ? severityMeta(booking.severity || 'MEDIUM').tone : 'info';
  const hospitalName = booking.dispatch?.hospital?.name || booking.hospital?.name;

  const details: { icon: IconName; label: string; value: string }[] = [
    { icon: 'mapPin', label: 'Pickup', value: booking.pickupLocation },
    ...(hospitalName ? [{ icon: 'hospital' as IconName, label: 'Hospital', value: hospitalName }] : []),
    ...(booking.dispatch?.ambulance
      ? [{ icon: 'ambulance' as IconName, label: 'Ambulance', value: `${booking.dispatch.ambulance.vehicleNumber} · ${booking.dispatch.ambulance.type}` }]
      : []),
    ...(booking.scheduledTime ? [{ icon: 'calendarClock' as IconName, label: 'Scheduled', value: formatDate(booking.scheduledTime) }] : []),
  ];

  return (
    <article className={`ui-card ui-accent ui-accent--${accentTone} usr-booking`} aria-label={`${isEmergency ? 'Emergency' : 'Scheduled'} booking ${booking.id.slice(0, 8)}`}>
      <div className="usr-booking__body">
        {/* Header row */}
        <div className="usr-booking__head">
          <div className="ui-row">
            <StatusBadge status={booking.bookingType} type="bookingType" />
            {booking.severity && <StatusBadge status={booking.severity} type="severity" />}
          </div>
          <StatusBadge status={booking.status} />
        </div>

        <div className="usr-booking__ref ui-mono">#{booking.id.slice(0, 12).toUpperCase()}</div>

        <dl className="usr-booking__details">
          {details.map(d => (
            <div key={d.label} className="usr-booking__detail">
              <dt><Icon name={d.icon} size={15} /><span className="ui-sr-only">{d.label}</span></dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>

        <div className="usr-booking__time">Booked {formatDate(booking.createdAt)}</div>
      </div>

      {/* Action buttons */}
      {showActions && isActive && (onTrack || onCancel) && (
        <div className="usr-booking__actions">
          {onTrack && (
            <button type="button" onClick={onTrack} className="ui-btn ui-btn--primary ui-btn--sm">
              <Icon name="navigation" size={15} />
              Track
            </button>
          )}
          {onCancel && (
            <button type="button" onClick={onCancel} className="ui-btn ui-btn--danger-soft ui-btn--sm">
              Cancel
            </button>
          )}
        </div>
      )}
    </article>
  );
};

export { ACTIVE_STATUSES };
export default BookingCard;
