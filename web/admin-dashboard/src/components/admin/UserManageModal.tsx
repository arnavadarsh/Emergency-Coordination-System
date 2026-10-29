import { useEffect, useId, useState, type FormEvent } from 'react';
import { Modal } from '@shared/components/ui/Modal';
import { Icon } from '@shared/components/ui/Icon';
import { Badge } from '@shared/components/ui/Status';
import { adminApi, errorText, type AdminUserDetail, type Role } from '../../services/adminApi';
import { formatIstFull } from '@shared/utils/datetime';

interface UserManageModalProps {
  userId: string;
  currentAdminId: string | null;
  hospitals: { id: string; name: string }[];
  ambulances: { id: string; vehicleNumber: string }[];
  onClose: () => void;
  /** Something changed; the caller refreshes its lists and shows `message`. */
  onChanged: (message: string) => void;
}

/**
 * Everything about one account in one place: who they are, what they can
 * reach (role, hospital or ambulance, active), and their sessions.
 */
export default function UserManageModal({ userId, currentAdminId, hospitals, ambulances, onClose, onChanged }: UserManageModalProps) {
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phoneNumber: '', role: 'USER' as Role, isActive: true,
    hospitalId: '', ambulanceId: '', licenseNumber: '',
  });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const isSelf = userId === currentAdminId;

  const fill = (u: AdminUserDetail) => {
    setUser(u);
    setForm({
      firstName: u.firstName ?? '', lastName: u.lastName ?? '', email: u.email, phoneNumber: u.phoneNumber ?? '',
      role: u.role, isActive: u.isActive, hospitalId: u.hospital?.id ?? '', ambulanceId: u.ambulance?.id ?? '',
      licenseNumber: u.licenseNumber ?? '',
    });
    setWarnings(u.warnings ?? []);
  };

  useEffect(() => {
    adminApi.getUser(userId).then(fill).catch(err => setError(errorText(err, 'Could not load this account.')));
  }, [userId]);

  const set = (key: keyof typeof form) => (value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    const body: Record<string, unknown> = {};
    if (form.firstName !== (user.firstName ?? '')) body.firstName = form.firstName;
    if (form.lastName !== (user.lastName ?? '')) body.lastName = form.lastName;
    if (form.email.trim().toLowerCase() !== user.email.toLowerCase()) body.email = form.email.trim();
    if (form.phoneNumber !== (user.phoneNumber ?? '')) body.phoneNumber = form.phoneNumber;
    if (form.role !== user.role) body.role = form.role;
    if (form.isActive !== user.isActive) body.isActive = form.isActive;
    if (form.hospitalId !== (user.hospital?.id ?? '')) body.hospitalId = form.hospitalId || null;
    if (form.ambulanceId !== (user.ambulance?.id ?? '')) body.ambulanceId = form.ambulanceId || null;
    if (form.role === 'DRIVER' && form.licenseNumber !== (user.licenseNumber ?? '')) body.licenseNumber = form.licenseNumber || null;
    if (Object.keys(body).length === 0) { onClose(); return; }

    setBusy('save');
    try {
      const updated = await adminApi.updateUser(userId, body as any);
      fill(updated);
      onChanged(`${updated.email} updated.`);
      if (!updated.warnings?.length) onClose();
    } catch (err) {
      setError(errorText(err, 'Could not save these changes.'));
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    setError('');
    setBusy('password');
    try {
      await adminApi.resetPassword(userId, password);
      setPassword('');
      onChanged('Password reset. The account was signed out everywhere — share the new password with them directly.');
      fill(await adminApi.getUser(userId));
    } catch (err) {
      setError(errorText(err, 'Could not reset the password.'));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setError('');
    setBusy('signout');
    try {
      await adminApi.signOut(userId);
      setConfirmSignOut(false);
      onChanged(isSelf ? 'You were signed out everywhere.' : 'Signed out on every device.');
      fill(await adminApi.getUser(userId));
    } catch (err) {
      setError(errorText(err, 'Could not sign this account out.'));
    } finally {
      setBusy(null);
    }
  };

  const fullName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';

  return (
    <Modal onClose={busy ? undefined : onClose} closeOnBackdrop={false} labelledBy={field('title')} size="lg" align="top">
      <form onSubmit={save}>
        <div className="ui-modal__header ui-modal__header--plain">
          <span className="ui-avatar">{(user?.email ?? '?').charAt(0).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <h2 id={field('title')} className="ui-modal__title">{fullName || user?.email || 'Account'}</h2>
            <p className="ui-modal__subtitle">
              {user ? <>{user.email} · <Badge tone={user.isActive ? 'success' : 'neutral'}>{user.isActive ? 'Active' : 'Inactive'}</Badge> · {user.bookingCount} booking(s)</> : 'Loading…'}
            </p>
          </div>
        </div>

        <div className="ui-modal__body">
          {error && (
            <div className="ui-alert tone-danger" role="alert" style={{ marginBottom: 14 }}>
              <Icon name="alertCircle" size={17} /><div>{error}</div>
            </div>
          )}
          {warnings.map(w => (
            <div key={w} className="ui-alert tone-warning" role="status" style={{ marginBottom: 14 }}>
              <Icon name="alertTriangle" size={17} /><div>{w}</div>
            </div>
          ))}

          {user && (
            <>
              <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="user" size={16} />Profile</h3>
              <div className="ui-form-grid" style={{ marginBottom: 20 }}>
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('first')}>First name</label>
                  <input id={field('first')} className="ui-input" value={form.firstName} onChange={e => set('firstName')(e.target.value)} maxLength={100} />
                </div>
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('last')}>Last name</label>
                  <input id={field('last')} className="ui-input" value={form.lastName} onChange={e => set('lastName')(e.target.value)} maxLength={100} />
                </div>
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('email')}>Email</label>
                  <input id={field('email')} className="ui-input" type="email" value={form.email} onChange={e => set('email')(e.target.value)} required />
                </div>
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('phone')}>Phone</label>
                  <input id={field('phone')} className="ui-input" type="tel" value={form.phoneNumber} onChange={e => set('phoneNumber')(e.target.value)} maxLength={20} />
                </div>
              </div>

              <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="shieldCheck" size={16} />Access</h3>
              {isSelf && <p className="ui-help" style={{ marginBottom: 10 }}>This is your own account. Another admin has to change your role or switch it off.</p>}
              <div className="ui-form-grid" style={{ marginBottom: 20 }}>
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('role')}>Role</label>
                  <select id={field('role')} className="ui-select" value={form.role} onChange={e => set('role')(e.target.value)} disabled={isSelf}>
                    <option value="USER">Patient</option>
                    <option value="DRIVER">Driver</option>
                    <option value="HOSPITAL">Hospital staff</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div className="ui-field">
                  <span className="ui-label" id={field('active-label')}>Account active</span>
                  <div className="ui-row" style={{ minHeight: 40 }}>
                    <button
                      type="button"
                      role="switch"
                      className="ui-switch"
                      aria-checked={form.isActive}
                      aria-labelledby={field('active-label')}
                      onClick={() => set('isActive')(!form.isActive)}
                      disabled={isSelf}
                    />
                    <span className="ui-help">{form.isActive ? 'Can sign in' : 'Cannot sign in; current sessions stop'}</span>
                  </div>
                </div>
                {form.role === 'HOSPITAL' && (
                  <div className="ui-field is-wide">
                    <label className="ui-label" htmlFor={field('hospital')}>Hospital</label>
                    <select id={field('hospital')} className="ui-select" value={form.hospitalId} onChange={e => set('hospitalId')(e.target.value)}>
                      <option value="">Not linked — sees no cases</option>
                      {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                  </div>
                )}
                {form.role === 'DRIVER' && (
                  <>
                    <div className="ui-field">
                      <label className="ui-label" htmlFor={field('ambulance')}>Ambulance</label>
                      <select id={field('ambulance')} className="ui-select" value={form.ambulanceId} onChange={e => set('ambulanceId')(e.target.value)}>
                        <option value="">Not linked — gets no trips</option>
                        {ambulances.map(a => <option key={a.id} value={a.id}>{a.vehicleNumber}</option>)}
                      </select>
                    </div>
                    <div className="ui-field">
                      <label className="ui-label" htmlFor={field('licence')}>Driving licence</label>
                      <input id={field('licence')} className="ui-input" value={form.licenseNumber} onChange={e => set('licenseNumber')(e.target.value)} maxLength={50} />
                    </div>
                  </>
                )}
              </div>

              <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="lock" size={16} />Sign-in and sessions</h3>
              <dl className="ui-dl" style={{ marginBottom: 14 }}>
                <div className="ui-dl__item"><dt>Last sign-in</dt><dd className={user.lastLoginAt ? '' : 'is-empty'}>{user.lastLoginAt ? formatIstFull(user.lastLoginAt) : 'Never'}</dd></div>
                <div className="ui-dl__item"><dt>Sessions last ended</dt><dd className={user.sessionsRevokedAt ? '' : 'is-empty'}>{user.sessionsRevokedAt ? formatIstFull(user.sessionsRevokedAt) : 'Never'}</dd></div>
              </dl>
              <div className="ui-form-grid">
                <div className="ui-field">
                  <label className="ui-label" htmlFor={field('password')}>New password</label>
                  <div className="ui-row">
                    <input
                      id={field('password')}
                      className="ui-input"
                      style={{ flex: 1, minWidth: 0 }}
                      type="text"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                    />
                    <button type="button" className="ui-btn ui-btn--secondary" onClick={resetPassword} disabled={password.length < 8 || busy !== null}>
                      {busy === 'password' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="lock" size={15} />}
                      Reset
                    </button>
                  </div>
                  <div className="ui-help">Also signs the account out everywhere.</div>
                </div>
                <div className="ui-field">
                  <span className="ui-label">Sessions</span>
                  {confirmSignOut ? (
                    <div className="ui-row">
                      <button type="button" className="ui-btn ui-btn--danger" onClick={signOut} disabled={busy !== null}>
                        {busy === 'signout' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="logOut" size={15} />}
                        Yes, sign out everywhere
                      </button>
                      <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setConfirmSignOut(false)}>Keep</button>
                    </div>
                  ) : (
                    <button type="button" className="ui-btn ui-btn--danger-soft" onClick={() => setConfirmSignOut(true)} disabled={busy !== null}>
                      <Icon name="logOut" size={15} />
                      Sign out everywhere
                    </button>
                  )}
                  <div className="ui-help">Ends every session on every device at once.</div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="ui-modal__footer">
          <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose} disabled={busy !== null}>Close</button>
          <button type="submit" className="ui-btn ui-btn--primary" disabled={!user || busy !== null}>
            {busy === 'save' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="save" size={16} />}
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
