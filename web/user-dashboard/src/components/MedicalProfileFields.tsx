import React from 'react';
import {
  BLOOD_GROUPS,
  MEDICAL_PROFILE_FIELDS,
  type MedicalProfileField,
  type MedicalProfileForm,
} from '@shared/types/medicalProfile';
import { Icon, type IconName } from '@shared/components/ui/Icon';

/**
 * The four Medical Profile inputs.
 *
 * Shared by the "create patient ID" form and the Profile section's editor so the
 * same fields, labels and optionality wording appear in both places. Clearing an
 * input and saving removes that entry — the parent sends blanks through as "".
 */

interface MedicalProfileFieldsProps {
  value: MedicalProfileForm;
  onChange: (next: MedicalProfileForm) => void;
  /** Smaller type for the registration form's narrow column. */
  compact?: boolean;
  disabled?: boolean;
}

const FIELD_ICONS: Record<MedicalProfileField, IconName> = {
  bloodGroup: 'droplet',
  allergies: 'alertTriangle',
  chronicConditions: 'heartPulse',
  currentMedications: 'pill',
};

const MedicalProfileFields: React.FC<MedicalProfileFieldsProps> = ({
  value,
  onChange,
  compact = false,
  disabled = false,
}) => {
  const set = (key: MedicalProfileField, next: string) => onChange({ ...value, [key]: next });

  return (
    <div className={compact ? 'ui-stack usr-medfields usr-medfields--compact' : 'ui-form-grid usr-medfields'}>
      {MEDICAL_PROFILE_FIELDS.map(field => (
        <div key={field.key} className="ui-field">
          <label htmlFor={`medical-${field.key}`} className="ui-label">
            <Icon name={FIELD_ICONS[field.key]} size={14} className="usr-medfields__icon" />
            {field.label}
            <span className="ui-label__optional">(optional)</span>
          </label>

          {field.input === 'select' ? (
            <select
              id={`medical-${field.key}`}
              className="ui-select"
              value={value[field.key]}
              disabled={disabled}
              onChange={e => set(field.key, e.target.value)}
            >
              <option value="">Not provided</option>
              {BLOOD_GROUPS.map(group => (
                <option key={group} value={group}>{group}</option>
              ))}
            </select>
          ) : (
            <textarea
              id={`medical-${field.key}`}
              className="ui-textarea"
              value={value[field.key]}
              disabled={disabled}
              rows={compact ? 2 : 3}
              placeholder={field.placeholder}
              onChange={e => set(field.key, e.target.value)}
              style={compact ? { minHeight: 64 } : undefined}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default MedicalProfileFields;
