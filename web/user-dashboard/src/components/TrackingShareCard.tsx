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

  const share = async () => {
    if (!info?.url) return;

    const shareText = 'Follow my ambulance live — no app or login needed.';

    // The phone's own share sheet is the fastest route into WhatsApp or SMS;
    // clipboard is the fallback everywhere else (and when the user cancels).
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Ambulance tracking', text: shareText, url: info.url });
        return;
      } catch {
        // Cancelled or unsupported — fall through to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(info.url);
      toast.success('Tracking link copied — paste it to anyone who should follow along.');
    } catch {
      toast.error('Could not copy the link. Select and copy it manually.');
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
        <button
          onClick={share}
          style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: C.blue, color: 'white', fontWeight: 600, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Share link
        </button>
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
