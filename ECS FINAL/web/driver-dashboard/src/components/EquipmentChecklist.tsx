import { useState, useEffect } from 'react';
import axios from 'axios';
import { tokenStorage } from '../utils/tokenStorage';
import '../styles/EquipmentChecklist.css';

const API_BASE_URL = 'http://localhost:3000/api';

interface EquipmentItem {
  name: string;
  checked: boolean;
  required: boolean;
}

interface EquipmentChecklistProps {
  ambulanceId: string;
  initialEquipment?: any;
}

const DEFAULT_EQUIPMENT: EquipmentItem[] = [
  { name: 'First Aid Kit', checked: false, required: true },
  { name: 'Oxygen Tank', checked: false, required: true },
  { name: 'Stretcher', checked: false, required: true },
  { name: 'Defibrillator (AED)', checked: false, required: true },
  { name: 'Blood Pressure Monitor', checked: false, required: true },
  { name: 'ECG Machine', checked: false, required: false },
  { name: 'Suction Device', checked: false, required: true },
  { name: 'Spine Board', checked: false, required: true },
  { name: 'Splints', checked: false, required: true },
  { name: 'Bandages', checked: false, required: true },
  { name: 'Gloves', checked: false, required: true },
  { name: 'Fire Extinguisher', checked: false, required: true },
];

export function EquipmentChecklist({ ambulanceId, initialEquipment }: EquipmentChecklistProps) {
  const [equipment, setEquipment] = useState<EquipmentItem[]>(DEFAULT_EQUIPMENT);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    if (initialEquipment?.equipment) {
      // Merge initial equipment with default list
      const merged = DEFAULT_EQUIPMENT.map(item => ({
        ...item,
        checked: initialEquipment.equipment[item.name] || false,
      }));
      setEquipment(merged);
    }
  }, [initialEquipment]);

  const toggleItem = (index: number) => {
    const updated = [...equipment];
    updated[index].checked = !updated[index].checked;
    setEquipment(updated);
  };

  const handleSave = async () => {
    if (!ambulanceId) {
      alert('Ambulance ID not found');
      return;
    }

    try {
      setSaving(true);
      const token = tokenStorage.getToken();
      
      const equipmentData = equipment.reduce((acc, item) => {
        acc[item.name] = item.checked;
        return acc;
      }, {} as any);

      await axios.patch(
        `${API_BASE_URL}/ambulances/${ambulanceId}/equipment`,
        { equipmentList: { equipment: equipmentData } },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setLastSaved(new Date());
      alert('Equipment checklist saved successfully!');
    } catch (err) {
      console.error('Failed to save equipment checklist:', err);
      alert('Failed to save checklist');
    } finally {
      setSaving(false);
    }
  };

  const checkedCount = equipment.filter(item => item.checked).length;
  const requiredCount = equipment.filter(item => item.required).length;
  const requiredChecked = equipment.filter(item => item.required && item.checked).length;
  const allRequiredChecked = requiredChecked === requiredCount;

  return (
    <div className="equipment-checklist-card">
      <div className="checklist-header">
        <h3>Equipment Checklist</h3>
        <div className="checklist-stats">
          <span className={`stat-badge ${allRequiredChecked ? 'complete' : 'incomplete'}`}>
            {checkedCount}/{equipment.length} Checked
          </span>
          <span className={`stat-badge ${allRequiredChecked ? 'complete' : 'incomplete'}`}>
            {requiredChecked}/{requiredCount} Required
          </span>
        </div>
      </div>

      {!allRequiredChecked && (
        <div className="warning-banner">
          ⚠️ Not all required equipment is checked
        </div>
      )}

      <div className="equipment-list">
        {equipment.map((item, index) => (
          <div
            key={item.name}
            className={`equipment-item ${item.checked ? 'checked' : ''}`}
            onClick={() => toggleItem(index)}
          >
            <div className="checkbox-wrapper">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => {}}
                className="equipment-checkbox"
              />
              <span className="checkmark">{item.checked ? '✓' : ''}</span>
            </div>
            <div className="equipment-info">
              <span className="equipment-name">{item.name}</span>
              {item.required && <span className="required-badge">Required</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="checklist-footer">
        <button
          className="save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : '💾 Save Checklist'}
        </button>
        {lastSaved && (
          <div className="last-saved">
            Last saved: {lastSaved.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
