import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import TokenStorage from '../utils/tokenStorage';
import { formatIstFull, formatTimeAgo } from '@shared/utils/datetime';
import { API_BASE_URL } from '../config/api';
import { Icon, iconSvg } from '@shared/components/ui/Icon';
import { Badge } from '@shared/components/ui/Status';

/**
 * Live Operations Map.
 *
 * One view of the whole fleet: every ambulance and every hospital, plus the
 * dispatches currently linking them. The initial paint comes from
 * `GET /dashboard/admin/operations-map`; after that the map patches itself from
 * `ambulance_location_updated`, `ambulance_status_updated` and
 * `hospital_status_updated`, so a unit moves as its position is reported rather
 * than on a poll boundary. A slow background re-fetch reconciles anything a
 * dropped socket frame would otherwise have missed.
 *
 * Units with no coordinates on record are deliberately kept in the data and
 * reported in the footer ("2 not shown") rather than silently dropped — an
 * operations view should say when it is not showing you everything.
 */

const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');
// Movement arrives over the socket; this only reconciles anything missed while
// the connection was down (it also refetches on every reconnect).
const RECONCILE_MS = 5 * 60_000;

/** Fallback view when nothing on the map has coordinates (central Delhi). */
const FALLBACK_CENTER: L.LatLngTuple = [28.6139, 77.209];

// Same vocabulary as the status badges elsewhere: green available/accepting,
// blue on a case, amber limited/reserved, red only for divert.
const AMBULANCE_STATUS = {
  AVAILABLE:   { color: '#16a34a', label: 'Available' },
  BUSY:        { color: '#2563eb', label: 'On a case' },
  RESERVED:    { color: '#b45309', label: 'Reserved' },
  MAINTENANCE: { color: '#7c3aed', label: 'Maintenance' },
  OFFLINE:     { color: '#94a3b8', label: 'Offline' },
  PENDING:     { color: '#64748b', label: 'Pending' },
} as const;

const HOSPITAL_STATUS = {
  ACCEPTING: { color: '#15803d', label: 'Accepting' },
  LIMITED:   { color: '#b45309', label: 'Limited' },
  DIVERT:    { color: '#dc2626', label: 'On divert' },
} as const;

const ambulanceStyle = (s: string) =>
  AMBULANCE_STATUS[String(s).toUpperCase() as keyof typeof AMBULANCE_STATUS]
  ?? { color: '#64748b', label: String(s || 'Unknown') };

const hospitalStyle = (s: string) =>
  HOSPITAL_STATUS[String(s).toUpperCase() as keyof typeof HOSPITAL_STATUS]
  ?? { color: '#64748b', label: String(s || 'Unknown') };

interface MapAmbulance {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  hasLocation: boolean;
  lastLocationUpdate: string | null;
  driver?: { name: string; phoneNumber: string | null } | null;
  assignment?: {
    dispatchId: string;
    bookingId: string;
    dispatchStatus: string;
    severity: string | null;
    etaMinutes: number | null;
    pickup: { latitude: number | null; longitude: number | null; address: string | null };
    destination: { id: string; name: string; latitude: number | null; longitude: number | null } | null;
  } | null;
}

interface MapHospital {
  id: string;
  name: string;
  address: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  hasLocation: boolean;
  totalBeds: number;
  availableBeds: number;
  occupancyPercent: number | null;
  capabilities: { type: string; status: string }[];
  incomingAmbulances: number;
}

interface OperationsMapData {
  generatedAt: string;
  ambulances: MapAmbulance[];
  hospitals: MapHospital[];
  summary: any;
}

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Ambulance pin: a coloured disc, ringed and pulsing while on a case. */
const ambulanceIcon = (status: string, onCase: boolean) => {
  const { color } = ambulanceStyle(status);
  return L.divIcon({
    className: 'ops-marker',
    html: `<div class="ops-amb${onCase ? ' ops-amb-active' : ''}" style="background:${color};--ring:${color}">${iconSvg('ambulance', 15, 2.2)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
};

/** Hospital pin: a rounded square whose label is its free-bed count. */
const hospitalIcon = (status: string, availableBeds: number) => {
  const { color } = hospitalStyle(status);
  return L.divIcon({
    className: 'ops-marker',
    html: `<div class="ops-hosp" style="background:${color}">${iconSvg('hospital', 13, 2.2)}<span>${availableBeds}</span></div>`,
    iconSize: [44, 26],
    iconAnchor: [22, 13],
  });
};

const OperationsMap = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const ambulanceLayer = useRef<L.LayerGroup | null>(null);
  const hospitalLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const socketRef = useRef<Socket | null>(null);
  /** Set once the first render has framed the data, so live updates don't yank the view. */
  const framedRef = useRef(false);

  const [data, setData] = useState<OperationsMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [showAmbulances, setShowAmbulances] = useState(true);
  const [showHospitals, setShowHospitals] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [onlyActive, setOnlyActive] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const token = TokenStorage.getToken();
      const res = await axios.get(`${API_BASE_URL}/dashboard/admin/operations-map`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load the operations map');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, RECONCILE_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  // ── Live updates ────────────────────────────────────────────────────────
  useEffect(() => {
    // Signed-in admin sockets only; the server sends fleet and dispatch events
    // to the admin room and nowhere else.
    const socket = io(SOCKET_URL, { transports: ['websocket'], auth: cb => cb({ token: TokenStorage.getToken() }) });
    socketRef.current = socket;

    let connectedBefore = false;
    socket.on('connect', () => {
      setLive(true);
      // Catch up on anything that moved while the connection was down.
      if (connectedBefore) fetchData();
      connectedBefore = true;
    });
    socket.on('disconnect', () => setLive(false));

    // Patch just the unit that moved rather than re-fetching the whole fleet.
    const onAmbulance = (p: any) => {
      if (!p?.id) return;
      setLastEventAt(new Date().toISOString());
      setData(prev => prev && ({
        ...prev,
        ambulances: prev.ambulances.map(a => a.id !== p.id ? a : {
          ...a,
          status: p.status ?? a.status,
          latitude: p.latitude ?? a.latitude,
          longitude: p.longitude ?? a.longitude,
          hasLocation: (p.latitude ?? a.latitude) != null && (p.longitude ?? a.longitude) != null,
          lastLocationUpdate: p.lastLocationUpdate ?? a.lastLocationUpdate,
        }),
      }));
    };

    const onHospital = (p: any) => {
      if (!p?.id) return;
      setLastEventAt(new Date().toISOString());
      setData(prev => prev && ({
        ...prev,
        hospitals: prev.hospitals.map(h => h.id !== p.id ? h : {
          ...h,
          status: p.status ?? h.status,
          totalBeds: p.totalBeds ?? h.totalBeds,
          availableBeds: p.availableBeds ?? h.availableBeds,
          occupancyPercent: p.occupancyPercent ?? h.occupancyPercent,
        }),
      }));
    };

    // Dispatch changes alter which ambulance is on a case, which the patch
    // above cannot infer — reconcile from the server instead.
    const onDispatch = () => { setLastEventAt(new Date().toISOString()); fetchData(); };

    socket.on('ambulance_location_updated', onAmbulance);
    socket.on('ambulance_status_updated', onAmbulance);
    socket.on('hospital_status_updated', onHospital);
    socket.on('dispatch_assigned', onDispatch);
    socket.on('dispatch_status_updated', onDispatch);
    socket.on('dispatch_diverted', onDispatch);

    return () => {
      socket.off('ambulance_location_updated', onAmbulance);
      socket.off('ambulance_status_updated', onAmbulance);
      socket.off('hospital_status_updated', onHospital);
      socket.off('dispatch_assigned', onDispatch);
      socket.off('dispatch_status_updated', onDispatch);
      socket.off('dispatch_diverted', onDispatch);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchData]);

  const visibleAmbulances = useMemo(
    () => (data?.ambulances ?? []).filter(a => a.hasLocation && (!onlyActive || !!a.assignment)),
    [data, onlyActive],
  );
  const visibleHospitals = useMemo(
    () => (data?.hospitals ?? []).filter(h => h.hasLocation),
    [data],
  );

  const frame = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngTuple[] = [];
    if (showAmbulances) visibleAmbulances.forEach(a => pts.push([a.latitude as number, a.longitude as number]));
    if (showHospitals) visibleHospitals.forEach(h => pts.push([h.latitude as number, h.longitude as number]));
    // Not animated: Leaflet 1.9 leaves a zoom-animation timer running after
    // map.remove(), which throws (_leaflet_pos) if the operator switches tabs
    // while the map is still framing.
    if (pts.length === 0) { map.setView(FALLBACK_CENTER, 11, { animate: false }); return; }
    if (pts.length === 1) { map.setView(pts[0], 13, { animate: false }); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 14, animate: false });
  }, [showAmbulances, showHospitals, visibleAmbulances, visibleHospitals]);

  // ── Draw ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, { zoomControl: true }).setView(FALLBACK_CENTER, 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(mapRef.current);
      routeLayer.current = L.layerGroup().addTo(mapRef.current);
      hospitalLayer.current = L.layerGroup().addTo(mapRef.current);
      ambulanceLayer.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    ambulanceLayer.current?.clearLayers();
    hospitalLayer.current?.clearLayers();
    routeLayer.current?.clearLayers();

    if (showHospitals) {
      visibleHospitals.forEach(h => {
        const { color, label } = hospitalStyle(h.status);
        L.marker([h.latitude as number, h.longitude as number], {
          icon: hospitalIcon(h.status, h.availableBeds),
          // Names the marker for screen readers and shows on hover.
          title: `${h.name} — ${label}, ${h.availableBeds} beds free`,
        })
          .bindPopup(`
            <div class="ops-popup">
              <div class="ops-popup-title">${escapeHtml(h.name)}</div>
              <div class="ops-popup-tag" style="background:${color}1a;color:${color}">${escapeHtml(label)}</div>
              <dl>
                <div><dt>Beds free</dt><dd>${h.availableBeds} / ${h.totalBeds}</dd></div>
                <div><dt>Occupancy</dt><dd>${h.occupancyPercent === null ? 'n/a' : `${h.occupancyPercent}%`}</dd></div>
                <div><dt>Inbound</dt><dd>${h.incomingAmbulances} ambulance${h.incomingAmbulances === 1 ? '' : 's'}</dd></div>
                ${h.capabilities.length ? `<div><dt>Units</dt><dd>${h.capabilities.map(c => escapeHtml(c.type)).join(', ')}</dd></div>` : ''}
                ${h.address ? `<div><dt>Address</dt><dd>${escapeHtml(h.address)}</dd></div>` : ''}
              </dl>
            </div>`)
          .addTo(hospitalLayer.current!);
      });
    }

    if (showAmbulances) {
      visibleAmbulances.forEach(a => {
        const { color, label } = ambulanceStyle(a.status);
        const onCase = !!a.assignment;
        const pos: L.LatLngTuple = [a.latitude as number, a.longitude as number];

        L.marker(pos, { icon: ambulanceIcon(a.status, onCase), zIndexOffset: 500, title: `Ambulance ${a.vehicleNumber} — ${label}` })
          .bindPopup(`
            <div class="ops-popup">
              <div class="ops-popup-title">${escapeHtml(a.vehicleNumber)}</div>
              <div class="ops-popup-tag" style="background:${color}1a;color:${color}">${escapeHtml(label)}</div>
              <dl>
                <div><dt>Type</dt><dd>${escapeHtml(a.vehicleType)}</dd></div>
                ${a.driver ? `<div><dt>Driver</dt><dd>${escapeHtml(a.driver.name)}</dd></div>` : ''}
                <div><dt>Position</dt><dd>${a.lastLocationUpdate ? escapeHtml(formatTimeAgo(a.lastLocationUpdate)) : 'never reported'}</dd></div>
                ${onCase ? `
                  <div><dt>Case</dt><dd>${escapeHtml(String(a.assignment!.bookingId).slice(0, 8).toUpperCase())}${a.assignment!.severity ? ` · ${escapeHtml(a.assignment!.severity)}` : ''}</dd></div>
                  <div><dt>Stage</dt><dd>${escapeHtml(String(a.assignment!.dispatchStatus).replace(/_/g, ' '))}</dd></div>
                  ${a.assignment!.destination ? `<div><dt>Taking to</dt><dd>${escapeHtml(a.assignment!.destination.name)}</dd></div>` : ''}
                  ${a.assignment!.etaMinutes != null ? `<div><dt>ETA</dt><dd>${a.assignment!.etaMinutes} min</dd></div>` : ''}
                ` : ''}
              </dl>
            </div>`)
          .addTo(ambulanceLayer.current!);

        // Line from the unit to the hospital it is taking the patient to.
        if (showRoutes && onCase && a.assignment?.destination?.latitude != null && a.assignment.destination.longitude != null) {
          L.polyline([pos, [a.assignment.destination.latitude, a.assignment.destination.longitude]], {
            color, weight: 3, opacity: 0.65, dashArray: '8,7',
          }).addTo(routeLayer.current!);
        }
      });
    }

    // Frame once on first data, then leave the operator's view alone.
    if (!framedRef.current && (visibleAmbulances.length || visibleHospitals.length)) {
      framedRef.current = true;
      frame();
    }
    map.invalidateSize();
  }, [visibleAmbulances, visibleHospitals, showAmbulances, showHospitals, showRoutes, frame]);

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
  }, []);

  const s = data?.summary;
  const hiddenAmb = data?.summary?.ambulances?.withoutLocation ?? 0;
  const hiddenHosp = data?.summary?.hospitals?.withoutLocation ?? 0;

  return (
    <section className="ops ui-enter">
      <div className="ui-page-header">
        <div>
          <p className="ui-page-header__text">Every ambulance and hospital, updating as positions are reported.</p>
        </div>
        <div className="ui-row">
          <span className={`ui-badge ui-badge--lg ${live ? 'tone-success' : 'tone-warning'}`} role="status">
            <span className={`ui-live${live ? '' : ' ui-live--static'}`} aria-hidden="true" />
            {live ? 'Live' : 'Reconnecting — polling'}
          </span>
          <button type="button" onClick={frame} className="ui-btn ui-btn--secondary ui-btn--sm" title="Fit every marker in view">
            <Icon name="maximize" size={15} />
            Fit all
          </button>
        </div>
      </div>

      {/* Fleet + capacity at a glance */}
      {s && (
        <div className="ui-kpi-grid ui-kpi-grid--4 ops-stats">
          {[
            { label: 'Ambulances', value: s.ambulances.total, sub: `${s.ambulances.available} available · ${s.ambulances.busy} on a case`, tone: 'tone-brand', icon: 'ambulance' as const },
            { label: 'Active dispatches', value: s.activeDispatches, sub: 'In progress now', tone: s.activeDispatches > 0 ? 'tone-danger' : 'tone-neutral', icon: 'siren' as const },
            { label: 'Hospitals', value: s.hospitals.total, sub: `${s.hospitals.accepting} accepting · ${s.hospitals.divert} on divert`, tone: 'tone-success', icon: 'hospital' as const },
            { label: 'Beds free', value: s.hospitals.availableBeds, sub: `of ${s.hospitals.totalBeds} total`, tone: 'tone-info', icon: 'bed' as const },
          ].map(c => (
            <div key={c.label} className={`ui-card ui-kpi ${c.tone}`}>
              <div className="ui-kpi__top">
                <span className="ui-kpi__label">{c.label}</span>
                <span className="ui-kpi__icon"><Icon name={c.icon} size={17} /></span>
              </div>
              <div className="ui-kpi__value">{c.value}</div>
              <div className="ui-kpi__meta">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="ui-card ops-panel">
        <div className="ops-toolbar" role="toolbar" aria-label="Map layers">
          <button type="button" className="ops-toggle" aria-pressed={showAmbulances} onClick={() => setShowAmbulances(v => !v)}>
            <Icon name="ambulance" size={15} />
            Ambulances <span className="ui-count">{visibleAmbulances.length}</span>
          </button>
          <button type="button" className="ops-toggle" aria-pressed={showHospitals} onClick={() => setShowHospitals(v => !v)}>
            <Icon name="hospital" size={15} />
            Hospitals <span className="ui-count">{visibleHospitals.length}</span>
          </button>
          <button type="button" className="ops-toggle" aria-pressed={onlyActive} onClick={() => setOnlyActive(v => !v)} title="Show only ambulances currently on a case">
            <Icon name="zap" size={15} />
            On a case only
          </button>
          <button type="button" className="ops-toggle" aria-pressed={showRoutes} onClick={() => setShowRoutes(v => !v)} title="Line from each busy unit to its receiving hospital">
            <Icon name="route" size={15} />
            Routes
          </button>
        </div>

        {error && (
          <div className="ui-alert tone-danger" role="alert" style={{ margin: '0 16px 12px' }}>
            <Icon name="alertTriangle" size={17} />
            <div>{error}</div>
          </div>
        )}

        <div className="ops-map-wrap">
          <div ref={containerRef} className="ui-map ops-map" role="region" aria-label="Operations map" />
          {loading && (
            <div className="ops-loading" role="status">
              <span className="ui-spinner" aria-hidden="true" />
              Loading operations map…
            </div>
          )}
        </div>

        <div className="ops-footer">
          <div className="ops-legend" aria-label="Legend">
            {Object.entries(AMBULANCE_STATUS).filter(([k]) => ['AVAILABLE', 'BUSY', 'MAINTENANCE', 'OFFLINE'].includes(k)).map(([k, v]) => (
              <span key={k}><span className="ops-legend__dot" style={{ background: v.color }} />{v.label}</span>
            ))}
            <span className="ops-legend__sep" aria-hidden="true" />
            {Object.entries(HOSPITAL_STATUS).map(([k, v]) => (
              <span key={k}><span className="ops-legend__sq" style={{ background: v.color }} />{v.label}</span>
            ))}
          </div>
          <div className="ops-meta">
            {(hiddenAmb > 0 || hiddenHosp > 0) && (
              <Badge tone="warning" icon="alertTriangle">
                Not shown (no coordinates): {hiddenAmb > 0 ? `${hiddenAmb} ambulance${hiddenAmb === 1 ? '' : 's'}` : ''}
                {hiddenAmb > 0 && hiddenHosp > 0 ? ', ' : ''}
                {hiddenHosp > 0 ? `${hiddenHosp} hospital${hiddenHosp === 1 ? '' : 's'}` : ''}
              </Badge>
            )}
            <span>{lastEventAt ? `Last live update ${formatTimeAgo(lastEventAt)}` : 'No live updates yet this session'}</span>
            {data?.generatedAt && <span title={formatIstFull(data.generatedAt)}>Snapshot {formatTimeAgo(data.generatedAt)}</span>}
          </div>
        </div>
      </div>
    </section>
  );
};

export default OperationsMap;
