import React from 'react';
import {
  MEDICAL_PROFILE_FIELDS,
  NOT_PROVIDED,
  type MedicalProfile,
} from '../types/medicalProfile';

/**
 * Read-only Medical Profile block.
 *
 * Used everywhere a responder needs the patient's standing clinical background
 * without leaving the screen they are on: the triage view, the triage summary,
 * the hospital pre-arrival alert and the printed case report.
 *
 * All four fields are always rendered. A field the patient never filled in shows
 * "Not Provided" in muted type rather than being hidden, so a responder can tell
 * "no allergies on record" apart from "we never asked".
 */

interface MedicalProfilePanelProps {
  profile: MedicalProfile;
  /** Heading text. Pass null to render the rows alone. */
  title?: string | null;
  /** Tighter padding and type, for cards inside a list. */
  compact?: boolean;
  /** Ties the heading rule to the surrounding card's severity colour. */
  accentColor?: string;
  /** Line explaining where the values come from / when they were last saved. */
  footnote?: string | null;
  style?: React.CSSProperties;
}

const C = {
  text: '#172b4d',
  muted: '#97a0af',
  label: '#6b778c',
  border: '#e0e0e0',
  surface: '#ffffff',
  rowBg: '#f8f9fa',
  accent: '#c62828',
};

const MedicalProfilePanel: React.FC<MedicalProfilePanelProps> = ({
  profile,
  title = 'Medical Profile',
  compact = false,
  accentColor = C.accent,
  footnote = null,
  style,
}) => {
  const pad = compact ? '12px 14px' : '16px 18px';
  const valueSize = compact ? '13px' : '15px';

  return (
    <section
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        padding: pad,
        ...style,
      }}
      aria-label="Patient medical profile"
    >
      {title && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            paddingBottom: compact ? '8px' : '10px',
            marginBottom: compact ? '10px' : '12px',
            borderBottom: `2px solid ${accentColor}22`,
          }}
        >
          <span style={{ fontSize: compact ? '14px' : '16px' }} aria-hidden="true">🩺</span>
          <h4
            style={{
              margin: 0,
              fontSize: compact ? '12px' : '14px',
              fontWeight: 700,
              color: C.text,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            {title}
          </h4>
          {!profile.hasData && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '11px',
                color: C.muted,
                fontWeight: 600,
              }}
            >
              No information on record
            </span>
          )}
        </header>
      )}

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: compact
            ? 'repeat(auto-fit, minmax(160px, 1fr))'
            : 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: compact ? '8px' : '12px',
          margin: 0,
        }}
      >
        {MEDICAL_PROFILE_FIELDS.map(field => {
          const value = profile.display[field.key];
          const provided = value !== NOT_PROVIDED;
          return (
            <div
              key={field.key}
              style={{
                background: C.rowBg,
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                padding: compact ? '8px 10px' : '10px 12px',
              }}
            >
              <dt
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: C.label,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '4px',
                }}
              >
                <span aria-hidden="true">{field.icon}</span>
                {field.label}
              </dt>
              <dd
                style={{
                  margin: 0,
                  fontSize: valueSize,
                  lineHeight: 1.45,
                  fontWeight: provided ? 600 : 500,
                  color: provided ? C.text : C.muted,
                  fontStyle: provided ? 'normal' : 'italic',
                  wordBreak: 'break-word',
                }}
              >
                {value}
              </dd>
            </div>
          );
        })}
      </dl>

      {footnote && (
        <p style={{ margin: `${compact ? 8 : 12}px 0 0`, fontSize: '11px', color: C.muted }}>
          {footnote}
        </p>
      )}
    </section>
  );
};

export default MedicalProfilePanel;
