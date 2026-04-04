import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'status' | 'severity' | 'bookingType';
}

const STATUS_CONFIG: Record<string, { bg: string; color: string; label: string }> = {
  // Booking status
  PENDING:     { bg: '#EFF6FF', color: '#1D4ED8', label: 'Pending' },
  CONFIRMED:   { bg: '#EFF6FF', color: '#1D4ED8', label: 'Confirmed' },
  ASSIGNED:    { bg: '#FFF7ED', color: '#C2410C', label: 'Assigned' },
  IN_PROGRESS: { bg: '#F0FDF4', color: '#15803D', label: 'In Progress' },
  COMPLETED:   { bg: '#F0FDF4', color: '#166534', label: 'Completed' },
  CANCELLED:   { bg: '#FFF1F2', color: '#BE123C', label: 'Cancelled' },
  // Severity
  CRITICAL:    { bg: '#FFF1F2', color: '#9F1239', label: 'Critical' },
  HIGH:        { bg: '#FFF7ED', color: '#9A3412', label: 'High' },
  MEDIUM:      { bg: '#FEFCE8', color: '#854D0E', label: 'Medium' },
  LOW:         { bg: '#F0FDF4', color: '#166534', label: 'Low' },
  // Booking type
  EMERGENCY:   { bg: '#FFF1F2', color: '#BE123C', label: 'Emergency' },
  SCHEDULED:   { bg: '#EFF6FF', color: '#1E40AF', label: 'Scheduled' },
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = STATUS_CONFIG[status] ?? { bg: '#F3F4F6', color: '#374151', label: status };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
        background: config.bg,
        color: config.color,
        whiteSpace: 'nowrap',
      }}
    >
      {config.label}
    </span>
  );
};

export default StatusBadge;
