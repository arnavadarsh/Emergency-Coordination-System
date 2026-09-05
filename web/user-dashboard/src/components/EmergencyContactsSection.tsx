import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { formatIstFull } from '../utils/datetime';

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

const C = {
  text: '#172b4d',
  sub: '#6b778c',
  muted: '#97a0af',
  border: '#e0e0e0',
  soft: '#f4f5f7',
  green: '#00875a',
  red: '#de350b',
  info: '#0066cc',
  infoSoft: '#e3f5ff',
};

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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: `1px solid ${C.border}`,
  fontSize: '14px',
  color: C.text,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: C.sub,
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

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
          style={{ padding: '4px 10px', background: C.red, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
        >
          Remove
        </button>
        <button
          onClick={() => toast.dismiss(t.id)}
          style={{ padding: '4px 10px', background: C.soft, color: C.text, border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
        >
          Keep
        </button>
      </span>
    ), { duration: 8000 });
  };

  const activeCount = contacts.filter(contact => contact.notifyBySms && !contact.optedOut).length;

  return (
    <div style={{ marginTop: '32px' }}>
      <div style={{ background: 'white', borderRadius: '12px', border: `1px solid ${C.border}`, padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', paddingBottom: '12px', marginBottom: '20px', borderBottom: `2px solid ${C.border}` }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', color: C.text }}>👨‍👩‍👧 Emergency Contacts</h3>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: C.sub, maxWidth: '620px', lineHeight: 1.5 }}>
              The moment an ambulance is assigned to you, everyone here gets a text with a private link to
              follow it live — so nobody at the scene has to stop and make phone calls.
            </p>
          </div>
          {!showForm && (
            <button
              onClick={startAdd}
              style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: C.info, color: 'white', fontWeight: 600, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              + Add Contact
            </button>
          )}
        </div>

        {showForm && (
          <div style={{ background: C.soft, borderRadius: '10px', padding: '18px', marginBottom: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input
                  style={inputStyle}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Meera Verma"
                  maxLength={100}
                />
              </div>
              <div>
                <label style={labelStyle}>Phone Number</label>
                <input
                  style={inputStyle}
                  value={form.phoneNumber}
                  onChange={e => setForm({ ...form, phoneNumber: e.target.value })}
                  placeholder="e.g. 98765 43210"
                  inputMode="tel"
                  maxLength={20}
                />
              </div>
              <div>
                <label style={labelStyle}>Relation</label>
                <select
                  style={inputStyle}
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
                <div>
                  <label style={labelStyle}>Relation (your words)</label>
                  <input
                    style={inputStyle}
                    value={form.customRelation}
                    onChange={e => setForm({ ...form, customRelation: e.target.value })}
                    placeholder="e.g. Flatmate"
                    maxLength={40}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ padding: '10px 18px', borderRadius: '8px', border: 'none', background: C.green, color: 'white', fontWeight: 600, fontSize: '14px', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Contact'}
              </button>
              <button
                onClick={resetForm}
                disabled={saving}
                style={{ padding: '10px 18px', borderRadius: '8px', border: `1px solid ${C.border}`, background: 'white', color: C.text, fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ color: C.muted, fontSize: '14px', margin: 0 }}>Loading contacts…</p>
        ) : contacts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 16px', background: C.soft, borderRadius: '10px' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📇</div>
            <p style={{ margin: '0 0 4px', fontWeight: 600, color: C.text }}>No emergency contacts yet</p>
            <p style={{ margin: 0, fontSize: '13px', color: C.sub }}>
              Add the people who should know when an ambulance is on its way to you.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {contacts.map(contact => {
              const willBeAlerted = contact.notifyBySms && !contact.optedOut;
              return (
                <div
                  key={contact.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', padding: '14px 16px', border: `1px solid ${C.border}`, borderRadius: '10px', background: willBeAlerted ? 'white' : C.soft }}
                >
                  <div style={{ minWidth: '200px' }}>
                    <div style={{ fontWeight: 600, color: C.text, fontSize: '15px' }}>
                      {contact.name}
                      <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 500, color: C.sub }}>{contact.relation}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: C.sub, marginTop: '2px' }}>{contact.phoneNumber}</div>
                    {contact.optedOut ? (
                      <div style={{ fontSize: '12px', color: C.red, marginTop: '4px' }}>
                        Unsubscribed — they chose to stop receiving these messages
                      </div>
                    ) : contact.lastNotifiedAt ? (
                      <div style={{ fontSize: '12px', color: C.green, marginTop: '4px' }}>
                        Last alerted {formatIstFull(contact.lastNotifiedAt)}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {!contact.optedOut && (
                      <button
                        onClick={() => toggleAlerts(contact)}
                        title={contact.notifyBySms ? 'Stop alerting this contact' : 'Alert this contact again'}
                        style={{ padding: '7px 12px', borderRadius: '7px', border: `1px solid ${contact.notifyBySms ? C.green : C.border}`, background: contact.notifyBySms ? '#e3fcef' : 'white', color: contact.notifyBySms ? C.green : C.sub, fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                      >
                        {contact.notifyBySms ? '✓ Alerts on' : 'Alerts off'}
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(contact)}
                      style={{ padding: '7px 12px', borderRadius: '7px', border: `1px solid ${C.border}`, background: 'white', color: C.info, fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(contact)}
                      style={{ padding: '7px 12px', borderRadius: '7px', border: `1px solid ${C.border}`, background: 'white', color: C.red, fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {contacts.length > 0 && (
          <p style={{ margin: '16px 0 0', fontSize: '12px', color: C.muted, lineHeight: 1.6 }}>
            {activeCount === 0
              ? 'Nobody is currently set to be alerted.'
              : `${activeCount} ${activeCount === 1 ? 'person' : 'people'} will be texted a tracking link when an ambulance is assigned to you.`}
            {' '}The link shows the ambulance, its ETA and the hospital — never your name or medical details — and stops working when the case ends.
          </p>
        )}
      </div>
    </div>
  );
};

export default EmergencyContactsSection;
