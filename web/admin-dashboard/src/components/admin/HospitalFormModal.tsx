import { useId, useState, type FormEvent } from 'react';
import { Modal } from '@shared/components/ui/Modal';
import { Icon } from '@shared/components/ui/Icon';
import { adminApi, errorText, type AdminHospital, type Capability } from '../../services/adminApi';

interface HospitalFormModalProps {
  /** Omit to create a new hospital. */
  hospital?: AdminHospital | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}

const CAPABILITIES: { type: string; label: string }[] = [
  { type: 'ER', label: 'Emergency Room' },
  { type: 'ICU', label: 'Intensive Care' },
  { type: 'CARDIAC', label: 'Cardiac Care' },
  { type: 'TRAUMA', label: 'Trauma Centre' },
  { type: 'NEURO', label: 'Neurology' },
  { type: 'OB', label: 'Obstetrics' },
];

/**
 * Create or edit a hospital: contact details, map position, beds and intake
 * status, and the specialist capabilities that decide which patients it is
 * ranked for. Closing it or filling it up reroutes ambulances already heading
 * there, exactly as when the hospital does it itself.
 */
export default function HospitalFormModal({ hospital, onClose, onChanged }: HospitalFormModalProps) {
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const editing = Boolean(hospital);
  const [form, setForm] = useState({
    name: hospital?.name ?? '',
    address: hospital?.address ?? '',
    phoneNumber: hospital?.phoneNumber ?? '',
    email: hospital?.email ?? '',
    latitude: hospital ? String(hospital.latitude) : '',
    longitude: hospital ? String(hospital.longitude) : '',
    totalBeds: hospital ? String(hospital.totalBeds) : '0',
    availableBeds: hospital ? String(hospital.availableBeds) : '0',
    status: hospital?.status ?? 'ACCEPTING',
  });
  const [capabilities, setCapabilities] = useState<Capability[]>(hospital?.capabilities ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy('save');
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      address: form.address.trim(),
      phoneNumber: form.phoneNumber.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      totalBeds: Number(form.totalBeds),
      availableBeds: Number(form.availableBeds),
      status: form.status,
    };
    if (form.email.trim()) body.email = form.email.trim();
    else if (editing) body.email = null;
    try {
      if (hospital) {
        await adminApi.updateHospital(hospital.id, body);
        onChanged(`${body.name} updated.`);
      } else {
        await adminApi.createHospital(body);
        onChanged(`${body.name} added. Open it again to add its capabilities.`);
      }
      onClose();
    } catch (err) {
      setError(errorText(err, 'Could not save the hospital.'));
      setBusy(null);
    }
  };

  const capabilityOf = (type: string) => capabilities.find(c => c.capabilityType === type);

  const saveCapability = async (type: string, patch: Partial<Capability>) => {
    if (!hospital) return;
    setError('');
    setBusy(`cap-${type}`);
    try {
      const saved = await adminApi.saveCapability(hospital.id, type, patch);
      setCapabilities(prev => [...prev.filter(c => c.capabilityType !== type), saved]);
      onChanged(`${type} saved for ${hospital.name}.`);
    } catch (err) {
      setError(errorText(err, `Could not save ${type}.`));
    } finally {
      setBusy(null);
    }
  };

  const removeCapability = async (type: string) => {
    if (!hospital) return;
    setError('');
    setBusy(`cap-${type}`);
    try {
      await adminApi.removeCapability(hospital.id, type);
      setCapabilities(prev => prev.filter(c => c.capabilityType !== type));
      onChanged(`${type} removed from ${hospital.name}.`);
    } catch (err) {
      setError(errorText(err, `Could not remove ${type}.`));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!hospital) return;
    setError('');
    setBusy('delete');
    try {
      const result = await adminApi.deleteHospital(hospital.id);
      onChanged(result.message);
      onClose();
    } catch (err) {
      setError(errorText(err, 'Could not delete the hospital.'));
      setConfirmDelete(false);
      setBusy(null);
    }
  };

  return (
    <Modal onClose={busy ? undefined : onClose} closeOnBackdrop={false} labelledBy={field('title')} size="lg" align="top">
      <form onSubmit={save}>
        <div className="ui-modal__header ui-modal__header--plain">
          <span className="ui-icon-tile tone-brand"><Icon name="hospital" size={22} /></span>
          <div>
            <h2 id={field('title')} className="ui-modal__title">{editing ? hospital!.name : 'Add hospital'}</h2>
            <p className="ui-modal__subtitle">
              {editing
                ? `${hospital!.staff?.length ?? 0} staff login(s) · ${hospital!.incomingAmbulances ?? 0} ambulance(s) on the way`
                : 'New hospitals are ranked for dispatch as soon as they accept patients.'}
            </p>
          </div>
        </div>

        <div className="ui-modal__body">
          {error && (
            <div className="ui-alert tone-danger" role="alert" style={{ marginBottom: 14 }}>
              <Icon name="alertCircle" size={17} /><div>{error}</div>
            </div>
          )}

          <div className="ui-form-grid" style={{ marginBottom: 20 }}>
            <div className="ui-field is-wide">
              <label className="ui-label" htmlFor={field('name')}>Name</label>
              <input id={field('name')} className="ui-input" value={form.name} onChange={e => set('name')(e.target.value)} required minLength={2} maxLength={255} data-autofocus />
            </div>
            <div className="ui-field is-wide">
              <label className="ui-label" htmlFor={field('address')}>Address</label>
              <input id={field('address')} className="ui-input" value={form.address} onChange={e => set('address')(e.target.value)} required minLength={2} />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('phone')}>Phone</label>
              <input id={field('phone')} className="ui-input" type="tel" value={form.phoneNumber} onChange={e => set('phoneNumber')(e.target.value)} required maxLength={20} />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('email')}>Email <span className="ui-label__optional">(optional)</span></label>
              <input id={field('email')} className="ui-input" type="email" value={form.email} onChange={e => set('email')(e.target.value)} />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('lat')}>Latitude</label>
              <input id={field('lat')} className="ui-input" type="number" step="any" min={-90} max={90} value={form.latitude} onChange={e => set('latitude')(e.target.value)} required />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('lng')}>Longitude</label>
              <input id={field('lng')} className="ui-input" type="number" step="any" min={-180} max={180} value={form.longitude} onChange={e => set('longitude')(e.target.value)} required />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('total')}>Total beds</label>
              <input id={field('total')} className="ui-input" type="number" min={0} value={form.totalBeds} onChange={e => set('totalBeds')(e.target.value)} required />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('available')}>Available beds</label>
              <input id={field('available')} className="ui-input" type="number" min={0} value={form.availableBeds} onChange={e => set('availableBeds')(e.target.value)} required />
              <div className="ui-help">0 reroutes ambulances heading here.</div>
            </div>
            <div className="ui-field is-wide">
              <label className="ui-label" htmlFor={field('status')}>Intake status</label>
              <select id={field('status')} className="ui-select" value={form.status} onChange={e => set('status')(e.target.value)}>
                <option value="ACCEPTING">Accepting patients</option>
                <option value="LIMITED">Limited — critical cases only</option>
                <option value="DIVERT">Divert — send ambulances elsewhere</option>
              </select>
            </div>
          </div>

          {editing && (
            <>
              <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="stethoscope" size={16} />Capabilities</h3>
              <p className="ui-help" style={{ marginBottom: 10 }}>
                Patients needing a capability are only ranked to hospitals that have it and are accepting. Saving a capability as
                diverting, or at capacity, reroutes ambulances already on the way for it.
              </p>
              <div className="ui-table-wrap" style={{ marginBottom: 20 }}>
                <table className="ui-table ui-table--stack">
                  <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Capacity</th><th scope="col">In use</th><th scope="col"><span className="ui-sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {CAPABILITIES.map(({ type, label }) => (
                      <CapabilityRow
                        key={`${type}-${capabilityOf(type)?.id ?? 'none'}`}
                        type={type}
                        label={label}
                        capability={capabilityOf(type)}
                        busy={busy === `cap-${type}`}
                        disabled={busy !== null}
                        onSave={patch => saveCapability(type, patch)}
                        onRemove={() => removeCapability(type)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="trash" size={16} />Remove</h3>
              {confirmDelete ? (
                <div className="ui-alert tone-danger" role="alertdialog">
                  <Icon name="alertTriangle" size={17} />
                  <div style={{ flex: 1 }}>
                    Delete {hospital!.name}? Staff logins linked to it are unlinked. A hospital that has received patients is kept for the case history — set it to Divert instead.
                    <div className="ui-row" style={{ marginTop: 10 }}>
                      <button type="button" className="ui-btn ui-btn--danger ui-btn--sm" onClick={remove} disabled={busy !== null}>
                        {busy === 'delete' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="trash" size={14} />}
                        Delete hospital
                      </button>
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setConfirmDelete(false)}>Keep it</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button type="button" className="ui-btn ui-btn--danger-soft" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
                  <Icon name="trash" size={15} />
                  Delete hospital…
                </button>
              )}
            </>
          )}
        </div>

        <div className="ui-modal__footer">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose} disabled={busy !== null}>Cancel</button>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy !== null}>
            {busy === 'save' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name={editing ? 'save' : 'plus'} size={16} />}
            {editing ? 'Save hospital' : 'Add hospital'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CapabilityRow({ type, label, capability, busy, disabled, onSave, onRemove }: {
  type: string;
  label: string;
  capability?: Capability;
  busy: boolean;
  disabled: boolean;
  onSave: (patch: Partial<Capability>) => void;
  onRemove: () => void;
}) {
  const [status, setStatus] = useState(capability?.status ?? 'ACCEPTING');
  const [capacity, setCapacity] = useState(String(capability?.capacity ?? 0));
  const [load, setLoad] = useState(String(capability?.currentLoad ?? 0));

  return (
    <tr>
      <td data-label="Capability">
        <span className="ui-table__primary">{label}</span> <code>{type}</code>
        {!capability && <div className="ui-table__secondary">Not offered</div>}
      </td>
      <td data-label="Status">
        <select className="ui-select ui-select--sm" aria-label={`${label} status`} value={status} onChange={e => setStatus(e.target.value)} disabled={disabled}>
          <option value="ACCEPTING">Accepting</option>
          <option value="LIMITED">Limited</option>
          <option value="DIVERT">Divert</option>
        </select>
      </td>
      <td data-label="Capacity">
        <input className="ui-input ui-input--sm" style={{ width: 80 }} type="number" min={0} aria-label={`${label} capacity`} value={capacity} onChange={e => setCapacity(e.target.value)} disabled={disabled} />
      </td>
      <td data-label="In use">
        <input className="ui-input ui-input--sm" style={{ width: 80 }} type="number" min={0} aria-label={`${label} in use`} value={load} onChange={e => setLoad(e.target.value)} disabled={disabled} />
      </td>
      <td data-label="Actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="ui-btn ui-btn--secondary ui-btn--sm"
          onClick={() => onSave({ status, capacity: Number(capacity), currentLoad: Number(load) })}
          disabled={disabled}
        >
          {busy ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name={capability ? 'save' : 'plus'} size={14} />}
          {capability ? 'Save' : 'Add'}
        </button>
        {capability && (
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onRemove} disabled={disabled} aria-label={`Remove ${label}`}>
            <Icon name="x" size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}
