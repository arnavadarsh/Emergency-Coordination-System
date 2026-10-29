import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { formatIstFull } from '@shared/utils/datetime';
import { Icon } from '@shared/components/ui/Icon';
import { Badge } from '@shared/components/ui/Status';
import { EmptyState, initialsOf } from '@shared/components/ui/primitives';

/**
 * Emergency contacts, editable from the patient's own Profile.
 *
 * These are the people texted a private tracking link the moment an ambulance
 * is assigned — which is the point of the feature: in an emergency the patient
 * or a bystander has no attention to spare for phone calls, so the system makes
 * them instead.
 *
 * A contact who has unsubscribed is shown as such and cannot be re-enabled from
 * here. That is deliberate: the opt-out belongs to them, not to the patient.
 */

const RELATION_PRESETS = ['Parent', 'Spouse', 'Sibling', 'Child', 'Friend', 'Relative', 'Neighbour', 'Caregiver'];

export interface EmergencyContact {
  id: string;
  name: string;
  phoneNumber: string;
  relation: string;
  notifyBySms: boolean;
  optedOut: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
}

interface EmergencyContactsSectionProps {
  apiBaseUrl: string;
  token: string;
}

interface ContactForm {
  name: string;
  phoneNumber: string;
  relation: string;
  customRelation: string;
}

const EMPTY_FORM: ContactForm = { name: '', phoneNumber: '', relation: 'Parent', customRelation: '' };

const EmergencyContactsSection: React.FC<EmergencyContactsSectionProps> = ({ apiBaseUrl, token }) => {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
  const endpoint = `${apiBaseUrl}/users/emergency-contacts`;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(endpoint, authHeaders);
      setContacts(res.data ?? []);
    } catch (err) {
      console.error('Failed to load emergency contacts:', err);
    } finally {
      setLoading(false);
    }
  }, [endpoint, token]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const startAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (contact: EmergencyContact) => {
    const isPreset = RELATION_PRESETS.includes(contact.relation);
    setForm({
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      relation: isPreset ? contact.relation : 'Other',
      customRelation: isPreset ? '' : contact.relation,
    });
    setEditingId(contact.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    const relation = (form.relation === 'Other' ? form.customRelation : form.relation).trim();
    const name = form.name.trim();
    const phoneNumber = form.phoneNumber.trim();

    if (!name || !phoneNumber || !relation) {
      toast.error('Name, phone number and relation are all needed.');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await axios.patch(`${endpoint}/${editingId}`, { name, phoneNumber, relation }, authHeaders);
        toast.success(`${name} updated.`);
      } else {
        await axios.post(endpoint, { name, phoneNumber, relation }, authHeaders);
        toast.success(`${name} will be texted the tracking link if you need an ambulance.`);
      }
      await load();
      resetForm();
    } catch (err: any) {
      // The API explains what is wrong (bad number, duplicate, limit reached) —
      // pass that through rather than replacing it with something vaguer.
      const message = err?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message || 'Could not save this contact.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAlerts = async (contact: EmergencyContact) => {
    try {
      await axios.patch(`${endpoint}/${contact.id}`, { notifyBySms: !contact.notifyBySms }, authHeaders);
      await load();
    } catch (err) {
      console.error('Failed to update contact:', err);
      toast.error('Could not update this contact.');
    }
  };

  const handleDelete = (contact: EmergencyContact) => {
    toast((t: { id: string }) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span>Remove {contact.name}?</span>
        <button
          onClick={async () => {
            toast.dismiss(t.id);
            try {
              await axios.delete(`${endpoint}/${contact.id}`, authHeaders);
              await load();
              toast.success(`${contact.name} removed.`);
            } catch (err) {
              console.error('Failed to remove contact:', err);
              toast.error('Could not remove this contact.');
            }
          }}
          className="ui-btn ui-btn--danger ui-btn--sm"
        >
          Remove
        </button>
        <button
          onClick={() => toast.dismiss(t.id)}
          className="ui-btn ui-btn--secondary ui-btn--sm"
        >
          Keep
        </button>
      </span>
    ), { duration: 8000 });
  };

  const activeCount = contacts.filter(contact => contact.notifyBySms && !contact.optedOut).length;

  return (
    <section className="ui-card ui-enter" aria-labelledby="contacts-title">
      <div className="ui-card__header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 id="contacts-title" className="ui-card__title"><Icon name="users" size={17} />Emergency Contacts</h3>
          <p className="ui-card__subtitle" style={{ maxWidth: 620, lineHeight: 1.5 }}>
            The moment an ambulance is assigned to you, everyone here gets a text with a private link to
            follow it live — so nobody at the scene has to stop and make phone calls.
          </p>
        </div>
        {!showForm && (
          <button type="button" onClick={startAdd} className="ui-btn ui-btn--secondary">
            <Icon name="plus" size={15} />
            Add Contact
          </button>
        )}
      </div>

      <div className="ui-card__body ui-stack">
        {showForm && (
          <div className="usr-contact-form ui-enter">
            <div className="ui-form-grid">
              <div className="ui-field">
                <label className="ui-label" htmlFor="ec-name">Name</label>
                <input
                  id="ec-name"
                  className="ui-input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Meera Verma"
                  maxLength={100}
                />
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="ec-phone">Phone Number</label>
                <input
                  id="ec-phone"
                  className="ui-input"
                  value={form.phoneNumber}
                  onChange={e => setForm({ ...form, phoneNumber: e.target.value })}
                  placeholder="e.g. 98765 43210"
                  inputMode="tel"
                  type="tel"
                  maxLength={20}
                />
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="ec-relation">Relation</label>
                <select
                  id="ec-relation"
                  className="ui-select"
                  value={form.relation}
                  onChange={e => setForm({ ...form, relation: e.target.value })}
                >
                  {RELATION_PRESETS.map(relation => (
                    <option key={relation} value={relation}>{relation}</option>
                  ))}
                  <option value="Other">Other…</option>
                </select>
              </div>
              {form.relation === 'Other' && (
                <div className="ui-field">
                  <label className="ui-label" htmlFor="ec-custom">Relation (your words)</label>
                  <input
                    id="ec-custom"
                    className="ui-input"
                    value={form.customRelation}
                    onChange={e => setForm({ ...form, customRelation: e.target.value })}
                    placeholder="e.g. Flatmate"
                    maxLength={40}
                  />
                </div>
              )}
            </div>

            <div className="ui-row" style={{ marginTop: 16 }}>
              <button type="button" onClick={handleSave} disabled={saving} className="ui-btn ui-btn--success">
                {saving ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="save" size={16} />}
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Contact'}
              </button>
              <button type="button" onClick={resetForm} disabled={saving} className="ui-btn ui-btn--secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'grid', gap: 10 }} aria-busy="true" aria-label="Loading contacts">
            {[0, 1].map(i => <span key={i} className="ui-skeleton" style={{ height: 64 }} />)}
          </div>
        ) : contacts.length === 0 ? (
          <EmptyState icon="users" title="No emergency contacts yet" dashed>
            Add the people who should know when an ambulance is on its way to you.
          </EmptyState>
        ) : (
          <div className="usr-contacts">
            {contacts.map(contact => {
              const willBeAlerted = contact.notifyBySms && !contact.optedOut;
              return (
                <div key={contact.id} className={`usr-contact${willBeAlerted ? '' : ' is-muted'}`}>
                  <span className="ui-avatar">{initialsOf(contact.name)}</span>
                  <div className="usr-contact__info">
                    <div className="usr-contact__name">
                      {contact.name}
                      <Badge tone="neutral">{contact.relation}</Badge>
                    </div>
                    <div className="usr-contact__phone ui-num">{contact.phoneNumber}</div>
                    {contact.optedOut ? (
                      <div className="usr-contact__note is-danger">
                        <Icon name="ban" size={13} />
                        Unsubscribed — they chose to stop receiving these messages
                      </div>
                    ) : contact.lastNotifiedAt ? (
                      <div className="usr-contact__note is-success">
                        <Icon name="checkCheck" size={13} />
                        Last alerted {formatIstFull(contact.lastNotifiedAt)}
                      </div>
                    ) : null}
                  </div>

                  <div className="usr-contact__actions">
                    {!contact.optedOut && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={contact.notifyBySms}
                        onClick={() => toggleAlerts(contact)}
                        title={contact.notifyBySms ? 'Stop alerting this contact' : 'Alert this contact again'}
                        className={`ui-btn ui-btn--sm ${contact.notifyBySms ? 'ui-btn--soft' : 'ui-btn--secondary'}`}
                      >
                        <Icon name={contact.notifyBySms ? 'bell' : 'circleDot'} size={14} />
                        {contact.notifyBySms ? 'Alerts on' : 'Alerts off'}
                      </button>
                    )}
                    <button type="button" onClick={() => startEdit(contact)} className="ui-btn ui-btn--ghost ui-btn--sm">
                      <Icon name="pencil" size={14} />
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDelete(contact)} className="ui-btn ui-btn--danger-soft ui-btn--sm">
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {contacts.length > 0 && (
          <p className="ui-help" style={{ lineHeight: 1.6 }}>
            {activeCount === 0
              ? 'Nobody is currently set to be alerted.'
              : `${activeCount} ${activeCount === 1 ? 'person' : 'people'} will be texted a tracking link when an ambulance is assigned to you.`}
            {' '}The link shows the ambulance, its ETA and the hospital — never your name or medical details — and stops working when the case ends.
          </p>
        )}
      </div>
    </section>
  );
};

export default EmergencyContactsSection;
