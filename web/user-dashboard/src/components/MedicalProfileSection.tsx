import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import MedicalProfileFields from './MedicalProfileFields';
import MedicalProfilePanel from './MedicalProfilePanel';
import {
  EMPTY_MEDICAL_PROFILE_FORM,
  isMedicalProfileFormEmpty,
  normalizeMedicalProfile,
  toMedicalProfileForm,
  toMedicalProfilePayload,
  type MedicalProfile,
  type MedicalProfileForm,
} from '../types/medicalProfile';
import { formatIstFull } from '../utils/datetime';

/**
 * The Medical Profile, editable from the patient's own Profile section.
 *
 * Patients can add information they skipped at ID creation, correct it, or clear
 * it out entirely — all without recreating the patient ID. Saving writes to the
 * patient's profile record, which is the single source of truth: the next triage
 * session, hospital pre-alert and report all read the values saved here.
 */

interface MedicalProfileSectionProps {
  apiBaseUrl: string;
  token: string;
  /** Profile already loaded by the parent, so the section renders without a flash. */
  initialProfile?: MedicalProfile | null;
  /** Lets the parent (dashboard header, triage view) pick up the new values. */
  onSaved?: (profile: MedicalProfile) => void;
}

const C = {
  text: '#172b4d',
  sub: '#6b778c',
  muted: '#97a0af',
  border: '#e0e0e0',
  green: '#00875a',
  greenDark: '#006644',
  red: '#de350b',
  info: '#0066cc',
  infoSoft: '#e3f5ff',
};

const MedicalProfileSection: React.FC<MedicalProfileSectionProps> = ({
  apiBaseUrl,
  token,
  initialProfile = null,
  onSaved,
}) => {
  const [profile, setProfile] = useState<MedicalProfile>(() => normalizeMedicalProfile(initialProfile));
  const [form, setForm] = useState<MedicalProfileForm>(() => toMedicalProfileForm(initialProfile));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const loadProfile = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${apiBaseUrl}/users/medical-profile`, authHeaders);
      const next = normalizeMedicalProfile(res.data);
      setProfile(next);
      setForm(toMedicalProfileForm(next));
    } catch (err) {
      // The parent already renders whatever it loaded with the dashboard, so a
      // failed refresh degrades to those values rather than an empty panel.
      console.error('Failed to load medical profile:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, token]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Blank fields are sent through as "" on purpose: that is how the API is
      // told to remove information that is no longer accurate.
      const res = await axios.put(
        `${apiBaseUrl}/users/medical-profile`,
        toMedicalProfilePayload(form),
        authHeaders,
      );
      const saved = normalizeMedicalProfile(res.data);
      setProfile(saved);
      setForm(toMedicalProfileForm(saved));
      setEditing(false);
      onSaved?.(saved);
      toast.success('Medical Profile saved — responders will see the updated details.');
    } catch (err) {
      console.error('Failed to save medical profile:', err);
      toast.error('Could not save your Medical Profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearAll = () => setForm({ ...EMPTY_MEDICAL_PROFILE_FORM });

  const savedNote = profile.updatedAt
    ? `Last updated ${formatIstFull(profile.updatedAt)}. This is what triage, hospital pre-alerts and reports will show.`
    : 'Not yet filled in. Anything left blank is shown to responders as "Not Provided".';

  return (
    <div style={{ marginTop: '32px' }}>
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          border: `1px solid ${C.border}`,
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
            paddingBottom: '12px',
            marginBottom: '20px',
            borderBottom: `2px solid ${C.border}`,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', color: C.text }}>
              🩺 Medical Profile <span style={{ fontSize: '13px', color: C.muted, fontWeight: 500 }}>(optional)</span>
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: C.sub, maxWidth: '620px', lineHeight: 1.5 }}>
              Blood group, allergies, chronic conditions and current medications. Add or update these at any
              time — your patient ID stays the same, and responders always see the most recently saved details.
            </p>
          </div>

          {!editing && (
            <button
              onClick={() => { setForm(toMedicalProfileForm(profile)); setEditing(true); }}
              disabled={loading}
              style={{
                padding: '10px 18px',
                background: C.info,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {profile.hasData ? '✏️ Edit Medical Profile' : '➕ Add Medical Profile'}
            </button>
          )}
        </div>

        {!editing ? (
          <>
            <MedicalProfilePanel profile={profile} title={null} accentColor={C.info} />
            <p style={{ margin: '14px 0 0', fontSize: '12px', color: C.muted }}>{savedNote}</p>
          </>
        ) : (
          <>
            <div
              style={{
                background: C.infoSoft,
                border: `1px solid ${C.info}33`,
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '20px',
                fontSize: '12px',
                color: C.text,
                lineHeight: 1.6,
              }}
            >
              Every field is optional. Clear a field and save to remove information that is no longer
              accurate — it will then show as <strong>Not Provided</strong> rather than an outdated value.
            </div>

            <MedicalProfileFields value={form} onChange={setForm} disabled={saving} />

            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'flex-end',
                alignItems: 'center',
                flexWrap: 'wrap',
                paddingTop: '20px',
                marginTop: '20px',
                borderTop: `2px solid ${C.border}`,
              }}
            >
              <button
                onClick={handleClearAll}
                disabled={saving || isMedicalProfileFormEmpty(form)}
                style={{
                  marginRight: 'auto',
                  padding: '10px 16px',
                  background: 'transparent',
                  color: isMedicalProfileFormEmpty(form) ? C.muted : C.red,
                  border: `1px solid ${isMedicalProfileFormEmpty(form) ? C.border : C.red}`,
                  borderRadius: '8px',
                  cursor: saving || isMedicalProfileFormEmpty(form) ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
                title="Empty every field. Nothing is removed until you save."
              >
                🗑 Clear all fields
              </button>

              <button
                onClick={() => { setForm(toMedicalProfileForm(profile)); setEditing(false); }}
                disabled={saving}
                style={{
                  padding: '12px 24px',
                  background: '#f4f5f7',
                  color: C.text,
                  border: `2px solid ${C.border}`,
                  borderRadius: '8px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: '15px',
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>

              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '12px 32px',
                  background: saving ? C.greenDark : C.green,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: '15px',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(0, 135, 90, 0.3)',
                }}
              >
                {saving ? 'Saving…' : '💾 Save Medical Profile'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MedicalProfileSection;
