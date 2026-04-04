import React, { useState } from 'react';
import axios from 'axios';
import { tokenStorage } from '../utils/tokenStorage';

const API_BASE_URL = 'http://localhost:3000/api';

const C = {
  overlay:   'rgba(0,0,0,0.5)',
  sheet:     '#ffffff',
  border:    '#e0e0e0',
  bg:        '#f5f7fa',
  textPrimary:  '#172b4d',
  textSecondary:'#6b778c',
  textMuted:    '#97a0af',
  accent:    '#00a3bf',
  accentSoft:'#e6f7f9',
  green:     '#00875a',
  greenSoft: '#e3fcef',
  red:       '#de350b',
  redSoft:   '#fff4f2',
  warning:   { bg: '#fff8f0', border: '#ffab00', text: '#8a6200' },
};

// Default equipment list when no triage data is available
const DEFAULT_ITEMS = [
  { id: 'first_aid',   label: 'First Aid Kit',       icon: '🩹', required: true },
  { id: 'oxygen',      label: 'Oxygen Tank',          icon: '💨', required: false },
  { id: 'stretcher',   label: 'Stretcher',            icon: '🛏️', required: true },
  { id: 'defib',       label: 'Defibrillator (AED)',  icon: '⚡', required: false },
  { id: 'bp_monitor',  label: 'BP Monitor',           icon: '🩺', required: false },
  { id: 'spine_board', label: 'Spine Board',          icon: '🦴', required: false },
];

// Equipment icon mapping
const EQUIP_ICONS: Record<string, string> = {
  'First aid kit': '🩹', 'first aid kit': '🩹',
  'Stretcher': '🛏️', 'stretcher': '🛏️',
  'Oxygen supply': '💨', 'oxygen supply': '💨', 'Oxygen Tank': '💨',
  'Defibrillator (AED)': '⚡', '12-lead ECG': '📊',
  'Cardiac medications': '💊', 'Aspirin': '💊',
  'Pulse oximeter': '📟', 'BP Monitor': '🩺', 'Blood pressure monitor': '🩺',
  'Ventilator / BVM': '🫁', 'Neuro monitoring': '🧠',
  'Cervical collar': '🦴', 'Spine Board': '🦴', 'Spinal board': '🦴',
  'IV access kit': '💉', 'IV fluids': '💧',
  'Tourniquet': '🩸', 'Hemostatic gauze': '🩹',
  'Trauma kit': '🧰', 'Splints': '🦴',
  'Nebulizer': '💨', 'Suction unit': '🔧',
  'Burn dressings': '🩹', 'Cooling packs': '❄️', 'Pain medications': '💊',
  'Anti-seizure medications': '💊', 'Padded restraints': '🔒',
  'OB kit (delivery pack)': '👶', 'Fetal monitor': '📟', 'Oxytocin': '💊',
  'Blood glucose monitor': '📟', 'Neuro assessment tools': '🧠',
};

function getIcon(label: string): string {
  return EQUIP_ICONS[label] || '📦';
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

  const sevColor = severity === 'CRITICAL' ? C.red : severity === 'HIGH' ? '#ff8b00' : severity === 'MEDIUM' ? '#ffab00' : C.green;
  const hasTriage = requiredEquipment && requiredEquipment.length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.overlay, display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: C.sheet, borderRadius: '16px', width: '100%', maxWidth: '520px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, overflow: 'hidden' }}>

        {/* Header with severity stripe */}
        <div style={{ height: '4px', background: sevColor }} />
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, color: C.textPrimary }}>
                Equipment Checklist
              </h2>
              <p style={{ margin: 0, fontSize: '13px', color: C.textSecondary }}>
                {hasTriage
                  ? '⚡ AI Triage has recommended the following equipment for this case.'
                  : 'Confirm all standard items before starting the route.'}
              </p>
            </div>
            {severity && (
              <span style={{
                padding: '5px 12px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                background: severity === 'CRITICAL' ? C.redSoft : severity === 'HIGH' ? '#fff8f0' : severity === 'MEDIUM' ? '#fffbe6' : C.greenSoft,
                color: sevColor, textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                {severity}
              </span>
            )}
          </div>
          {/* Progress bar */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: C.textMuted, marginBottom: '6px' }}>
              <span>Progress</span>
              <span style={{ fontWeight: 600, color: allChecked ? C.green : C.textSecondary }}>{checkedCount}/{items.length}</span>
            </div>
            <div style={{ height: '4px', background: C.bg, borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{
                width: `${(checkedCount / items.length) * 100}%`,
                height: '100%',
                background: allChecked ? C.green : C.accent,
                borderRadius: '2px',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 24px', maxHeight: '400px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {items.map(item => {
              const on = !!checked[item.id];
              return (
                <div key={item.id} onClick={() => toggle(item.id)} style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '12px 16px', borderRadius: '10px', cursor: 'pointer',
                  background: on ? C.greenSoft : C.bg,
                  border: `1px solid ${on ? C.green : C.border}`,
                  transition: 'all 0.2s',
                }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0,
                    background: on ? C.green : 'white',
                    border: `2px solid ${on ? C.green : C.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}>
                    {on && <span style={{ color: 'white', fontSize: '13px', fontWeight: 800 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: '18px' }}>{item.icon}</span>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: on ? C.green : C.textPrimary, flex: 1 }}>
                    {item.label}
                  </span>
                  {item.required && hasTriage && (
                    <span style={{
                      padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
                      background: on ? C.greenSoft : C.redSoft, color: on ? C.green : C.red,
                      border: `1px solid ${on ? C.green : C.red}`,
                    }}>
                      {on ? 'READY' : 'REQUIRED'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {!allChecked && (
            <div style={{ background: C.warning.bg, border: `1px solid ${C.warning.border}`, borderRadius: '8px',
              padding: '10px 14px', marginTop: '12px', fontSize: '13px', color: C.warning.text, fontWeight: 600 }}>
              ⚠️ Verify all {items.length} items to proceed
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px 20px', borderTop: `1px solid ${C.border}` }}>
          <button onClick={handleConfirm} disabled={!allChecked || saving} style={{
            width: '100%', padding: '14px',
            background: allChecked ? C.red : C.bg,
            color: allChecked ? 'white' : C.textMuted,
            border: `1px solid ${allChecked ? C.red : C.border}`,
            borderRadius: '10px', fontSize: '16px', fontWeight: 700,
            cursor: allChecked ? 'pointer' : 'not-allowed', marginBottom: '8px',
            transition: 'all 0.2s',
            boxShadow: allChecked ? '0 4px 12px rgba(222,53,11,0.3)' : 'none',
          }}>
            {saving ? 'Starting…' : '🚑 Confirm & Start Route'}
          </button>

          <button onClick={onClose} style={{
            width: '100%', padding: '13px', background: 'white', color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: '10px', fontSize: '14px',
            fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = C.bg; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChecklistModal;
