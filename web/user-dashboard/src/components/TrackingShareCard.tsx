import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { formatIstTime } from '../utils/datetime';

/**
 * Sharing the case's tracking link by hand, from inside the live tracking view.
 *
 * Emergency contacts are texted this link automatically; this is for everyone
 * else the patient wants to let in — a colleague, a neighbour, a relative who
 * is not on the list. It also shows who the system already told, so the patient
 * knows what has been taken care of without asking anyone.
 */

const C = {
  ink: '#172b4d',
  sub: '#6b778c',
  muted: '#97a0af',
  line: '#e0e0e0',
  blue: '#0066cc',
  green: '#00875a',
  amber: '#ff8b00',
};

interface NotifiedContact {
  name: string;
  relation: string;
  status: string;
  sentAt: string | null;
}

interface ShareInfo {
  available: boolean;
  reason?: string;
  url?: string;
  expiresAt?: string;
  viewCount?: number;
  lastViewedAt?: string | null;
  notifiedContacts?: NotifiedContact[];
}

interface TrackingShareCardProps {
  apiBaseUrl: string;
  token: string;
  bookingId: string;
}

const TrackingShareCard: React.FC<TrackingShareCardProps> = ({ apiBaseUrl, token, bookingId }) => {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get<ShareInfo>(`${apiBaseUrl}/tracking/bookings/${bookingId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInfo(res.data);
    } catch (err) {
      console.error('Failed to load tracking link:', err);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, bookingId, token]);

  useEffect(() => { load(); }, [load]);

  /**
   * Copy the link, and only the link.
   *
   * This used to hand off to navigator.share first. On a phone that is the
   * fastest route into WhatsApp, but navigator.share also exists on desktop —
   * where the share sheet's own "copy" puts the title, the message and the URL
   * on the clipboard as one string. Pasting that into the address bar produces
   * a mangled address and a link that looks broken. The URL is now shown on
   * screen as well, so what gets shared is never in doubt.
   */
  const copyLink = async () => {
    if (!info?.url) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success('Tracking link copied.');
    } catch {
      toast.error('Could not copy automatically — select the link above and copy it.');
    }
  };

  /** The phone share sheet, as a deliberate choice rather than a silent default. */
  const shareViaSheet = async () => {
    if (!info?.url) return;
    try {
      await navigator.share({ title: 'Ambulance tracking', text: 'Follow my ambulance live.', url: info.url });
    } catch {
      // Cancelled, or the sheet is unavailable — nothing to report.
    }
  };

  if (loading || !info) return null;

  if (!info.available) {
    // Before an ambulance is assigned there is nothing to follow yet.
    return null;
  }

  const alerted = (info.notifiedContacts ?? []).filter(contact => contact.status === 'SENT');
  const failed = (info.notifiedContacts ?? []).filter(contact => contact.status === 'FAILED');

  return (
    <div style={{ background: 'white', border: `1px solid ${C.line}`, borderRadius: '10px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '220px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: C.ink }}>🔗 Share live tracking</div>
          <div style={{ fontSize: '12px', color: C.sub, marginTop: '3px', lineHeight: 1.5 }}>
            Anyone with this link can watch the ambulance — no login, no app. It shows no personal or medical
            details, and stops working when the case ends.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={copyLink}
            style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: copied ? C.green : C.blue, color: 'white', fontWeight: 600, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              onClick={shareViaSheet}
              title="Open your device's share sheet"
              style={{ padding: '9px 14px', borderRadius: '8px', border: `1px solid ${C.line}`, background: 'white', color: C.ink, fontWeight: 600, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Share…
            </button>
          )}
        </div>
      </div>

      {/* The link itself, visible and selectable. A copy button alone gives no
          way to tell a good link from a mangled one when a paste goes wrong. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
        <input
          readOnly
          value={info.url ?? ''}
          onFocus={event => event.currentTarget.select()}
          onClick={event => event.currentTarget.select()}
          style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: '7px', border: `1px solid ${C.line}`, background: '#f7f8fa', color: C.ink, fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        />
        <a
          href={info.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: '8px 12px', borderRadius: '7px', border: `1px solid ${C.line}`, color: C.blue, fontSize: '12px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          Open ↗
        </a>
      </div>

      {alerted.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: `1px solid ${C.line}`, fontSize: '12px', color: C.sub, lineHeight: 1.6 }}>
          ✅ Already texted to{' '}
          {alerted.map((contact, index) => (
            <span key={`${contact.name}-${index}`} style={{ color: C.ink, fontWeight: 600 }}>
              {contact.name}
              <span style={{ fontWeight: 400, color: C.sub }}>
                {contact.relation ? ` (${contact.relation})` : ''}
                {contact.sentAt ? ` at ${formatIstTime(contact.sentAt)}` : ''}
              </span>
              {index < alerted.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      )}

      {failed.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: C.amber, lineHeight: 1.6 }}>
          ⚠️ Could not reach {failed.map(contact => contact.name).join(', ')} — share the link with them yourself.
        </div>
      )}

      {(info.viewCount ?? 0) > 0 && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: C.green }}>
          Opened {info.viewCount} {info.viewCount === 1 ? 'time' : 'times'}
          {info.lastViewedAt ? `, last at ${formatIstTime(info.lastViewedAt)}` : ''}
        </div>
      )}
    </div>
  );
};

export default TrackingShareCard;
