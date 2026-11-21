import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@shared/components/ui/Icon';
import { Badge } from '@shared/components/ui/Status';
import { EmptyState } from '@shared/components/ui/primitives';
import { adminApi, errorText, type AuditItem } from '../../services/adminApi';
import { formatIstDateTime, formatIstFull } from '@shared/utils/datetime';

const PAGE_SIZE = 25;

const ACTIONS = [
  'ACCOUNT_CREATED', 'USER_UPDATED', 'PASSWORD_RESET', 'SESSIONS_REVOKED',
  'MANUAL_DISPATCH', 'AMBULANCE_REASSIGNED', 'DESTINATION_CHANGED', 'DISPATCH_STATUS_OVERRIDDEN',
  'BOOKING_CANCELLED', 'TRACKING_LINK_REVOKED', 'CASE_CHAT_VIEWED',
  'HOSPITAL_CREATED', 'HOSPITAL_UPDATED', 'HOSPITAL_DELETED', 'CAPABILITY_UPDATED', 'CAPABILITY_REMOVED',
  'AMBULANCE_CREATED', 'AMBULANCE_UPDATED', 'AMBULANCE_DELETED',
  'SETTINGS_UPDATED', 'ANNOUNCEMENT_SENT', 'TEST_SMS_SENT', 'DISPATCH_PASS_RUN',
];
const ENTITIES = ['User', 'Booking', 'Dispatch', 'Hospital', 'Ambulance', 'System'];

/** Who did what, when — filterable and paged, newest first. */
export default function AuditPanel() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.audit({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, action: action || undefined, entityType: entityType || undefined });
      setItems(result.items);
      setTotal(result.total);
      setError('');
    } catch (err) {
      setError(errorText(err, 'Could not load the audit log.'));
    } finally {
      setLoading(false);
    }
  }, [page, action, entityType]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const details = (item: AuditItem) => {
    const parts = { before: item.beforeState, after: item.afterState, changes: item.changes };
    const shown = Object.fromEntries(Object.entries(parts).filter(([, v]) => v != null));
    return Object.keys(shown).length ? JSON.stringify(shown, null, 2) : null;
  };

  return (
    <section className="ui-enter">
      <div className="ui-page-header">
        <div>
          <p className="ui-page-header__text">A record of who changed what, and when. Every admin control writes here, including reading a case chat.</p>
        </div>
        <Badge tone="info" large>{total} entries</Badge>
      </div>

      <div className="ui-toolbar">
        <select className="ui-select adm-filter" aria-label="Filter by action" value={action} onChange={e => { setAction(e.target.value); setPage(0); }}>
          <option value="">All actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>)}
        </select>
        <select className="ui-select adm-filter" aria-label="Filter by subject" value={entityType} onChange={e => { setEntityType(e.target.value); setPage(0); }}>
          <option value="">Everything</option>
          {ENTITIES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(action || entityType) && (
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => { setAction(''); setEntityType(''); setPage(0); }}>
            <Icon name="x" size={15} />
            Clear filters
          </button>
        )}
        <button type="button" className="ui-btn ui-btn--secondary" onClick={load}>
          <Icon name="refresh" size={15} />
          Refresh
        </button>
      </div>

      {error && <div className="ui-alert tone-danger" role="alert" style={{ marginBottom: 14 }}><Icon name="alertCircle" size={17} /><div>{error}</div></div>}

      {!loading && items.length === 0 ? (
        <div className="ui-card"><EmptyState icon="scrollText" title="Nothing recorded">No entries match these filters.</EmptyState></div>
      ) : (
        <div className="ui-table-wrap">
          <table className="ui-table ui-table--stack">
            <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Subject</th><th scope="col">By</th><th scope="col"><span className="ui-sr-only">Details</span></th></tr></thead>
            <tbody>
              {items.map(item => {
                const detail = details(item);
                return (
                  <tr key={item.id}>
                    <td data-label="Time" className="ui-table__secondary" style={{ whiteSpace: 'nowrap' }} title={formatIstFull(item.createdAt)}>{formatIstDateTime(item.createdAt)}</td>
                    <td data-label="Action"><Badge tone="brand">{item.action.replace(/_/g, ' ')}</Badge></td>
                    <td data-label="Subject">{item.entityType} {item.entityType !== 'System' && <code>{String(item.entityId).slice(0, 8)}</code>}</td>
                    <td data-label="By" className="ui-table__secondary">{item.actorEmail ?? (item.actorId ? <code>{item.actorId.slice(0, 8)}</code> : 'System')}</td>
                    <td data-label="Details" style={{ textAlign: 'right' }}>
                      {detail && (
                        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>
                          <Icon name={open === item.id ? 'chevronDown' : 'chevronRight'} size={14} />
                          Details
                        </button>
                      )}
                      {open === item.id && detail && (
                        <pre style={{ textAlign: 'left', whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8, maxWidth: 520 }}>{detail}</pre>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <nav className="ui-row" style={{ justifyContent: 'flex-end', marginTop: 12 }} aria-label="Audit log pages">
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>
          <Icon name="chevronLeft" size={14} />Newer
        </button>
        <span className="ui-table__secondary">Page {page + 1} of {pages}</span>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setPage(p => p + 1)} disabled={page + 1 >= pages || loading}>
          Older<Icon name="chevronRight" size={14} />
        </button>
      </nav>
    </section>
  );
}
