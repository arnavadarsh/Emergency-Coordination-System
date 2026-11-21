import React from 'react';
import {
  MEDICAL_PROFILE_FIELDS,
  NOT_PROVIDED,
  type MedicalProfile,
} from '../types/medicalProfile';
import { Icon, type IconName } from './ui/Icon';

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

const FIELD_ICONS: Record<string, IconName> = {
  bloodGroup: 'droplet',
  allergies: 'alertTriangle',
  chronicConditions: 'heartPulse',
  currentMedications: 'pill',
};

const MedicalProfilePanel: React.FC<MedicalProfilePanelProps> = ({
  profile,
  title = 'Medical Profile',
  compact = false,
  accentColor = '#0e7490',
  footnote = null,
  style,
}) => {
  return (
    <section
      className={`ui-medical${compact ? ' ui-medical--compact' : ''}`}
      style={{ '--medical-accent': accentColor, ...style } as React.CSSProperties}
      aria-label="Patient medical profile"
    >
      {title && (
        <header className="ui-medical__header">
          <Icon name="stethoscope" size={compact ? 15 : 17} />
          <h4 className="ui-medical__title">{title}</h4>
          {!profile.hasData && <span className="ui-medical__empty">No information on record</span>}
        </header>
      )}

      <dl className="ui-medical__grid">
        {MEDICAL_PROFILE_FIELDS.map(field => {
          const value = profile.display[field.key];
          const provided = value !== NOT_PROVIDED;
          return (
            <div key={field.key} className={`ui-medical__item${provided ? '' : ' is-empty'}`}>
              <dt>
                <Icon name={FIELD_ICONS[field.key] ?? 'info'} size={13} />
                {field.label}
              </dt>
              <dd>{value}</dd>
            </div>
          );
        })}
      </dl>

      {footnote && <p className="ui-medical__footnote">{footnote}</p>}
    </section>
  );
};

export default MedicalProfilePanel;
