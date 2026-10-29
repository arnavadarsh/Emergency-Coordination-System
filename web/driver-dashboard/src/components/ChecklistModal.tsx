import React, { useState } from 'react';
import axios from 'axios';
import { tokenStorage } from '../utils/tokenStorage';
import { API_BASE_URL } from '../config/api';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { Modal } from '@shared/components/ui/Modal';
import { SeverityBadge, severityMeta, toneClass } from '@shared/components/ui/Status';

// Default equipment list when no triage data is available
const DEFAULT_ITEMS: { id: string; label: string; icon: IconName; required: boolean }[] = [
  { id: 'first_aid',   label: 'First Aid Kit',       icon: 'medKit',     required: true },
  { id: 'oxygen',      label: 'Oxygen Tank',          icon: 'wind',       required: false },
  { id: 'stretcher',   label: 'Stretcher',            icon: 'bed',        required: true },
  { id: 'defib',       label: 'Defibrillator (AED)',  icon: 'zap',        required: false },
  { id: 'bp_monitor',  label: 'BP Monitor',           icon: 'gauge',      required: false },
  { id: 'spine_board', label: 'Spine Board',          icon: 'bone',       required: false },
];

// Equipment icon mapping (keys lower-cased for a forgiving match)
const EQUIP_ICONS: Record<string, IconName> = {
  'first aid kit': 'medKit', 'stretcher': 'bed',
  'oxygen supply': 'wind', 'oxygen tank': 'wind',
  'defibrillator (aed)': 'zap', '12-lead ecg': 'activity',
  'cardiac medications': 'pill', 'aspirin': 'pill',
  'pulse oximeter': 'heartPulse', 'bp monitor': 'gauge', 'blood pressure monitor': 'gauge',
  'ventilator / bvm': 'wind', 'neuro monitoring': 'brain',
  'cervical collar': 'bone', 'spine board': 'bone', 'spinal board': 'bone',
  'iv access kit': 'syringe', 'iv fluids': 'droplets',
  'tourniquet': 'droplet', 'hemostatic gauze': 'bandage',
  'trauma kit': 'medKit', 'splints': 'bone',
  'nebulizer': 'wind', 'suction unit': 'fan',
  'burn dressings': 'bandage', 'cooling packs': 'snowflake', 'pain medications': 'pill',
  'anti-seizure medications': 'pill', 'padded restraints': 'lock',
  'ob kit (delivery pack)': 'baby', 'fetal monitor': 'heartPulse', 'oxytocin': 'pill',
  'blood glucose monitor': 'droplet', 'neuro assessment tools': 'brain',
};

function getIcon(label: string): IconName {
  return EQUIP_ICONS[label.trim().toLowerCase()] || 'package';
}

interface ChecklistModalProps {
  ambulanceId: string;
  requiredEquipment?: string[];   // From triage result
  severity?: string;              // From booking severity
  onConfirm: () => void;
  onClose: () => void;
}

const ChecklistModal: React.FC<ChecklistModalProps> = ({ ambulanceId, requiredEquipment, severity, onConfirm, onClose }) => {
  // Build items from triage-recommended equipment, or fall back to defaults
  const items = requiredEquipment && requiredEquipment.length > 0
    ? requiredEquipment.map((eq, i) => ({
        id: `eq_${i}`,
        label: eq,
        icon: getIcon(eq),
        required: true,
      }))
    : DEFAULT_ITEMS;

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  const allChecked = items.every(i => checked[i.id]);
  const checkedCount = items.filter(i => checked[i.id]).length;

  const handleConfirm = async () => {
    if (!allChecked) return;
    setSaving(true);
    try {
      const token = tokenStorage.getToken();
      const eq = items.reduce((a, i) => { a[i.label] = checked[i.id] || false; return a; }, {} as any);
      await axios.patch(`${API_BASE_URL}/ambulances/${ambulanceId}/equipment`,
        { equipmentList: { equipment: eq } },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch { /* continue regardless */ }
    setSaving(false);
    onConfirm();
  };

  const hasTriage = requiredEquipment && requiredEquipment.length > 0;
  const pct = Math.round((checkedCount / items.length) * 100);

  return (
    <Modal
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={false}
      labelledBy="checklist-title"
      describedBy="checklist-desc"
      className={`drv-checklist ${toneClass(severityMeta(severity).tone)}`}
    >
      <div className="drv-checklist__stripe" aria-hidden="true" />
      <div className="ui-modal__header">
        <span className="ui-icon-tile"><Icon name="clipboardCheck" size={22} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 id="checklist-title" className="ui-modal__title">Equipment checklist</h2>
          <p id="checklist-desc" className="ui-modal__subtitle">
            {hasTriage
              ? 'AI triage recommends this equipment for the case.'
              : 'Confirm all standard items before starting the route.'}
          </p>
        </div>
        {severity && <SeverityBadge severity={severity} />}
      </div>

      <div className="ui-modal__body">
        <div className="drv-checklist__progress">
          <div className="ui-row" style={{ justifyContent: 'space-between' }}>
            <span className="ui-help">Ready</span>
            <span className={`drv-checklist__count ui-num${allChecked ? ' is-done' : ''}`}>{checkedCount} of {items.length}</span>
          </div>
          <div className={`ui-meter ${allChecked ? 'tone-success' : 'tone-brand'}`}>
            <div className="ui-meter__fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="drv-checklist__items" role="group" aria-label="Equipment">
          {items.map(item => {
            const on = !!checked[item.id];
            return (
              <label key={item.id} className={`ui-check drv-checklist__item${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(item.id)} />
                <Icon name={item.icon} size={18} className="drv-checklist__icon" />
                <span className="drv-checklist__label">{item.label}</span>
                {item.required && hasTriage && (
                  <span className={`ui-badge ${on ? 'tone-success' : 'tone-danger'}`}>{on ? 'Ready' : 'Required'}</span>
                )}
              </label>
            );
          })}
        </div>

        {!allChecked && (
          <div className="ui-alert tone-warning" style={{ marginTop: 14 }}>
            <Icon name="alertTriangle" size={17} />
            <div>Verify all {items.length} items to start the route.</div>
          </div>
        )}
      </div>

      <div className="ui-modal__footer">
        <button type="button" onClick={onClose} className="ui-btn ui-btn--secondary ui-btn--lg" disabled={saving}>
          Cancel
        </button>
        <button type="button" onClick={handleConfirm} disabled={!allChecked || saving} className="ui-btn ui-btn--emergency ui-btn--lg">
          {saving ? <span className="ui-spinner" aria-hidden="true" /> : <Icon name="siren" size={18} />}
          {saving ? 'Starting…' : 'Confirm & start route'}
        </button>
      </div>
    </Modal>
  );
};

export default ChecklistModal;
