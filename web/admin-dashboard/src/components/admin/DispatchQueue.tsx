import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@shared/components/ui/Icon';
import { Badge, SeverityBadge, type Tone } from '@shared/components/ui/Status';
import { adminApi, errorText, type QueueItem } from '../../services/adminApi';
import { formatIstDateTime } from '@shared/utils/datetime';

interface DispatchQueueProps {
  /** Bumped by the dashboard on live events, so the queue refetches. */
  refreshKey: number;
  onManage: (bookingId: string) => void;
  notify: (notice: { tone: Tone; title?: string; text: string }) => void;
  onChanged: () => void;
}

/**
 * Bookings nobody has been sent to yet, most urgent first. With automatic
 * dispatch on this is usually empty; when it is off — or a booking has waited
 * past the retry window — this is where an admin decides.
 */
export default function DispatchQueue({ refreshKey, onManage, notify, onChanged }: DispatchQueueProps) {
  const [data, setData] = useState<Awaited<ReturnType<typeof adminApi.queue>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await adminApi.queue()); } catch { /* keep the last list */ }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const dispatchNearest = async (item: QueueItem) => {
    setBusy(item.id);
    try {
      await adminApi.dispatch(item.id);
      notify({ tone: 'success', text: `Nearest ambulance sent to ${item.patientName}.` });
      onChanged();
      load();
    } catch (err) {
      notify({ tone: 'danger', title: 'Not dispatched', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  if (!data) return null;
  const { items } = data;

  return (
    <div className={`ui-card ${items.length ? 'ui-accent ui-accent--warning' : ''}`} style={{ marginBottom: 20 }}>
      <div className="ui-card__header">
        <h2 className="ui-card__title"><Icon name="hourglass" size={17} />Waiting for an ambulance</h2>
        <div className="ui-row">
          <Badge tone={data.autoDispatchEnabled ? 'success' : 'warning'} dot>{data.autoDispatchEnabled ? 'Automatic dispatch on' : 'Manual dispatch only'}</Badge>
          <Badge tone={data.availableAmbulances > 0 ? 'info' : 'danger'}>{data.availableAmbulances} unit(s) free</Badge>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="ui-card__body"><p className="ui-help">No booking is waiting. Every open case has an ambulance.</p></div>
      ) : (
        <div className="ui-table-wrap" style={{ border: 'none' }}>
          <table className="ui-table ui-table--stack">
            <thead><tr><th scope="col">Patient</th><th scope="col">Severity</th><th scope="col">Pickup</th><th scope="col">Waiting</th><th scope="col"><span className="ui-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td data-label="Patient">
                    <span className="ui-table__primary">{item.patientName}</span>
                    {item.patientPhone && <div className="ui-table__secondary">{item.patientPhone}</div>}
                  </td>
                  <td data-label="Severity"><SeverityBadge severity={item.severity || 'MEDIUM'} /></td>
                  <td data-label="Pickup" className="adm-address ui-truncate" title={item.pickupAddress ?? ''}>{item.pickupAddress || 'Not given'}</td>
                  <td data-label="Waiting">
                    {item.scheduledTime && new Date(item.scheduledTime).getTime() > Date.now() ? (
                      <>
                        <Badge tone="info">Scheduled</Badge>
                        <div className="ui-table__secondary">For {formatIstDateTime(item.scheduledTime)} — sent automatically shortly before</div>
                      </>
                    ) : (
                      <Badge tone={item.needsDecision ? 'danger' : item.waitingMinutes >= 10 ? 'warning' : 'neutral'}>{item.waitingMinutes} min</Badge>
                    )}
                    {item.needsDecision && <div className="ui-table__secondary">Past the retry window — needs a decision</div>}
                  </td>
                  <td data-label="Actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="ui-btn ui-btn--emergency ui-btn--sm" onClick={() => dispatchNearest(item)} disabled={busy !== null || data.availableAmbulances === 0}>
                      {busy === item.id ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="siren" size={14} />}
                      Send nearest
                    </button>{' '}
                    <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onManage(item.id)}>
                      <Icon name="sliders" size={14} />
                      Choose…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
