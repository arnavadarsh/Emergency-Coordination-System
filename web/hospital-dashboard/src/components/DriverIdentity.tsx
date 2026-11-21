import { useState, type CSSProperties } from 'react';
import { Icon } from '@shared/components/ui/Icon';
import { initialsOf } from '@shared/components/ui/primitives';

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
  /** Accent used for the avatar ring. */
  accentColor?: string;
  /** Show a tap-to-call row. Patients get this; the hospital report shows the number as text. */
  showCallButton?: boolean;
  compact?: boolean;
}

/**
 * Driver identity block: photo, name and vehicle number.
 * Falls back to an initials avatar when there is no photo, and to a neutral
 * "being assigned" state when no driver is linked to the dispatch yet.
 */
export function DriverIdentity({
  driver,
  vehicleNumber,
  accentColor = '#0e7490',
  showCallButton = false,
  compact = false,
}: DriverIdentityProps) {
  const [photoFailed, setPhotoFailed] = useState(false);

  const plate = driver?.vehicleNumber || vehicleNumber || null;
  const photo = driver?.photoUrl && !photoFailed ? driver.photoUrl : null;

  return (
    <div
      className={`ui-driver${compact ? ' ui-driver--compact' : ''}${driver ? '' : ' is-pending'}`}
      style={{ '--driver-accent': accentColor } as CSSProperties}
    >
      <div className="ui-driver__avatar">
        {photo ? (
          <img src={photo} alt={`${driver?.name} — ambulance driver`} onError={() => setPhotoFailed(true)} />
        ) : driver ? (
          <span aria-hidden="true">{initialsOf(driver.name)}</span>
        ) : (
          <Icon name="user" size={compact ? 18 : 22} />
        )}
      </div>

      <div className="ui-driver__info">
        <div className="ui-driver__role">Driver</div>
        <div className="ui-driver__name ui-truncate" title={driver?.name}>
          {driver?.name || 'Being assigned'}
        </div>
        {(plate || (driver?.phoneNumber && !showCallButton)) && (
          <div className="ui-driver__meta">
            {plate && (
              <span className="ui-plate" title="Ambulance vehicle number">
                <Icon name="ambulance" size={14} />
                {plate}
              </span>
            )}
            {driver?.phoneNumber && !showCallButton && (
              <span className="ui-driver__phone ui-num">{driver.phoneNumber}</span>
            )}
          </div>
        )}
      </div>

      {showCallButton && driver?.phoneNumber && (
        <a href={`tel:${driver.phoneNumber}`} className="ui-btn ui-btn--primary ui-driver__call" aria-label={`Call ${driver.name}`}>
          <Icon name="phone" size={16} />
          Call
        </a>
      )}
    </div>
  );
}

export default DriverIdentity;
