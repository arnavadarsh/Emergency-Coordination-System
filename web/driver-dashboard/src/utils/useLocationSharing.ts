import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { tokenStorage } from './tokenStorage';

export type LocationSharingStatus =
  /** No ambulance is linked to this driver, so there is nothing to report for. */
  | 'off'
  /** Waiting for the device's first position. */
  | 'starting'
  | 'sharing'
  /** The driver refused the browser's location prompt. */
  | 'denied'
  /** This browser cannot report a position at all. */
  | 'unsupported'
  /** The device or the server failed; sharing resumes by itself when it can. */
  | 'error';

export interface LocationSharing {
  status: LocationSharingStatus;
  latitude: number | null;
  longitude: number | null;
  lastSentAt: Date | null;
}

/** How often, and after how much movement, a position is worth sending. */
const CADENCE = {
  // On a trip the patient, the hospital and the family are watching the map.
  onTrip: { minIntervalMs: 5_000, minMoveMetres: 15, heartbeatMs: 20_000 },
  // Between trips the position only decides which unit is nearest to the next call.
  idle: { minIntervalMs: 20_000, minMoveMetres: 50, heartbeatMs: 60_000 },
};

const metresBetween = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Reports this driver's position to the server while the dashboard is open.
 *
 * The server saves it against the ambulance and forwards it to the people
 * following that unit — the patient's live map, the receiving hospital, the
 * family tracking page and the admin operations map — and uses it to pick the
 * nearest unit for the next booking. Until this ran, every one of those showed
 * wherever the ambulance had last been placed by hand.
 *
 * Positions are throttled: one is sent only after enough time and movement,
 * or after a longer gap if the device keeps reporting the same spot.
 */
export function useLocationSharing(ambulanceId: string | null | undefined, onTrip: boolean): LocationSharing {
  const [state, setState] = useState<LocationSharing>({ status: 'off', latitude: null, longitude: null, lastSentAt: null });

  // Read inside the position callback, so a trip starting does not restart the watch.
  const onTripRef = useRef(onTrip);
  onTripRef.current = onTrip;

  useEffect(() => {
    if (!ambulanceId) {
      setState(previous => ({ ...previous, status: 'off' }));
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState(previous => ({ ...previous, status: 'unsupported' }));
      return;
    }

    let cancelled = false;
    let sending = false;
    let lastSent: { at: number; latitude: number; longitude: number } | null = null;
    setState(previous => ({ ...previous, status: 'starting' }));

    const send = async (latitude: number, longitude: number) => {
      const cadence = onTripRef.current ? CADENCE.onTrip : CADENCE.idle;
      const now = Date.now();
      if (lastSent) {
        const elapsed = now - lastSent.at;
        const moved = metresBetween(lastSent.latitude, lastSent.longitude, latitude, longitude);
        const due = elapsed >= cadence.heartbeatMs || (elapsed >= cadence.minIntervalMs && moved >= cadence.minMoveMetres);
        if (!due) return;
      }
      // One request at a time: on a slow connection, queued positions would arrive stale and out of order.
      if (sending) return;

      sending = true;
      try {
        await axios.patch(
          `${API_BASE_URL}/ambulances/${ambulanceId}/location`,
          { latitude, longitude },
          { headers: { Authorization: `Bearer ${tokenStorage.getToken()}` } },
        );
        lastSent = { at: now, latitude, longitude };
        if (!cancelled) setState({ status: 'sharing', latitude, longitude, lastSentAt: new Date(now) });
      } catch {
        // Keep the device position on screen; the next fix tries the server again.
        if (!cancelled) setState(previous => ({ ...previous, status: 'error', latitude, longitude }));
      } finally {
        sending = false;
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      position => {
        if (!cancelled) void send(position.coords.latitude, position.coords.longitude);
      },
      error => {
        if (cancelled) return;
        setState(previous => ({ ...previous, status: error.code === error.PERMISSION_DENIED ? 'denied' : 'error' }));
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [ambulanceId]);

  return state;
}
