import { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../config/api';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { Badge } from '@shared/components/ui/Status';
import { EmptyState } from '@shared/components/ui/primitives';
import { Modal } from '@shared/components/ui/Modal';


interface SavedLocation {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: string;
}

interface SavedLocationsTabProps {
  token: string;
}

export function SavedLocationsTab({ token }: SavedLocationsTabProps) {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<SavedLocation | null>(null);
  const [formData, setFormData] = useState({
    label: '',
    address: '',
    latitude: 0,
    longitude: 0,
    isDefault: false,
  });

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/users/saved-locations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLocations(response.data);
    } catch (error) {
      console.error('Error fetching saved locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddLocation = async () => {
    try {
      await axios.post(`${API_BASE_URL}/users/saved-locations`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchLocations();
      setShowAddModal(false);
      resetForm();
    } catch (error) {
      console.error('Error adding location:', error);
      toast.error('Failed to add location');
    }
  };

  const handleUpdateLocation = async (id: string) => {
    try {
      await axios.patch(`${API_BASE_URL}/users/saved-locations/${id}`, formData, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchLocations();
      setEditingLocation(null);
      resetForm();
    } catch (error) {
      console.error('Error updating location:', error);
      toast.error('Failed to update location');
    }
  };

  const handleDeleteLocation = (id: string) => {
    toast((t: { id: string }) => (
      <span style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        <span>Delete this location?</span>
        <button onClick={async () => {
          toast.dismiss(t.id);
          try {
            await axios.delete(`${API_BASE_URL}/users/saved-locations/${id}`, { headers: { Authorization: `Bearer ${token}` } });
            await fetchLocations();
            toast.success('Location deleted.');
          } catch (error) {
            console.error('Error deleting location:', error);
            toast.error('Failed to delete location');
          }
        }} className="ui-btn ui-btn--danger ui-btn--sm">
          Delete
        </button>
        <button onClick={() => toast.dismiss(t.id)} className="ui-btn ui-btn--secondary ui-btn--sm">
          Keep
        </button>
      </span>
    ), { duration: 8000 });
  };

  const handleSetDefault = async (id: string) => {
    try {
      await axios.patch(
        `${API_BASE_URL}/users/saved-locations/${id}`,
        { isDefault: true },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchLocations();
    } catch (error) {
      console.error('Error setting default:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      label: '',
      address: '',
      latitude: 0,
      longitude: 0,
      isDefault: false,
    });
  };

  const openEditModal = (location: SavedLocation) => {
    setFormData({
      label: location.label,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      isDefault: location.isDefault,
    });
    setEditingLocation(location);
  };

  const getLocationIcon = (label: string): IconName => {
    const lower = label.toLowerCase();
    if (lower.includes('home')) return 'home';
    if (lower.includes('work') || lower.includes('office')) return 'briefcase';
    if (lower.includes('hospital')) return 'hospital';
    if (lower.includes('school')) return 'building';
    return 'mapPin';
  };

  const closeForm = () => {
    if (editingLocation) {
      setEditingLocation(null);
    } else {
      setShowAddModal(false);
    }
    resetForm();
  };

  if (loading) {
    return (
      <div className="usr-locations__grid" aria-busy="true" aria-label="Loading saved locations">
        {[0, 1, 2].map(i => <span key={i} className="ui-skeleton" style={{ height: 168, borderRadius: 14 }} />)}
      </div>
    );
  }

  return (
    <div className="ui-stack usr-locations">
      {/* Header */}
      <div className="ui-page-header" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="ui-page-header__title">Saved Locations</h2>
          <p className="ui-page-header__text">Manage your frequently used locations for quick booking</p>
        </div>
        <button type="button" onClick={() => setShowAddModal(true)} className="ui-btn ui-btn--primary">
          <Icon name="plus" size={16} />
          Add Location
        </button>
      </div>

      {/* Locations Grid */}
      {locations.length === 0 ? (
        <EmptyState
          icon="mapPin"
          title="No Saved Locations"
          dashed
          actions={
            <button type="button" onClick={() => setShowAddModal(true)} className="ui-btn ui-btn--primary">
              <Icon name="plus" size={16} />
              Add Your First Location
            </button>
          }
        >
          Add your frequently used locations for faster emergency booking
        </EmptyState>
      ) : (
        <div className="usr-locations__grid">
          {locations.map((location, i) => (
            <article key={location.id} className={`ui-card usr-location-card ui-enter${location.isDefault ? ' is-default' : ''}`} style={{ ['--i' as string]: i }}>
              <div className="usr-location-card__head">
                <span className="ui-icon-tile ui-icon-tile--sm"><Icon name={getLocationIcon(location.label)} size={18} /></span>
                <h3 className="usr-location-card__label">{location.label}</h3>
                {location.isDefault && <Badge tone="success" icon="star">Default</Badge>}
              </div>

              <p className="usr-location-card__address">{location.address}</p>

              <div className="usr-location-card__coords ui-mono">
                <Icon name="locate" size={13} />
                {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
              </div>

              <div className="usr-location-card__actions">
                {!location.isDefault && (
                  <button type="button" onClick={() => handleSetDefault(location.id)} className="ui-btn ui-btn--ghost ui-btn--sm">
                    <Icon name="star" size={14} />
                    Set Default
                  </button>
                )}
                <button type="button" onClick={() => openEditModal(location)} className="ui-btn ui-btn--secondary ui-btn--sm">
                  <Icon name="pencil" size={14} />
                  Edit
                </button>
                <button type="button" onClick={() => handleDeleteLocation(location.id)} className="ui-btn ui-btn--danger-soft ui-btn--sm" aria-label={`Delete ${location.label}`}>
                  <Icon name="trash" size={14} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingLocation) && (
        <Modal onClose={closeForm} closeOnBackdrop={false} labelledBy="location-form-title">
          <div className="ui-modal__header">
            <span className="ui-icon-tile"><Icon name={editingLocation ? 'pencil' : 'mapPin'} size={20} /></span>
            <div style={{ flex: 1 }}>
              <h2 id="location-form-title" className="ui-modal__title">
                {editingLocation ? 'Edit Location' : 'Add New Location'}
              </h2>
              <p className="ui-modal__subtitle">Saved places can be picked as a pickup point when you book.</p>
            </div>
          </div>

          <div className="ui-modal__body">
            <div className="ui-form-grid">
              <div className="ui-field is-wide">
                <label className="ui-label" htmlFor="loc-label">Label <span className="ui-label__required" aria-hidden="true">*</span></label>
                <input
                  id="loc-label"
                  className="ui-input"
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="e.g., Home, Work, Mom's House"
                  data-autofocus
                />
              </div>

              <div className="ui-field is-wide">
                <label className="ui-label" htmlFor="loc-address">Address <span className="ui-label__required" aria-hidden="true">*</span></label>
                <textarea
                  id="loc-address"
                  className="ui-textarea"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Enter full address"
                  rows={3}
                />
              </div>

              <div className="ui-field">
                <label className="ui-label" htmlFor="loc-lat">Latitude <span className="ui-label__required" aria-hidden="true">*</span></label>
                <input
                  id="loc-lat"
                  className="ui-input ui-num"
                  type="number"
                  step="any"
                  value={formData.latitude}
                  onChange={(e) => setFormData({ ...formData, latitude: parseFloat(e.target.value) })}
                />
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="loc-lng">Longitude <span className="ui-label__required" aria-hidden="true">*</span></label>
                <input
                  id="loc-lng"
                  className="ui-input ui-num"
                  type="number"
                  step="any"
                  value={formData.longitude}
                  onChange={(e) => setFormData({ ...formData, longitude: parseFloat(e.target.value) })}
                />
              </div>

              <label className="ui-check is-wide" htmlFor="isDefault">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                />
                Set as default location
              </label>
            </div>
          </div>

          <div className="ui-modal__footer">
            <button type="button" onClick={closeForm} className="ui-btn ui-btn--secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (editingLocation) {
                  handleUpdateLocation(editingLocation.id);
                } else {
                  handleAddLocation();
                }
              }}
              className="ui-btn ui-btn--primary"
            >
              <Icon name="save" size={16} />
              {editingLocation ? 'Update' : 'Add'} Location
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
