import { useEffect, useRef } from 'react';
import L from 'leaflet';

interface LiveRouteMapProps {
  ambulanceLat?: number;
  ambulanceLng?: number;
  targetLat?: number;
  targetLng?: number;
  targetLabel?: string;
  title?: string;
  ctaLabel?: string;
}

export function LiveRouteMap({
  ambulanceLat,
  ambulanceLng,
  targetLat,
  targetLng,
  targetLabel,
  title = 'Route',
  ctaLabel = 'Open In Maps',
}: LiveRouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const hasTarget = Number.isFinite(targetLat) && Number.isFinite(targetLng);

  useEffect(() => {
    if (!containerRef.current || !hasTarget) {
      return;
    }

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(mapRef.current);

      layerRef.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) {
      return;
    }

    layer.clearLayers();

    const targetPoint: L.LatLngTuple = [targetLat as number, targetLng as number];
    const points: L.LatLngTuple[] = [targetPoint];

    L.circleMarker(targetPoint, {
      radius: 8,
      color: '#de350b',
      fillColor: '#de350b',
      fillOpacity: 0.9,
      weight: 2,
    })
      .bindPopup(targetLabel || 'Destination')
      .addTo(layer);

    if (Number.isFinite(ambulanceLat) && Number.isFinite(ambulanceLng)) {
      const ambulancePoint: L.LatLngTuple = [ambulanceLat as number, ambulanceLng as number];
      points.push(ambulancePoint);

      L.circleMarker(ambulancePoint, {
        radius: 8,
        color: '#0066cc',
        fillColor: '#0066cc',
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindPopup('Your Ambulance')
        .addTo(layer);

      L.polyline([ambulancePoint, targetPoint], {
        color: '#0066cc',
        weight: 4,
        opacity: 0.8,
        dashArray: '10,8',
      }).addTo(layer);
    }

    map.fitBounds(L.latLngBounds(points), {
      padding: [30, 30],
    });
  }, [ambulanceLat, ambulanceLng, targetLat, targetLng, targetLabel, hasTarget]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  if (!hasTarget) {
    return (
      <div style={{ padding: '20px' }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p style={{ color: '#6b778c', marginBottom: 0 }}>
          Destination coordinates are not available yet.
        </p>
      </div>
    );
  }

  const openExternalNavigation = () => {
    const destination = `${targetLat},${targetLng}`;
    const hasAmbulance = Number.isFinite(ambulanceLat) && Number.isFinite(ambulanceLng);
    const origin = hasAmbulance ? `${ambulanceLat},${ambulanceLng}` : '';
    const url = hasAmbulance
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button
          onClick={openExternalNavigation}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            border: 'none',
            background: '#0066cc',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {ctaLabel}
        </button>
      </div>
      <p style={{ marginTop: 0, color: '#6b778c' }}>{targetLabel || 'Destination'}</p>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '360px',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #e6e8ec',
        }}
      />
    </div>
  );
}