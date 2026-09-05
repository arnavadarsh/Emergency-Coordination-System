import { useState } from 'react';

/** Driver identity as sent by the backend (`dispatch.driver` / `preArrivalAlert.driver`). */
export interface DriverInfo {
  id?: string | null;
  name: string;
  photoUrl?: string | null;
  phoneNumber?: string | null;
  licenseNumber?: string | null;
  vehicleNumber?: string | null;
}

interface DriverIdentityProps {
  driver?: DriverInfo | null;
  /** Vehicle number from the surrounding dispatch, used when the driver record has none. */
  vehicleNumber?: string | null;
  /** Accent used for the initials avatar and the vehicle plate. */
  accentColor?: string;
  /** Show a tap-to-call row. Patients get this; the hospital report shows the number as text. */
  showCallButton?: boolean;
  compact?: boolean;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '?';

/**
 * Driver identity block: photo, name and vehicle number.
 * Falls back to an initials avatar when there is no photo, and to a neutral
 * "being assigned" state when no driver is linked to the dispatch yet.
 */
export function DriverIdentity({
  driver,
  vehicleNumber,
  accentColor = '#0066cc',
  showCallButton = false,
  compact = false,
}: DriverIdentityProps) {
  const [photoFailed, setPhotoFailed] = useState(false);

  const plate = driver?.vehicleNumber || vehicleNumber || null;
  const avatarSize = compact ? 44 : 56;
  const photo = driver?.photoUrl && !photoFailed ? driver.photoUrl : null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        background: 'white',
        border: '1px solid #e6e8eb',
        borderRadius: '10px',
        padding: compact ? '12px' : '14px 16px',
      }}
    >
      {photo ? (
        <img
          src={photo}
          alt={`${driver?.name} — ambulance driver`}
          onError={() => setPhotoFailed(true)}
          style={{
            width: `${avatarSize}px`,
            height: `${avatarSize}px`,
            borderRadius: '50%',
            objectFit: 'cover',
            flexShrink: 0,
            border: `2px solid ${accentColor}`,
            background: '#f4f5f7',
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: `${avatarSize}px`,
            height: `${avatarSize}px`,
            borderRadius: '50%',
            flexShrink: 0,
            background: driver ? `${accentColor}1a` : '#f4f5f7',
            color: driver ? accentColor : '#97a0af',
            border: `2px solid ${driver ? accentColor : '#dfe1e6'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: compact ? '15px' : '18px',
            letterSpacing: '0.5px',
          }}
        >
          {driver ? initialsOf(driver.name) : '👤'}
        </div>
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '11px',
            color: '#8993a4',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '3px',
            fontWeight: 600,
          }}
        >
          Driver
        </div>
        <div
          style={{
            fontSize: compact ? '15px' : '16px',
            fontWeight: 700,
            color: driver ? '#172b4d' : '#8993a4',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={driver?.name}
        >
          {driver?.name || 'Being assigned'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
          {plate && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: `${accentColor}14`,
                color: accentColor,
                border: `1px solid ${accentColor}33`,
                borderRadius: '6px',
                padding: '3px 9px',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '0.6px',
              }}
              title="Ambulance vehicle number"
            >
              🚑 {plate}
            </span>
          )}
          {driver?.phoneNumber && !showCallButton && (
            <span style={{ fontSize: '13px', color: '#5e6c84' }}>{driver.phoneNumber}</span>
          )}
        </div>
      </div>

      {showCallButton && driver?.phoneNumber && (
        <a
          href={`tel:${driver.phoneNumber}`}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '9px 14px',
            background: accentColor,
            color: 'white',
            borderRadius: '8px',
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          📞 Call
        </a>
      )}
    </div>
  );
}

export default DriverIdentity;
