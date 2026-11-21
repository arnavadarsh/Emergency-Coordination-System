import React from 'react';
import { SeverityBadge, StatusBadge as SharedStatusBadge } from '@shared/components/ui/Status';

interface StatusBadgeProps {
  status: string;
  type?: 'status' | 'severity' | 'bookingType';
}

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'MODERATE', 'LOW'];

/**
 * Booking status, severity or booking type, drawn from the shared ECS status
 * vocabulary (components/ui/Status) so it matches every other dashboard.
 */
const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type }) => {
  if (type === 'severity' || (type === undefined && SEVERITIES.includes(String(status).toUpperCase()))) {
    return <SeverityBadge severity={status} />;
  }
  return <SharedStatusBadge status={status} />;
};

export default StatusBadge;
