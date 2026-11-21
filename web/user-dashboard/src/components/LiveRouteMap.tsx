import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Icon, iconSvg } from '@shared/components/ui/Icon';

interface LiveRouteMapProps {
  ambulanceLat?: number;
  ambulanceLng?: number;
  targetLat?: number;
  targetLng?: number;
  targetLabel?: string;
  title?: string;
  ctaLabel?: string;
}

/** Ambulance: brand disc with a soft live pulse. */
const ambulanceMarker = () =>
  L.divIcon({
    className: 'ui-marker',
    html: `<span class="ui-marker__unit">${iconSvg('ambulance', 16, 2.2)}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });

/** Destination: red pin, tip on the exact point. */
const targetMarker = () =>
  L.divIcon({
    className: 'ui-marker',
    html: `<span class="ui-marker__pin">${iconSvg('mapPin', 16, 2.4)}</span>`,
    iconSize: [32, 40],
    iconAnchor: [16, 38],
    popupAnchor: [0, -34],
  });

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

    if (Number.isFinite(ambulanceLat) && Number.isFinite(ambulanceLng)) {
      const ambulancePoint: L.LatLngTuple = [ambulanceLat as number, ambulanceLng as number];
      points.push(ambulancePoint);

      L.polyline([ambulancePoint, targetPoint], {
        color: '#0e7490',
        weight: 4,
        opacity: 0.85,
        dashArray: '2,9',
        lineCap: 'round',
      }).addTo(layer);

      L.marker(ambulancePoint, { icon: ambulanceMarker(), zIndexOffset: 500, keyboard: false })
        .bindPopup('Your Ambulance')
        .addTo(layer);
    }

    L.marker(targetPoint, { icon: targetMarker(), keyboard: false })
      .bindPopup(targetLabel || 'Destination')
      .addTo(layer);

    map.fitBounds(L.latLngBounds(points), {
      padding: [40, 40],
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
      <div className="ui-routemap">
        <div className="ui-routemap__head">
          <h3 className="ui-routemap__title"><Icon name="route" size={17} />{title}</h3>
        </div>
        <div className="ui-routemap__pending">
          <Icon name="mapPin" size={18} />
          Destination coordinates are not available yet.
        </div>
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
    <div className="ui-routemap">
      <div className="ui-routemap__head">
        <div style={{ minWidth: 0 }}>
          <h3 className="ui-routemap__title"><Icon name="route" size={17} />{title}</h3>
          <p className="ui-routemap__target">{targetLabel || 'Destination'}</p>
        </div>
        <button type="button" onClick={openExternalNavigation} className="ui-btn ui-btn--primary ui-btn--sm">
          <Icon name="navigation" size={15} />
          {ctaLabel}
        </button>
      </div>
      <div ref={containerRef} className="ui-map ui-routemap__map" style={{ height: '360px' }} aria-label={`Map: ${title}`} role="region" />
      <div className="ui-routemap__legend" aria-hidden="true">
        <span><span className="ui-routemap__key ui-routemap__key--unit" />Ambulance</span>
        <span><span className="ui-routemap__key ui-routemap__key--target" />Destination</span>
        <span><span className="ui-routemap__key ui-routemap__key--route" />Route</span>
      </div>
    </div>
  );
}
