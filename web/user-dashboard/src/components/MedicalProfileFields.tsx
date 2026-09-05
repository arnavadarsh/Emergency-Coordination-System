import React from 'react';
import {
  BLOOD_GROUPS,
  MEDICAL_PROFILE_FIELDS,
  type MedicalProfileField,
  type MedicalProfileForm,
} from '../types/medicalProfile';

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

const C = {
  text: '#172b4d',
  label: '#6b778c',
  border: '#dfe1e6',
  focus: '#0066cc',
};

const MedicalProfileFields: React.FC<MedicalProfileFieldsProps> = ({
  value,
  onChange,
  compact = false,
  disabled = false,
}) => {
  const set = (key: MedicalProfileField, next: string) => onChange({ ...value, [key]: next });

  const baseInput: React.CSSProperties = {
    width: '100%',
    padding: compact ? '10px 12px' : '12px 16px',
    border: `${compact ? 1.5 : 2}px solid ${C.border}`,
    borderRadius: '8px',
    fontSize: compact ? '14px' : '15px',
    color: C.text,
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    background: 'white',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = C.focus;
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = C.border;
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: compact ? '14px' : '20px',
      }}
    >
      {MEDICAL_PROFILE_FIELDS.map(field => (
        <div key={field.key}>
          <label
            htmlFor={`medical-${field.key}`}
            style={{
              display: 'block',
              fontSize: compact ? '12px' : '14px',
              fontWeight: 600,
              marginBottom: compact ? '5px' : '8px',
              color: compact ? C.label : C.text,
            }}
          >
            <span aria-hidden="true">{field.icon}</span> {field.label}{' '}
            <span style={{ color: '#97a0af', fontWeight: 500 }}>(optional)</span>
          </label>

          {field.input === 'select' ? (
            <select
              id={`medical-${field.key}`}
              value={value[field.key]}
              disabled={disabled}
              onChange={e => set(field.key, e.target.value)}
              onFocus={focus}
              onBlur={blur}
              style={{ ...baseInput, cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              <option value="">Not provided</option>
              {BLOOD_GROUPS.map(group => (
                <option key={group} value={group}>{group}</option>
              ))}
            </select>
          ) : (
            <textarea
              id={`medical-${field.key}`}
              value={value[field.key]}
              disabled={disabled}
              rows={compact ? 2 : 3}
              placeholder={field.placeholder}
              onChange={e => set(field.key, e.target.value)}
              onFocus={focus}
              onBlur={blur}
              style={{ ...baseInput, resize: 'vertical', lineHeight: 1.5 }}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default MedicalProfileFields;
