import { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../config/api';
import { Icon, type IconName } from '@shared/components/ui/Icon';


interface NotificationPreferences {
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
}

interface NotificationPreferencesSectionProps {
  token: string;
}

export function NotificationPreferencesSection({ token }: NotificationPreferencesSectionProps) {
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    emailNotifications: true,
    smsNotifications: true,
    pushNotifications: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/users/notifications/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPreferences(response.data);
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API_BASE_URL}/users/notifications/preferences`, preferences, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const CHANNELS: { key: keyof NotificationPreferences; label: string; hint: string; icon: IconName }[] = [
    { key: 'emailNotifications', label: 'Email Notifications', hint: 'Receive booking updates via email', icon: 'mail' },
    { key: 'smsNotifications', label: 'SMS Notifications', hint: 'Get text messages for critical updates', icon: 'messageCircle' },
    { key: 'pushNotifications', label: 'Push Notifications', hint: 'Receive instant alerts on your device', icon: 'bell' },
  ];

  if (loading) {
    return (
      <section className="ui-card" aria-busy="true">
        <div className="ui-card__body" style={{ display: 'grid', gap: 12 }}>
          <span className="ui-skeleton" style={{ height: 20, width: '40%' }} />
          {[0, 1, 2].map(i => <span key={i} className="ui-skeleton" style={{ height: 44 }} />)}
        </div>
      </section>
    );
  }

  return (
    <section className="ui-card ui-enter" aria-labelledby="notif-title">
      <div className="ui-card__header">
        <div>
          <h3 id="notif-title" className="ui-card__title"><Icon name="bell" size={17} />Notification Preferences</h3>
          <div className="ui-card__subtitle">Choose how you want to receive alerts and updates</div>
        </div>
        {saved && (
          <span className="ui-badge tone-success ui-fade-in" role="status">
            <Icon name="check" size={13} />
            Saved
          </span>
        )}
      </div>

      <div className="ui-list">
        {CHANNELS.map(channel => {
          const on = preferences[channel.key];
          const id = `notif-${channel.key}`;
          return (
            <div key={channel.key} className="ui-list__row usr-pref">
              <span className="ui-icon-tile ui-icon-tile--sm tone-neutral"><Icon name={channel.icon} size={17} /></span>
              <div className="usr-pref__text">
                <div id={id} className="usr-pref__label">{channel.label}</div>
                <div className="ui-help">{channel.hint}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={id}
                className="ui-switch"
                onClick={() => setPreferences({ ...preferences, [channel.key]: !on })}
              />
            </div>
          );
        })}
      </div>

      <div className="ui-card__footer" style={{ justifyContent: 'flex-end' }}>
        <button type="button" onClick={handleSave} disabled={saving} className="ui-btn ui-btn--primary">
          {saving ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="save" size={16} />}
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </section>
  );
}
