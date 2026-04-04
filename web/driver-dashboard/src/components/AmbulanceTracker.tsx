import { useState, useEffect } from 'react';
import axios from 'axios';
import { tokenStorage } from '../utils/tokenStorage';
import { useGeolocation } from '../utils/useGeolocation';
import '../styles/AmbulanceTracker.css';

const API_BASE_URL = 'http://localhost:3000/api';

interface AmbulanceTrackerProps {
  ambulanceId: string;
  currentStatus: string;
}

export function AmbulanceTracker({ ambulanceId, currentStatus }: AmbulanceTrackerProps) {
  const { latitude, longitude, accuracy, error, isTracking, startTracking, stopTracking, getCurrentPosition } = useGeolocation();
  const [updating, setUpdating] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [ambulanceStatus, setAmbulanceStatus] = useState(currentStatus);

  // Auto-update location every 30 seconds when tracking
  useEffect(() => {
    if (isTracking && latitude && longitude) {
      const interval = setInterval(() => {
        updateLocation(latitude, longitude);
      }, 30000); // 30 seconds

      return () => clearInterval(interval);
    }
  }, [isTracking, latitude, longitude]);

  const updateLocation = async (lat: number, lng: number) => {
    if (!ambulanceId) return;

    try {
      setUpdating(true);
      const token = tokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/ambulances/${ambulanceId}/location`,
        { latitude: lat, longitude: lng },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to update location:', err);
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateNow = async () => {
    try {
      const position = await getCurrentPosition();
      await updateLocation(position.latitude, position.longitude);
      alert('Location updated successfully!');
    } catch (err) {
      alert('Failed to get current location');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!ambulanceId) return;

    try {
      const token = tokenStorage.getToken();
      await axios.patch(
        `${API_BASE_URL}/ambulances/${ambulanceId}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAmbulanceStatus(newStatus);
    } catch (err) {
      console.error('Failed to update status:', err);
      alert('Failed to update ambulance status');
    }
  };

  return (
    <div className="ambulance-tracker-card">
      <h3>Ambulance Status & Location</h3>
      
      {/* Status Management */}
      <div className="status-section">
        <label>Ambulance Status</label>
        <div className="status-buttons">
          {['AVAILABLE', 'BUSY', 'MAINTENANCE', 'OFFLINE'].map(status => (
            <button
              key={status}
              className={`status-btn ${ambulanceStatus === status ? 'active' : ''} ${status.toLowerCase()}`}
              onClick={() => handleStatusChange(status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Location Tracking */}
      <div className="location-section">
        <div className="location-header">
          <label>Location Tracking</label>
          <button
            className={`tracking-toggle ${isTracking ? 'active' : ''}`}
            onClick={() => isTracking ? stopTracking() : startTracking()}
          >
            {isTracking ? '🟢 Tracking ON' : '⚫ Tracking OFF'}
          </button>
        </div>

        {error && <div className="location-error">{error}</div>}

        {latitude && longitude && (
          <div className="location-info">
            <div className="location-row">
              <span>📍 Latitude:</span>
              <strong>{latitude.toFixed(6)}</strong>
            </div>
            <div className="location-row">
              <span>📍 Longitude:</span>
              <strong>{longitude.toFixed(6)}</strong>
            </div>
            {accuracy && (
              <div className="location-row">
                <span>🎯 Accuracy:</span>
                <strong>±{accuracy.toFixed(0)}m</strong>
              </div>
            )}
          </div>
        )}

        <div className="location-actions">
          <button
            className="update-btn"
            onClick={handleUpdateNow}
            disabled={updating}
          >
            {updating ? 'Updating...' : '📌 Update Location Now'}
          </button>
          {lastUpdate && (
            <div className="last-update">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
        </div>

        {isTracking && (
          <div className="tracking-notice">
            ℹ️ Auto-updating location every 30 seconds
          </div>
        )}
      </div>
    </div>
  );
}
