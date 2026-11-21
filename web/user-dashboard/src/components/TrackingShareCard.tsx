import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { formatIstTime } from '@shared/utils/datetime';
import { Icon } from '@shared/components/ui/Icon';

/**
 * Sharing the case's tracking link by hand, from inside the live tracking view.
 *
 * Emergency contacts are texted this link automatically; this is for everyone
 * else the patient wants to let in — a colleague, a neighbour, a relative who
 * is not on the list. It also shows who the system already told, so the patient
 * knows what has been taken care of without asking anyone.
 */

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
    <section className="ui-card ui-card--flat usr-share" aria-labelledby="share-title">
      <div className="usr-share__head">
        <span className="ui-icon-tile ui-icon-tile--sm"><Icon name="share" size={17} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 id="share-title" className="usr-share__title">Share live tracking</h3>
          <p className="ui-help">
            Anyone with this link can watch the ambulance — no login, no app. It shows no personal or medical
            details, and stops working when the case ends.
          </p>
        </div>
      </div>

      {/* The link itself, visible and selectable. A copy button alone gives no
          way to tell a good link from a mangled one when a paste goes wrong. */}
      <div className="usr-share__link">
        {/* Takes a full row on a phone, so the link is readable, not four letters wide. */}
        <div className="ui-input-wrap" style={{ flex: '1 1 240px', minWidth: 0 }}>
          <Icon name="link" size={15} />
          <input
            readOnly
            className="ui-input ui-mono usr-share__url"
            value={info.url ?? ''}
            aria-label="Tracking link"
            onFocus={event => event.currentTarget.select()}
            onClick={event => event.currentTarget.select()}
          />
        </div>
        <button type="button" onClick={copyLink} className={`ui-btn ${copied ? 'ui-btn--success' : 'ui-btn--primary'}`}>
          <Icon name={copied ? 'check' : 'copy'} size={15} />
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" onClick={shareViaSheet} title="Open your device's share sheet" className="ui-btn ui-btn--secondary">
            <Icon name="share" size={15} />
            Share…
          </button>
        )}
        <a href={info.url} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--ghost" aria-label="Open tracking page in a new tab">
          <Icon name="externalLink" size={15} />
          Open
        </a>
      </div>

      {(alerted.length > 0 || failed.length > 0 || (info.viewCount ?? 0) > 0) && (
        <div className="usr-share__status">
          {alerted.length > 0 && (
            <div className="usr-share__line is-success">
              <Icon name="checkCheck" size={15} />
              <span>
                Already texted to{' '}
                {alerted.map((contact, index) => (
                  <span key={`${contact.name}-${index}`}>
                    <strong>{contact.name}</strong>
                    {contact.relation ? ` (${contact.relation})` : ''}
                    {contact.sentAt ? ` at ${formatIstTime(contact.sentAt)}` : ''}
                    {index < alerted.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </span>
            </div>
          )}

          {failed.length > 0 && (
            <div className="usr-share__line is-warning">
              <Icon name="alertTriangle" size={15} />
              <span>Could not reach {failed.map(contact => contact.name).join(', ')} — share the link with them yourself.</span>
            </div>
          )}

          {(info.viewCount ?? 0) > 0 && (
            <div className="usr-share__line">
              <Icon name="eye" size={15} />
              <span>
                Opened {info.viewCount} {info.viewCount === 1 ? 'time' : 'times'}
                {info.lastViewedAt ? `, last at ${formatIstTime(info.lastViewedAt)}` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default TrackingShareCard;
