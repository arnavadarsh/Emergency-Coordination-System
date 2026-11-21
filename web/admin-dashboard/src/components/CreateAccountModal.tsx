import { useId, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Modal } from '@shared/components/ui/Modal';
import { Icon } from '@shared/components/ui/Icon';

type AccountRole = 'HOSPITAL' | 'DRIVER' | 'ADMIN' | 'USER';

interface CreateAccountModalProps {
  hospitals: { id: string; name: string }[];
  ambulances: { id: string; vehicleNumber: string }[];
  apiBaseUrl: string;
  token: string;
  onClose: () => void;
  onCreated: (account: { email: string; role: string }) => void;
}

const ROLE_HINT: Record<AccountRole, string> = {
  HOSPITAL: 'Receives pre-arrival alerts and manages beds for one hospital.',
  DRIVER: 'Runs trips for one ambulance.',
  ADMIN: 'Full access to every case, account and setting.',
  USER: 'A patient account, the same as public sign-up.',
};

/**
 * Create a staff account.
 *
 * Public sign-up only makes patient accounts, so this is how hospital, driver
 * and admin logins come to exist. A hospital login is tied to one hospital and a
 * driver to one ambulance, which decides exactly which cases they can see.
 */
export default function CreateAccountModal({ hospitals, ambulances, apiBaseUrl, token, onClose, onCreated }: CreateAccountModalProps) {
  const ids = useId();
  const [role, setRole] = useState<AccountRole>('HOSPITAL');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body: Record<string, string> = { role, firstName, lastName, email, password };
      if (phoneNumber) body.phoneNumber = phoneNumber;
      if (role === 'HOSPITAL') body.hospitalId = hospitalId;
      if (role === 'DRIVER') {
        if (vehicleNumber) body.vehicleNumber = vehicleNumber.trim();
        if (licenseNumber) body.licenseNumber = licenseNumber.trim();
      }
      const res = await axios.post(`${apiBaseUrl}/auth/accounts`, body, { headers: { Authorization: `Bearer ${token}` } });
      onCreated(res.data);
    } catch (err: any) {
      const message = err.response?.data?.message;
      setError(Array.isArray(message) ? message.join(' ') : message || 'Could not create the account.');
      setSaving(false);
    }
  };

  const field = (suffix: string) => `${ids}-${suffix}`;

  return (
    <Modal onClose={saving ? undefined : onClose} closeOnBackdrop={false} labelledBy={field('title')} size="md">
      <form onSubmit={submit}>
        <div className="ui-modal__header ui-modal__header--plain">
          <span className="ui-icon-tile tone-info"><Icon name="userPlus" size={22} /></span>
          <div>
            <h2 id={field('title')} className="ui-modal__title">Create account</h2>
            <p className="ui-modal__subtitle">Hospital staff, drivers and admins can only be added here.</p>
          </div>
        </div>

        <div className="ui-modal__body">
          {error && (
            <div className="ui-alert tone-danger" role="alert" style={{ marginBottom: 14 }}>
              <Icon name="alertCircle" size={17} />
              <div>{error}</div>
            </div>
          )}

          <div className="ui-form-grid">
            <div className="ui-field is-wide">
              <label className="ui-label" htmlFor={field('role')}>Account type</label>
              <select id={field('role')} className="ui-select" value={role} onChange={e => setRole(e.target.value as AccountRole)} data-autofocus>
                <option value="HOSPITAL">Hospital staff</option>
                <option value="DRIVER">Ambulance driver</option>
                <option value="ADMIN">Admin</option>
                <option value="USER">Patient</option>
              </select>
              <div className="ui-help">{ROLE_HINT[role]}</div>
            </div>

            {role === 'HOSPITAL' && (
              <div className="ui-field is-wide">
                <label className="ui-label" htmlFor={field('hospital')}>Hospital</label>
                <select id={field('hospital')} className="ui-select" value={hospitalId} onChange={e => setHospitalId(e.target.value)} required>
                  <option value="" disabled>Choose the hospital this login manages…</option>
                  {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            )}

            {role === 'DRIVER' && (
              <>
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('vehicle')}>Ambulance number</label>
                  <input
                    id={field('vehicle')}
                    className="ui-input"
                    list={field('vehicles')}
                    value={vehicleNumber}
                    onChange={e => setVehicleNumber(e.target.value)}
                    placeholder="DL01AA1001"
                    maxLength={20}
                    required
                  />
                  <datalist id={field('vehicles')}>
                    {ambulances.map(a => <option key={a.id} value={a.vehicleNumber} />)}
                  </datalist>
                  <div className="ui-help">A new number is registered as pending verification.</div>
                </div>
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('licence')}>
                    Driving licence <span className="ui-label__optional">(optional)</span>
                  </label>
                  <input id={field('licence')} className="ui-input" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} maxLength={50} />
                </div>
              </>
            )}

            <div className="ui-field">
              <label className="ui-label" htmlFor={field('first')}>First name</label>
              <input id={field('first')} className="ui-input" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="off" required />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('last')}>Last name</label>
              <input id={field('last')} className="ui-input" value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="off" required />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('email')}>Email</label>
              <input id={field('email')} className="ui-input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" required />
            </div>
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('phone')}>
                Phone <span className="ui-label__optional">(optional)</span>
              </label>
              <input id={field('phone')} className="ui-input" type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} maxLength={20} />
            </div>
            <div className="ui-field is-wide">
              <label className="ui-label" htmlFor={field('password')}>Temporary password</label>
              <input
                id={field('password')}
                className="ui-input"
                type="text"
                value={password}
                onChange={e => setPassword(e.target.value)}
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                required
              />
              <div className="ui-help">At least 8 characters. Share it with the person directly.</div>
            </div>
          </div>
        </div>

        <div className="ui-modal__footer">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={saving}>
            {saving ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="userPlus" size={16} />}
            {saving ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
