import React from 'react';
import StatusBadge from './StatusBadge';

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

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS'];

const BookingCard: React.FC<BookingCardProps> = ({ booking, onTrack, onCancel, showActions = true }) => {
  const isActive = ACTIVE_STATUSES.includes(booking.status);
  const isEmergency = booking.bookingType === 'EMERGENCY';

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      // Postgres stores UTC (09:05) -> TypeORM reads as local (09:05 IST) -> sends as UTC (03:35Z)
      // Browser receives 03:35Z -> reads as local (09:05 IST) -> displays 9:05 am instead of 2:35 pm.
      // Fix: Add exactly 5.5 hours to the parsed epoch to restore the true local time.
      const d = new Date(new Date(dateStr).getTime() + 5.5 * 60 * 60 * 1000);
      
      const datePart = d.toLocaleDateString('en-GB', { 
        day: '2-digit', month: 'short', year: 'numeric' 
      });
      
      const timePart = d.toLocaleTimeString('en-US', { 
        hour: 'numeric', minute: '2-digit', hour12: true 
      }).toLowerCase();

      return `${datePart}, ${timePart}`;
    } catch {
      return dateStr;
    }
  };


  const leftAccentColor = isEmergency
    ? (booking.severity === 'CRITICAL' ? '#9F1239' : booking.severity === 'HIGH' ? '#C2410C' : '#BE123C')
    : '#1D4ED8';

  return (
    <div
      style={{
        background: 'white',
        borderRadius: '14px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
        border: '1px solid #F1F5F9',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.18s, box-shadow 0.18s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.11)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.07)';
      }}
    >
      {/* Color accent bar */}
      <div style={{ height: '4px', background: leftAccentColor }} />

      <div style={{ padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <StatusBadge status={booking.bookingType} />
            {booking.severity && <StatusBadge status={booking.severity} />}
          </div>
          <StatusBadge status={booking.status} />
        </div>

        {/* Booking ID */}
        <div style={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'monospace' }}>
          #{booking.id.slice(0, 12).toUpperCase()}
        </div>

        {/* Location */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: '2px' }}>
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#64748B"/>
          </svg>
          <span style={{ fontSize: '13px', color: '#475569', lineHeight: '1.5', flex: 1 }}>
            {booking.pickupLocation}
          </span>
        </div>

        {/* Hospital / Dispatch info */}
        {(booking.dispatch?.hospital?.name || booking.hospital?.name) && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M19 3H5c-1.1 0-2 .9-2 2v16l4-4h12c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 12H8v-2h4v2zm4-4H8V9h8v2z" fill="#64748B"/>
            </svg>
            <span style={{ fontSize: '13px', color: '#475569' }}>
              {booking.dispatch?.hospital?.name || booking.hospital?.name}
            </span>
          </div>
        )}

        {/* Ambulance info */}
        {booking.dispatch?.ambulance && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="#64748B"/>
            </svg>
            <span style={{ fontSize: '13px', color: '#475569' }}>
              {booking.dispatch.ambulance.vehicleNumber} · {booking.dispatch.ambulance.type}
            </span>
          </div>
        )}

        {/* Scheduled time */}
        {booking.scheduledTime && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6l5.25 3.15-.75 1.23L11 14V7z" fill="#64748B"/>
            </svg>
            <span style={{ fontSize: '13px', color: '#475569' }}>
              {formatDate(booking.scheduledTime)}
            </span>
          </div>
        )}

        {/* Created at */}
        <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: 'auto', paddingTop: '4px' }}>
          Booked {formatDate(booking.createdAt)}
        </div>
      </div>

      {/* Action buttons */}
      {showActions && isActive && (
        <div style={{
          padding: '12px 20px',
          background: '#F8FAFC',
          borderTop: '1px solid #F1F5F9',
          display: 'flex',
          gap: '10px',
        }}>
          {onTrack && (
            <button
              onClick={onTrack}
              style={{
                flex: 1,
                padding: '9px 16px',
                background: '#1E40AF',
                color: 'white',
                border: 'none',
                borderRadius: '9px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1D4ED8')}
              onMouseLeave={e => (e.currentTarget.style.background = '#1E40AF')}
            >
              Track
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                flex: 1,
                padding: '9px 16px',
                background: 'white',
                color: '#BE123C',
                border: '1.5px solid #FECDD3',
                borderRadius: '9px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#FFF1F2';
                e.currentTarget.style.borderColor = '#BE123C';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.borderColor = '#FECDD3';
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export { ACTIVE_STATUSES };
export default BookingCard;
