import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000/api';

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
      alert('Failed to add location');
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
      alert('Failed to update location');
    }
  };

  const handleDeleteLocation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this location?')) return;
    
    try {
      await axios.delete(`${API_BASE_URL}/users/saved-locations/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchLocations();
    } catch (error) {
      console.error('Error deleting location:', error);
      alert('Failed to delete location');
    }
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

  const getLocationIcon = (label: string) => {
    const lower = label.toLowerCase();
    if (lower.includes('home')) return '🏠';
    if (lower.includes('work') || lower.includes('office')) return '🏢';
    if (lower.includes('hospital')) return '🏥';
    if (lower.includes('school')) return '🏫';
    return '📍';
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Saved Locations</h2>
          <p className="text-gray-600 mt-1">Manage your frequently used locations for quick booking</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-3 rounded-lg hover:from-red-700 hover:to-red-800 transition-all shadow-lg hover:shadow-xl"
        >
          + Add Location
        </button>
      </div>

      {/* Locations Grid */}
      {locations.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg">
          <div className="text-6xl mb-4">📍</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Saved Locations</h3>
          <p className="text-gray-500 mb-6">Add your frequently used locations for faster emergency booking</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700"
          >
            Add Your First Location
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((location) => (
            <div
              key={location.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className="text-3xl">{getLocationIcon(location.label)}</span>
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900">{location.label}</h3>
                    {location.isDefault && (
                      <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                        ⭐ Default
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-gray-600 text-sm mb-3 line-clamp-2">{location.address}</p>

              <div className="text-xs text-gray-400 mb-4">
                📍 {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
              </div>

              <div className="flex space-x-2">
                {!location.isDefault && (
                  <button
                    onClick={() => handleSetDefault(location.id)}
                    className="flex-1 bg-green-50 text-green-700 px-3 py-2 rounded text-sm hover:bg-green-100 transition"
                  >
                    Set Default
                  </button>
                )}
                <button
                  onClick={() => openEditModal(location)}
                  className="flex-1 bg-blue-50 text-blue-700 px-3 py-2 rounded text-sm hover:bg-blue-100 transition"
                >
                  Edit
                  </button>
                <button
                  onClick={() => handleDeleteLocation(location.id)}
                  className="flex-1 bg-red-50 text-red-700 px-3 py-2 rounded text-sm hover:bg-red-100 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingLocation) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">
              {editingLocation ? 'Edit Location' : 'Add New Location'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Label *
                </label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="e.g., Home, Work, Mom's House"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address *
                </label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Enter full address"
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Latitude *
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.latitude}
                    onChange={(e) => setFormData({ ...formData, latitude: parseFloat(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Longitude *
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.longitude}
                    onChange={(e) => setFormData({ ...formData, longitude: parseFloat(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="w-4 h-4 text-red-600 rounded focus:ring-red-500"
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700">
                  Set as default location
                </label>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  if (editingLocation) {
                    setEditingLocation(null);
                  } else {
                    setShowAddModal(false);
                  }
                  resetForm();
                }}
                className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (editingLocation) {
                    handleUpdateLocation(editingLocation.id);
                  } else {
                    handleAddLocation();
                  }
                }}
                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition"
              >
                {editingLocation ? 'Update' : 'Add'} Location
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
