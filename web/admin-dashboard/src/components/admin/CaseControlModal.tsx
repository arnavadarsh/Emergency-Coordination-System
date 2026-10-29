import { useCallback, useEffect, useId, useState } from 'react';
import { Modal } from '@shared/components/ui/Modal';
import { Icon } from '@shared/components/ui/Icon';
import { Badge, SeverityBadge, StatusBadge } from '@shared/components/ui/Status';
import { adminApi, errorText, type CaseControls } from '../../services/adminApi';
import { formatIstDateTime, formatIstFull } from '@shared/utils/datetime';

interface CaseControlModalProps {
  bookingId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
  onOpenReport: (bookingId: string) => void;
}

const PRE_PICKUP = ['DISPATCHED', 'ASSIGNED', 'EN_ROUTE', 'EN_ROUTE_PICKUP'];
const FINISHED = ['COMPLETED', 'CANCELLED'];
const TRIP_STATUSES: { value: string; label: string }[] = [
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'EN_ROUTE_PICKUP', label: 'On the way to the patient' },
  { value: 'AT_PICKUP', label: 'With the patient' },
  { value: 'EN_ROUTE_HOSPITAL', label: 'On the way to hospital' },
  { value: 'AT_HOSPITAL', label: 'At the hospital' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const km = (d: number | null) => (d == null ? 'no position' : `${d} km`);

/**
 * Operator control over one case: send an ambulance, swap it, change where it
 * is going, correct the trip status, cut off the family's tracking link, read
 * the patient–driver chat, or cancel. Every action is recorded in the audit log.
 */
export default function CaseControlModal({ bookingId, onClose, onChanged, onOpenReport }: CaseControlModalProps) {
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const [data, setData] = useState<CaseControls | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [ambulanceChoice, setAmbulanceChoice] = useState('');
  const [hospitalChoice, setHospitalChoice] = useState('');
  const [statusChoice, setStatusChoice] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [chat, setChat] = useState<Awaited<ReturnType<typeof adminApi.chat>> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await adminApi.controls(bookingId);
      setData(next);
      setAmbulanceChoice('');
      setHospitalChoice('');
      setStatusChoice(next.dispatch?.status ?? '');
    } catch (err) {
      setError(errorText(err, 'Could not load this case.'));
    }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const act = async (key: string, run: () => Promise<unknown>, message: string) => {
    setError('');
    setBusy(key);
    try {
      await run();
      onChanged(message);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const booking = data?.booking;
  const dispatch = data?.dispatch;
  const waiting = Boolean(booking && !dispatch && ['PENDING', 'CREATED'].includes(booking.status));
  const tripLive = Boolean(dispatch && !FINISHED.includes(dispatch.status));
  const bookingOpen = Boolean(booking && !FINISHED.includes(booking.status));

  return (
    <Modal onClose={busy ? undefined : onClose} labelledBy={field('title')} size="lg" align="top">
      <div className="ui-modal__header ui-modal__header--plain">
        <span className="ui-icon-tile tone-brand"><Icon name="sliders" size={22} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 id={field('title')} className="ui-modal__title">Case control · <code>{bookingId.slice(0, 8)}</code></h2>
          <p className="ui-modal__subtitle">
            {booking ? <>{booking.patientName} · <StatusBadge status={booking.status} variant="dot" /> · <SeverityBadge severity={booking.severity || 'MEDIUM'} /></> : 'Loading…'}
          </p>
        </div>
      </div>

      <div className="ui-modal__body">
        {error && (
          <div className="ui-alert tone-danger" role="alert" style={{ marginBottom: 14 }}>
            <Icon name="alertCircle" size={17} /><div>{error}</div>
          </div>
        )}

        {data && booking && (
          <>
            <dl className="ui-dl" style={{ marginBottom: 20 }}>
              <div className="ui-dl__item"><dt>Patient phone</dt><dd className={booking.patientPhone ? '' : 'is-empty'}>{booking.patientPhone || 'Not given'}</dd></div>
              <div className="ui-dl__item"><dt>Raised</dt><dd title={formatIstFull(booking.createdAt)}>{formatIstDateTime(booking.createdAt)}</dd></div>
              <div className="ui-dl__item ui-dl__item--wide"><dt>Pickup</dt><dd>{booking.pickupAddress || 'Not given'}</dd></div>
              <div className="ui-dl__item"><dt>Ambulance</dt><dd className={dispatch?.ambulance ? '' : 'is-empty'}>{dispatch?.ambulance?.vehicleNumber ?? 'None yet'}</dd></div>
              <div className="ui-dl__item"><dt>Hospital</dt><dd className={dispatch?.hospital ? '' : 'is-empty'}>{dispatch?.hospital?.name ?? 'None yet'}</dd></div>
              <div className="ui-dl__item"><dt>Trip</dt><dd className={dispatch ? '' : 'is-empty'}>{dispatch ? dispatch.status.replace(/_/g, ' ') : 'Not dispatched'}</dd></div>
              <div className="ui-dl__item">
                <dt>Family tracking link</dt>
                <dd className={data.tracking ? '' : 'is-empty'}>
                  {data.tracking ? (data.tracking.active ? `Live · opened ${data.tracking.viewCount}×` : `Off (${(data.tracking.closeReason ?? 'expired').toLowerCase()})`) : 'Not issued'}
                </dd>
              </div>
            </dl>

            {waiting && (
              <section style={{ marginBottom: 20 }}>
                <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="siren" size={16} />Send an ambulance</h3>
                <div className="ui-row">
                  <select className="ui-select" style={{ flex: 1, minWidth: 220 }} aria-label="Ambulance to send" value={ambulanceChoice} onChange={e => setAmbulanceChoice(e.target.value)}>
                    <option value="">Nearest available ({data.availableAmbulances.length} free)</option>
                    {data.availableAmbulances.map(a => <option key={a.id} value={a.id}>{a.vehicleNumber} · {a.vehicleType.replace(/_/g, ' ')} · {km(a.distanceKm)}</option>)}
                  </select>
                  <button
                    type="button"
                    className="ui-btn ui-btn--emergency"
                    disabled={busy !== null || data.availableAmbulances.length === 0}
                    onClick={() => act('dispatch', () => adminApi.dispatch(bookingId, ambulanceChoice || undefined), 'Ambulance dispatched.')}
                  >
                    {busy === 'dispatch' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="siren" size={16} />}
                    Dispatch
                  </button>
                </div>
                {data.availableAmbulances.length === 0 && <p className="ui-help" style={{ marginTop: 6 }}>No ambulance is free. Free one up from Ambulances, or wait — this booking is dispatched the moment one is.</p>}
              </section>
            )}

            {tripLive && dispatch && (
              <section style={{ marginBottom: 20 }}>
                <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="route" size={16} />Redirect the trip</h3>
                <div className="ui-form-grid">
                  <div className="ui-field">
                    <label className="ui-label" htmlFor={field('amb')}>Change ambulance</label>
                    <div className="ui-row">
                      <select id={field('amb')} className="ui-select" style={{ flex: 1, minWidth: 0 }} value={ambulanceChoice} onChange={e => setAmbulanceChoice(e.target.value)} disabled={!PRE_PICKUP.includes(dispatch.status)}>
                        <option value="">Choose a free unit…</option>
                        {data.availableAmbulances.map(a => <option key={a.id} value={a.id}>{a.vehicleNumber} · {km(a.distanceKm)}</option>)}
                      </select>
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary"
                        disabled={!ambulanceChoice || busy !== null || !PRE_PICKUP.includes(dispatch.status)}
                        onClick={() => act('reassign', () => adminApi.reassign(dispatch.id, ambulanceChoice), 'Ambulance changed. The previous crew has been taken off the case.')}
                      >
                        {busy === 'reassign' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="refresh" size={15} />}
                        Swap
                      </button>
                    </div>
                    <div className="ui-help">{PRE_PICKUP.includes(dispatch.status) ? 'The new crew starts the trip from the beginning.' : 'Only possible before the patient is picked up.'}</div>
                  </div>
                  <div className="ui-field">
                    <label className="ui-label" htmlFor={field('hosp')}>Change hospital</label>
                    <div className="ui-row">
                      <select id={field('hosp')} className="ui-select" style={{ flex: 1, minWidth: 0 }} value={hospitalChoice} onChange={e => setHospitalChoice(e.target.value)} disabled={dispatch.status === 'AT_HOSPITAL'}>
                        <option value="">Choose a hospital…</option>
                        {data.hospitals.filter(h => h.id !== dispatch.hospital?.id).map(h => (
                          <option key={h.id} value={h.id}>{h.name} · {h.status} · {h.availableBeds} beds · {km(h.distanceKm)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary"
                        disabled={!hospitalChoice || busy !== null}
                        onClick={() => act('reroute', () => adminApi.reroute(dispatch.id, hospitalChoice), 'Destination changed. Both hospitals and the crew have been told.')}
                      >
                        {busy === 'reroute' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="hospital" size={15} />}
                        Reroute
                      </button>
                    </div>
                  </div>
                  <div className="ui-field is-wide">
                    <label className="ui-label" htmlFor={field('status')}>Correct the trip status</label>
                    <div className="ui-row">
                      <select id={field('status')} className="ui-select" style={{ flex: 1, minWidth: 0 }} value={statusChoice} onChange={e => setStatusChoice(e.target.value)}>
                        {TRIP_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <button
                        type="button"
                        className="ui-btn ui-btn--secondary"
                        disabled={!statusChoice || statusChoice === dispatch.status || busy !== null}
                        onClick={() => act('status', () => adminApi.setTripStatus(dispatch.id, statusChoice), 'Trip status overridden.')}
                      >
                        {busy === 'status' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="pencil" size={15} />}
                        Override
                      </button>
                    </div>
                    <div className="ui-help">Skips the driver's step-by-step order. Completing or cancelling frees the ambulance.</div>
                  </div>
                </div>
              </section>
            )}

            <section style={{ marginBottom: 20 }}>
              <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="messageCircle" size={16} />Chat and tracking</h3>
              <div className="ui-row">
                <button
                  type="button"
                  className="ui-btn ui-btn--secondary"
                  disabled={busy !== null || data.chatMessages === 0}
                  onClick={async () => {
                    setError('');
                    setBusy('chat');
                    try { setChat(await adminApi.chat(bookingId)); } catch (err) { setError(errorText(err)); } finally { setBusy(null); }
                  }}
                >
                  {busy === 'chat' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="eye" size={15} />}
                  Read chat ({data.chatMessages})
                </button>
                {data.tracking?.active && (
                  <button
                    type="button"
                    className="ui-btn ui-btn--danger-soft"
                    disabled={busy !== null}
                    onClick={() => act('revoke', () => adminApi.revokeTracking(bookingId), 'Tracking link revoked. It no longer works for anyone holding it.')}
                  >
                    {busy === 'revoke' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="ban" size={15} />}
                    Revoke tracking link
                  </button>
                )}
                <button type="button" className="ui-btn ui-btn--ghost" onClick={() => onOpenReport(bookingId)}>
                  <Icon name="fileText" size={15} />
                  Case report
                </button>
              </div>
              {chat && (
                <div className="ui-card ui-card--inset" style={{ marginTop: 12, maxHeight: 260, overflowY: 'auto' }}>
                  <div className="ui-card__body ui-card__body--tight">
                    <p className="ui-help" style={{ marginBottom: 8 }}>Private conversation. Your reading it has been recorded in the audit log.</p>
                    {chat.length === 0 ? <p className="ui-help">No messages.</p> : chat.map(m => (
                      <div key={m.id} style={{ marginBottom: 8 }}>
                        <Badge tone={m.senderRole === 'driver' ? 'info' : 'neutral'}>{m.senderRole}</Badge>{' '}
                        <strong>{m.senderName}</strong>{' '}
                        <span className="ui-table__secondary">{formatIstDateTime(m.createdAt)}</span>
                        <div>{m.message || (m.attachmentUrl ? <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">Image attachment</a> : '')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {bookingOpen && (
              <section>
                <h3 className="ui-section-title" style={{ marginBottom: 10 }}><Icon name="xCircle" size={16} />Cancel</h3>
                {confirmCancel ? (
                  <div className="ui-alert tone-danger" role="alertdialog">
                    <Icon name="alertTriangle" size={17} />
                    <div style={{ flex: 1 }}>
                      Cancel this case? The ambulance is released, the crew and hospital are told, and the tracking link stops working.
                      <div className="ui-row" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="ui-btn ui-btn--danger ui-btn--sm"
                          disabled={busy !== null}
                          onClick={() => act('cancel', () => adminApi.cancel(bookingId), 'Case cancelled.').then(() => setConfirmCancel(false))}
                        >
                          {busy === 'cancel' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="xCircle" size={14} />}
                          Cancel case
                        </button>
                        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setConfirmCancel(false)}>Keep it open</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="ui-btn ui-btn--danger-soft" onClick={() => setConfirmCancel(true)} disabled={busy !== null}>
                    <Icon name="xCircle" size={15} />
                    Cancel case…
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <div className="ui-modal__footer">
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onClose} disabled={busy !== null} data-autofocus>Close</button>
      </div>
    </Modal>
  );
}
