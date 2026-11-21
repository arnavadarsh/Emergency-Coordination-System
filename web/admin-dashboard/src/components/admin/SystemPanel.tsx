import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { Badge, type Tone } from '@shared/components/ui/Status';
import { adminApi, errorText, type RuntimeSettings } from '../../services/adminApi';
import { formatIstFull, formatTimeAgo } from '@shared/utils/datetime';

interface SystemPanelProps {
  notify: (notice: { tone: Tone; title?: string; text: string }) => void;
}

const SWITCHES: { key: keyof RuntimeSettings; title: string; on: string; off: string }[] = [
  {
    key: 'autoDispatchEnabled',
    title: 'Automatic dispatch',
    on: 'New bookings get the nearest free ambulance at once, and waiting ones the moment a unit frees.',
    off: 'Nothing is sent automatically. Every booking waits in the queue under Bookings for an admin to dispatch.',
  },
  {
    key: 'patientSignupEnabled',
    title: 'Patient sign-up',
    on: 'Anyone can create a patient account from the sign-in page.',
    off: 'Sign-up is closed. Admins can still create accounts from Users.',
  },
  {
    key: 'contactSmsEnabled',
    title: 'Texts to emergency contacts',
    on: "A patient's emergency contacts are texted the tracking link when an ambulance is assigned.",
    off: 'Paused — no texts are sent (for drills, or while a gateway misbehaves).',
  },
];

/**
 * System controls: the runtime switches, a live picture of the system's
 * health, and tools that act on everyone at once.
 */
export default function SystemPanel({ notify }: SystemPanelProps) {
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [changes, setChanges] = useState<Record<string, { updatedAt: string } | null>>({});
  const [status, setStatus] = useState<any>(null);
  const [llm, setLlm] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [maxAge, setMaxAge] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('ALL');
  const [tone, setTone] = useState('info');
  const [phone, setPhone] = useState('');
  const [smsResult, setSmsResult] = useState<any>(null);

  const loadStatus = useCallback(async () => {
    try { setStatus(await adminApi.status()); } catch { /* the tiles keep their last values */ }
  }, []);

  useEffect(() => {
    adminApi.settings().then(s => {
      setSettings(s.values);
      setChanges(s.changes as any);
      setMaxAge(String(s.values.dispatchRetryMaxAgeMinutes));
    }).catch(err => notify({ tone: 'danger', text: errorText(err, 'Could not load settings.') }));
    adminApi.llmUsage().then(setLlm).catch(() => setLlm(null));
    loadStatus();
    const timer = setInterval(loadStatus, 15000);
    return () => clearInterval(timer);
  }, [loadStatus]);

  const saveSetting = async (patch: Partial<RuntimeSettings>, label: string) => {
    setBusy(Object.keys(patch)[0]);
    try {
      const result = await adminApi.updateSettings(patch);
      setSettings(result.values);
      setChanges(result.changes);
      notify({ tone: 'success', text: label });
      loadStatus();
    } catch (err) {
      notify({ tone: 'danger', title: 'Not saved', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const sendBroadcast = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('broadcast');
    try {
      await adminApi.broadcast(message.trim(), audience, tone);
      notify({ tone: 'success', text: `Announcement sent to ${audience === 'ALL' ? 'every dashboard' : `${audience.toLowerCase()} dashboards`}.` });
      setMessage('');
    } catch (err) {
      notify({ tone: 'danger', title: 'Not sent', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const sendTestSms = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('sms');
    setSmsResult(null);
    try {
      setSmsResult(await adminApi.testSms(phone.trim()));
    } catch (err) {
      notify({ tone: 'danger', title: 'Test failed', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const runDispatch = async () => {
    setBusy('dispatch');
    try {
      const result = await adminApi.runDispatch();
      const run = result.lastRun;
      notify({ tone: 'success', text: run ? `${run.dispatched} of ${run.waiting} waiting booking(s) dispatched.` : 'Nothing was waiting.' });
      loadStatus();
    } catch (err) {
      notify({ tone: 'danger', text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const tile = (icon: IconName, title: string, tone: Tone, value: string, detail?: string) => (
    <div className="ui-dl__item">
      <dt><Icon name={icon} size={13} /> {title}</dt>
      <dd><Badge tone={tone} dot>{value}</Badge></dd>
      {detail && <div className="ui-help" style={{ marginTop: 4 }}>{detail}</div>}
    </div>
  );

  return (
    <section className="ui-enter">
      <div className="ui-page-header">
        <div>
          <p className="ui-page-header__text">Switches that change how the whole system behaves, its live health, and tools that reach everyone at once. Every change here is audited.</p>
        </div>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={loadStatus}>
          <Icon name="refresh" size={15} />
          Refresh
        </button>
      </div>

      <div className="ui-card" style={{ marginBottom: 20 }}>
        <div className="ui-card__header"><h2 className="ui-card__title"><Icon name="sliders" size={17} />Controls</h2></div>
        <div className="ui-card__body">
          {!settings ? <p className="ui-help">Loading…</p> : (
            <div className="ui-stack" style={{ display: 'grid', gap: 16 }}>
              {SWITCHES.map(s => (
                <div key={s.key} className="ui-row" style={{ alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div id={field(s.key)} style={{ fontWeight: 650 }}>{s.title}</div>
                    <div className="ui-help">{settings[s.key] ? s.on : s.off}</div>
                    {changes[s.key] && <div className="ui-help">Changed {formatTimeAgo(changes[s.key]!.updatedAt)}</div>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    className="ui-switch"
                    aria-checked={Boolean(settings[s.key])}
                    aria-labelledby={field(s.key)}
                    disabled={busy !== null}
                    onClick={() => saveSetting({ [s.key]: !settings[s.key] }, `${s.title} switched ${settings[s.key] ? 'off' : 'on'}.`)}
                  />
                </div>
              ))}
              <div className="ui-row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <div className="ui-field" style={{ margin: 0 }}>
                  <label className="ui-label" htmlFor={field('maxage')}>Stop auto-retrying a booking after (minutes)</label>
                  <div className="ui-row">
                    <input id={field('maxage')} className="ui-input" style={{ width: 110 }} type="number" min={5} max={1440} value={maxAge} onChange={e => setMaxAge(e.target.value)} />
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary"
                      disabled={busy !== null || Number(maxAge) === settings.dispatchRetryMaxAgeMinutes}
                      onClick={() => saveSetting({ dispatchRetryMaxAgeMinutes: Number(maxAge) }, 'Retry window saved.')}
                    >
                      <Icon name="save" size={15} />
                      Save
                    </button>
                  </div>
                  <div className="ui-help">Older waiting bookings stay in the queue for an admin to decide.</div>
                </div>
                <button type="button" className="ui-btn ui-btn--primary" onClick={runDispatch} disabled={busy !== null}>
                  {busy === 'dispatch' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="siren" size={16} />}
                  Dispatch waiting bookings now
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ui-card" style={{ marginBottom: 20 }}>
        <div className="ui-card__header">
          <h2 className="ui-card__title"><Icon name="activity" size={17} />System health</h2>
          {status && <span className="ui-card__subtitle">Up {Math.round(status.uptimeSeconds / 60)} min · refreshes every 15 s</span>}
        </div>
        <div className="ui-card__body">
          {!status ? <p className="ui-help">Loading…</p> : (
            <dl className="ui-dl">
              {tile('gauge', 'Database', status.database.ok ? (status.database.latencyMs > 150 ? 'warning' : 'success') : 'danger',
                status.database.ok ? `${status.database.latencyMs} ms` : 'Unreachable',
                status.database.lastHeartbeat ? `Keep-alive ${formatTimeAgo(status.database.lastHeartbeat)}` : 'No keep-alive yet')}
              {tile('message', 'SMS', status.sms.liveDelivery ? 'success' : 'warning', status.sms.liveDelivery ? `Live (${status.sms.provider})` : 'Log only',
                status.sms.liveDelivery ? undefined : 'Add Twilio keys for real delivery')}
              {tile('camera', 'Chat images', status.storage.configured ? 'success' : 'warning', status.storage.configured ? 'Enabled' : 'Off',
                status.storage.configured ? status.storage.bucket : 'Add the Supabase service role key')}
              {tile('radio', 'Live connections', 'info', String(status.connections.total ?? 0),
                ['ADMIN', 'HOSPITAL', 'DRIVER', 'USER'].map(r => `${r.toLowerCase()} ${status.connections[r] ?? 0}`).join(' · '))}
              {tile('siren', 'Dispatch', status.dispatch.autoDispatchEnabled ? 'success' : 'warning', status.dispatch.autoDispatchEnabled ? 'Automatic' : 'Manual only',
                `${status.dispatch.waitingBookings} waiting · ${status.dispatch.activeTrips} on trips${status.dispatch.lastRun ? ` · last pass ${formatTimeAgo(status.dispatch.lastRun.at)}` : ''}`)}
              {tile('ambulance', 'Fleet', (status.fleet.AVAILABLE ?? 0) > 0 ? 'success' : 'danger', `${status.fleet.AVAILABLE ?? 0} available`,
                Object.entries(status.fleet).map(([k, v]) => `${String(k).toLowerCase()} ${v}`).join(' · '))}
              {tile('sparkles', 'AI triage', status.integrations.gemini ? 'success' : 'neutral', status.integrations.gemini ? 'Configured' : 'Offline engine')}
              {tile('map', 'Live traffic ETAs', status.integrations.googleMaps ? 'success' : 'neutral', status.integrations.googleMaps ? 'Google Maps' : 'Distance estimate')}
            </dl>
          )}
        </div>
      </div>

      <div className="adm-charts" style={{ marginBottom: 20 }}>
        <form className="ui-card" onSubmit={sendBroadcast}>
          <div className="ui-card__header"><h2 className="ui-card__title"><Icon name="bell" size={17} />Announcement</h2></div>
          <div className="ui-card__body">
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('msg')}>Message</label>
              <textarea id={field('msg')} className="ui-textarea" rows={3} maxLength={500} value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. Ambulance drill at 15:00 — no real patients." required />
            </div>
            <div className="ui-form-grid">
              <div className="ui-field">
                <label className="ui-label" htmlFor={field('aud')}>Show on</label>
                <select id={field('aud')} className="ui-select" value={audience} onChange={e => setAudience(e.target.value)}>
                  <option value="ALL">Every dashboard</option>
                  <option value="USER">Patients</option>
                  <option value="DRIVER">Drivers</option>
                  <option value="HOSPITAL">Hospitals</option>
                  <option value="ADMIN">Admins</option>
                </select>
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor={field('tone')}>Style</label>
                <select id={field('tone')} className="ui-select" value={tone} onChange={e => setTone(e.target.value)}>
                  <option value="info">Information</option>
                  <option value="success">Good news</option>
                  <option value="warning">Warning</option>
                  <option value="danger">Urgent</option>
                </select>
              </div>
            </div>
            <p className="ui-help">Appears instantly on dashboards that are open now; it is not stored.</p>
          </div>
          <div className="ui-card__footer">
            <button type="submit" className="ui-btn ui-btn--primary" disabled={busy !== null || !message.trim()}>
              {busy === 'broadcast' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="send" size={15} />}
              Send announcement
            </button>
          </div>
        </form>

        <form className="ui-card" onSubmit={sendTestSms}>
          <div className="ui-card__header"><h2 className="ui-card__title"><Icon name="phone" size={17} />Test SMS</h2></div>
          <div className="ui-card__body">
            <div className="ui-field">
              <label className="ui-label" htmlFor={field('phone')}>Send a test text to</label>
              <input id={field('phone')} className="ui-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" required minLength={6} maxLength={20} />
            </div>
            {smsResult && (
              <div className={`ui-alert ${smsResult.delivered ? 'tone-success' : 'tone-warning'}`} role="status">
                <Icon name={smsResult.delivered ? 'checkCircle' : 'alertTriangle'} size={17} />
                <div>
                  {smsResult.delivered ? `Sent to ${smsResult.to} via ${smsResult.provider}.` : smsResult.error ? `${smsResult.provider} refused it: ${smsResult.error}` : smsResult.note}
                </div>
              </div>
            )}
          </div>
          <div className="ui-card__footer">
            <button type="submit" className="ui-btn ui-btn--secondary" disabled={busy !== null || phone.trim().length < 6}>
              {busy === 'sms' ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="send" size={15} />}
              Send test
            </button>
          </div>
        </form>
      </div>

      {llm && (
        <div className="ui-card">
          <div className="ui-card__header">
            <h2 className="ui-card__title"><Icon name="sparkles" size={17} />AI triage usage</h2>
            <span className="ui-card__subtitle">{llm.configured ? llm.model : 'Not configured — triage uses the offline engine'}</span>
          </div>
          <div className="ui-card__body">
            <dl className="ui-dl">
              <div className="ui-dl__item"><dt>Last 24 h requests</dt><dd>{llm.window.last24hRequests} / {llm.limits.dailyRequests}</dd></div>
              <div className="ui-dl__item"><dt>Last 24 h tokens</dt><dd>{llm.window.last24hTokens} / {llm.limits.dailyTokens}</dd></div>
              <div className="ui-dl__item"><dt>Refused</dt><dd>{llm.totals.refused ?? 0}</dd></div>
              <div className="ui-dl__item"><dt>Estimated cost</dt><dd className={llm.totals.estimatedCostUsd == null ? 'is-empty' : ''}>{llm.totals.estimatedCostUsd == null ? 'No price set' : `$${llm.totals.estimatedCostUsd}`}</dd></div>
              {llm.cooldownUntil && <div className="ui-dl__item ui-dl__item--wide"><dt>Paused until</dt><dd>{formatIstFull(llm.cooldownUntil)}</dd></div>}
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}
