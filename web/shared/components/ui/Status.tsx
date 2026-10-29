import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * One vocabulary for every status in ECS.
 *
 * Booking, dispatch, ambulance, hospital and severity values all map to a
 * label, a colour tone and an icon here, so the same state reads the same way
 * on every dashboard. Nothing relies on colour alone: each badge carries its
 * text label, and most carry an icon as well.
 */

export type Tone = 'brand' | 'danger' | 'orange' | 'warning' | 'success' | 'info' | 'violet' | 'neutral';

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon?: IconName;
}

const SEVERITY: Record<string, StatusMeta> = {
  CRITICAL: { label: 'Critical', tone: 'danger', icon: 'alertOctagon' },
  HIGH: { label: 'High', tone: 'orange', icon: 'alertTriangle' },
  MEDIUM: { label: 'Medium', tone: 'warning', icon: 'alertCircle' },
  MODERATE: { label: 'Moderate', tone: 'warning', icon: 'alertCircle' },
  LOW: { label: 'Low', tone: 'success', icon: 'info' },
};

const STATUS: Record<string, StatusMeta> = {
  // Booking lifecycle
  PENDING: { label: 'Pending', tone: 'warning', icon: 'hourglass' },
  CREATED: { label: 'Requested', tone: 'warning', icon: 'hourglass' },
  CONFIRMED: { label: 'Confirmed', tone: 'info', icon: 'checkCircle' },
  ASSIGNED: { label: 'Assigned', tone: 'info', icon: 'userCheck' },
  IN_PROGRESS: { label: 'In progress', tone: 'violet', icon: 'activity' },
  COMPLETED: { label: 'Completed', tone: 'success', icon: 'checkCircle' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: 'xCircle' },

  // Dispatch lifecycle
  DISPATCHED: { label: 'Dispatched', tone: 'info', icon: 'radio' },
  EN_ROUTE: { label: 'En route', tone: 'violet', icon: 'navigation' },
  EN_ROUTE_PICKUP: { label: 'En route to patient', tone: 'violet', icon: 'navigation' },
  AT_PICKUP: { label: 'With patient', tone: 'brand', icon: 'mapPin' },
  EN_ROUTE_HOSPITAL: { label: 'En route to hospital', tone: 'violet', icon: 'navigation' },
  AT_HOSPITAL: { label: 'At hospital', tone: 'success', icon: 'hospital' },

  // Ambulance
  AVAILABLE: { label: 'Available', tone: 'success', icon: 'checkCircle' },
  BUSY: { label: 'On a case', tone: 'info', icon: 'ambulance' },
  RESERVED: { label: 'Reserved', tone: 'warning', icon: 'clock' },
  MAINTENANCE: { label: 'Maintenance', tone: 'violet', icon: 'wrench' },
  OFFLINE: { label: 'Offline', tone: 'neutral', icon: 'wifiOff' },

  // Hospital intake
  ACCEPTING: { label: 'Accepting', tone: 'success', icon: 'checkCircle' },
  LIMITED: { label: 'Limited', tone: 'warning', icon: 'alertTriangle' },
  DIVERT: { label: 'Divert', tone: 'danger', icon: 'ban' },

  // Accounts
  ACTIVE: { label: 'Active', tone: 'success', icon: 'checkCircle' },
  INACTIVE: { label: 'Inactive', tone: 'neutral', icon: 'circleDot' },

  // Booking type
  EMERGENCY: { label: 'Emergency', tone: 'danger', icon: 'siren' },
  SCHEDULED: { label: 'Scheduled', tone: 'info', icon: 'calendarClock' },

  // Notifications
  SENT: { label: 'Sent', tone: 'success', icon: 'check' },
  FAILED: { label: 'Failed', tone: 'danger', icon: 'alertCircle' },
};

const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');

/** "EN_ROUTE_PICKUP" → "En route pickup", for values this file does not know. */
export const humanize = (value: unknown) => {
  const text = String(value ?? '').replace(/_/g, ' ').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown';
};

export function statusMeta(value: unknown): StatusMeta {
  const key = normalize(value);
  return STATUS[key] ?? SEVERITY[key] ?? { label: humanize(value), tone: 'neutral' };
}

export function severityMeta(value: unknown): StatusMeta {
  const key = normalize(value);
  return SEVERITY[key] ?? { label: humanize(value), tone: 'neutral', icon: 'circleDot' };
}

export const toneClass = (tone: Tone) => `tone-${tone}`;

/** Solid tone colours, for places CSS classes cannot reach (map markers, charts). */
export const TONE_COLOR: Record<Tone, string> = {
  brand: '#0891b2',
  danger: '#dc2626',
  orange: '#ea580c',
  warning: '#f59e0b',
  success: '#16a34a',
  info: '#2563eb',
  violet: '#7c3aed',
  neutral: '#64748b',
};

interface BadgeProps {
  tone?: Tone;
  icon?: IconName;
  dot?: boolean;
  solid?: boolean;
  caps?: boolean;
  large?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', icon, dot, solid, caps, large, title, className, children }: BadgeProps) {
  const classes = [
    'ui-badge',
    toneClass(tone),
    solid && 'ui-badge--solid',
    caps && 'ui-badge--caps',
    large && 'ui-badge--lg',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} title={title}>
      {dot && <span className="ui-badge__dot" aria-hidden="true" />}
      {icon && !dot && <Icon name={icon} size={13} strokeWidth={2.25} />}
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: unknown;
  /** Show the status icon (default) or a coloured dot. */
  variant?: 'icon' | 'dot';
  large?: boolean;
  /** Override the displayed text but keep the tone. */
  label?: string;
}

export function StatusBadge({ status, variant = 'icon', large, label }: StatusBadgeProps) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} icon={variant === 'icon' ? meta.icon : undefined} dot={variant === 'dot'} large={large}>
      {label ?? meta.label}
    </Badge>
  );
}

interface SeverityBadgeProps {
  severity: unknown;
  large?: boolean;
  /** Critical renders as a solid red badge so it is unmistakable in a list. */
  emphasizeCritical?: boolean;
}

export function SeverityBadge({ severity, large, emphasizeCritical = true }: SeverityBadgeProps) {
  const meta = severityMeta(severity);
  const critical = normalize(severity) === 'CRITICAL';
  return (
    <Badge tone={meta.tone} icon={meta.icon} caps large={large} solid={critical && emphasizeCritical}>
      {meta.label}
    </Badge>
  );
}
