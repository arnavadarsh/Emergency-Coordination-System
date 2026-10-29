import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import MedicalProfileFields from './MedicalProfileFields';
import MedicalProfilePanel from '@shared/components/MedicalProfilePanel';
import {
  EMPTY_MEDICAL_PROFILE_FORM,
  isMedicalProfileFormEmpty,
  normalizeMedicalProfile,
  toMedicalProfileForm,
  toMedicalProfilePayload,
  type MedicalProfile,
  type MedicalProfileForm,
} from '@shared/types/medicalProfile';
import { formatIstFull } from '@shared/utils/datetime';
import { Icon } from '@shared/components/ui/Icon';

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
    <section className="ui-card ui-enter" aria-labelledby="medical-profile-title">
      <div className="ui-card__header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 id="medical-profile-title" className="ui-card__title">
            <Icon name="stethoscope" size={17} />
            Medical Profile <span className="ui-label__optional">(optional)</span>
          </h3>
          <p className="ui-card__subtitle" style={{ maxWidth: 620, lineHeight: 1.5 }}>
            Blood group, allergies, chronic conditions and current medications. Add or update these at any
            time — your patient ID stays the same, and responders always see the most recently saved details.
          </p>
        </div>

        {!editing && (
          <button
            type="button"
            onClick={() => { setForm(toMedicalProfileForm(profile)); setEditing(true); }}
            disabled={loading}
            className="ui-btn ui-btn--secondary"
          >
            <Icon name={profile.hasData ? 'pencil' : 'plus'} size={15} />
            {profile.hasData ? 'Edit Medical Profile' : 'Add Medical Profile'}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="ui-card__body">
          <MedicalProfilePanel profile={profile} title={null} style={{ border: 'none', padding: 0 }} />
          <p className="ui-help" style={{ marginTop: 12 }}>{savedNote}</p>
        </div>
      ) : (
        <>
          <div className="ui-card__body ui-stack">
            <div className="ui-alert tone-info">
              <Icon name="info" size={17} />
              <div>
                Every field is optional. Clear a field and save to remove information that is no longer
                accurate — it will then show as <strong>Not Provided</strong> rather than an outdated value.
              </div>
            </div>

            <MedicalProfileFields value={form} onChange={setForm} disabled={saving} />
          </div>

          <div className="ui-card__footer usr-form-actions">
            <button
              type="button"
              onClick={handleClearAll}
              disabled={saving || isMedicalProfileFormEmpty(form)}
              className="ui-btn ui-btn--ghost usr-clear"
              title="Empty every field. Nothing is removed until you save."
            >
              <Icon name="trash" size={15} />
              Clear all fields
            </button>
            <button
              type="button"
              onClick={() => { setForm(toMedicalProfileForm(profile)); setEditing(false); }}
              disabled={saving}
              className="ui-btn ui-btn--secondary"
            >
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="ui-btn ui-btn--success">
              {saving ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="save" size={16} />}
              {saving ? 'Saving…' : 'Save Medical Profile'}
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default MedicalProfileSection;
