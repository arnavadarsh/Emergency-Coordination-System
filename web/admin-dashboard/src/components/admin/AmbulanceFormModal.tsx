import { useId, useState, type FormEvent } from 'react';
import { Modal } from '@shared/components/ui/Modal';
import { Icon } from '@shared/components/ui/Icon';
import { Badge, StatusBadge } from '@shared/components/ui/Status';
import { adminApi, errorText, type AdminAmbulance } from '../../services/adminApi';

interface AmbulanceFormModalProps {
  /** Omit to add a new ambulance. */
  ambulance?: AdminAmbulance | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}

// The deployed `ambulance_type` enum accepts exactly these.
const VEHICLE_TYPES = ['BASIC', 'ADVANCED', 'CRITICAL_CARE'];

/**
 * Add or edit an ambulance. Setting a position here moves it on every map
 * that is watching it — useful when a unit's GPS is down. Drivers are linked
 * to it from their account (Users → Manage).
 */
export default function AmbulanceFormModal({ ambulance, onClose, onChanged }: AmbulanceFormModalProps) {
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const editing = Boolean(ambulance);
  const [form, setForm] = useState({
    vehicleNumber: ambulance?.vehicleNumber ?? '',
    vehicleType: ambulance?.vehicleType ?? 'BASIC',
    status: 'OFFLINE',
    latitude: ambulance?.currentLatitude != null ? String(ambulance.currentLatitude) : '',
    longitude: ambulance?.currentLongitude != null ? String(ambulance.currentLongitude) : '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const hasLat = form.latitude.trim() !== '';
    const hasLng = form.longitude.trim() !== '';
    if (hasLat !== hasLng) {
      setError('Give both latitude and longitude, or neither.');
      return;
    }
    const body: Record<string, unknown> = { vehicleNumber: form.vehicleNumber.trim(), vehicleType: form.vehicleType };
    if (hasLat) { body.latitude = Number(form.latitude); body.longitude = Number(form.longitude); }
    if (!editing) body.status = form.status;

    setBusy('save');
    try {
      if (ambulance) {
        await adminApi.updateAmbulance(ambulance.id, body);
        onChanged(`${body.vehicleNumber} updated.`);
      } else {
        await adminApi.createAmbulance(body);
        onChanged(`${String(body.vehicleNumber).toUpperCase()} added.`);
      }
      onClose();
    } catch (err) {
      setError(errorText(err, 'Could not save the ambulance.'));
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!ambulance) return;
    setError('');
    setBusy('delete');
    try {
      const result = await adminApi.deleteAmbulance(ambulance.id);
      onChanged(result.message);
      onClose();
    } catch (err) {
      setError(errorText(err, 'Could not delete the ambulance.'));
      setConfirmDelete(false);
      setBusy(null);
    }
  };

  return (
    <Modal onClose={busy ? undefined : onClose} closeOnBackdrop={false} labelledBy={field('title')} size="md">
      <form onSubmit={save}>
        <div className="ui-modal__header ui-modal__header--plain">
          <span className="ui-icon-tile tone-brand"><Icon name="ambulance" size={22} /></span>
          <div>
            <h2 id={field('title')} className="ui-modal__title">{editing ? ambulance!.vehicleNumber : 'Add ambulance'}</h2>
            <p className="ui-modal__subtitle">
              {editing ? <StatusBadge status={ambulance!.status} /> : 'Added by an admin, so no verification step is needed.'}
            </p>
          </div>
        </div>

        <div className="ui-modal__body">
          {error && (
            <div className="ui-alert tone-danger" role="alert" style={{ marginBottom: 14 }}>
              <Icon name="alertCircle" size={17} /><div>{error}</div>
            </div>
          )}

          <div className="ui-form-grid" style={{ marginBottom: 16 }}>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('number')}>Vehicle number</label>
              <input id={field('number')} className="ui-input" value={form.vehicleNumber} onChange={e => set('vehicleNumber')(e.target.value)} required minLength={2} maxLength={20} placeholder="DL01AB1234" data-autofocus />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('type')}>Type</label>
              <select id={field('type')} className="ui-select" value={form.vehicleType} onChange={e => set('vehicleType')(e.target.value)}>
                {VEHICLE_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            {!editing && (
              <div className="ui-field is-wide">
                <label className="ui-label" htmlFor={field('status')}>Starting status</label>
                <select id={field('status')} className="ui-select" value={form.status} onChange={e => set('status')(e.target.value)}>
                  <option value="OFFLINE">Offline — not dispatched yet</option>
                  <option value="AVAILABLE">Available — can be dispatched now</option>
                  <option value="MAINTENANCE">Maintenance</option>
                </select>
              </div>
            )}
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('lat')}>Latitude <span className="ui-label__optional">(optional)</span></label>
              <input id={field('lat')} className="ui-input" type="number" step="any" min={-90} max={90} value={form.latitude} onChange={e => set('latitude')(e.target.value)} />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('lng')}>Longitude <span className="ui-label__optional">(optional)</span></label>
              <input id={field('lng')} className="ui-input" type="number" step="any" min={-180} max={180} value={form.longitude} onChange={e => set('longitude')(e.target.value)} />
            </div>
          </div>

          {editing && (
            <>
              <dl className="ui-dl" style={{ marginBottom: 16 }}>
                <div className="ui-dl__item ui-dl__item--wide">
                  <dt>Drivers</dt>
                  <dd className={ambulance!.drivers.length ? '' : 'is-empty'}>
                    {ambulance!.drivers.length
                      ? <span className="ui-row">{ambulance!.drivers.map(d => <Badge key={d.id} tone={d.isActive ? 'info' : 'neutral'}>{d.name || d.email}</Badge>)}</span>
                      : 'None linked — link a driver from Users → Manage'}
                  </dd>
                </div>
                <div className="ui-dl__item ui-dl__item--wide">
                  <dt>Current trip</dt>
                  <dd className={ambulance!.activeTrip ? '' : 'is-empty'}>
                    {ambulance!.activeTrip ? <>Booking <code>{ambulance!.activeTrip.bookingId.slice(0, 8)}</code> · {ambulance!.activeTrip.status.replace(/_/g, ' ')}</> : 'Not on a trip'}
                  </dd>
                </div>
              </dl>

              {confirmDelete ? (
                <div className="ui-alert tone-danger" role="alertdialog">
                  <Icon name="alertTriangle" size={17} />
                  <div style={{ flex: 1 }}>
                    Delete {ambulance!.vehicleNumber}? Its drivers are unlinked. A unit with trip history is kept for the case record — set it Offline instead.
                    <div className="ui-row" style={{ marginTop: 10 }}>
                      <button type="button" className="ui-btn ui-btn--danger ui-btn--sm" onClick={remove} disabled={busy !== null}>
                        {busy === 'delete' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="trash" size={14} />}
                        Delete ambulance
                      </button>
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setConfirmDelete(false)}>Keep it</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button type="button" className="ui-btn ui-btn--danger-soft" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
                  <Icon name="trash" size={15} />
                  Delete ambulance…
                </button>
              )}
            </>
          )}
        </div>

        <div className="ui-modal__footer">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose} disabled={busy !== null}>Cancel</button>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy !== null}>
            {busy === 'save' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name={editing ? 'save' : 'plus'} size={16} />}
            {editing ? 'Save ambulance' : 'Add ambulance'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
