import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import TokenStorage from '../utils/tokenStorage';
import { formatIstFull, formatTimeAgo } from '../utils/datetime';
import { API_BASE_URL } from '../config/api';

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
const RECONCILE_MS = 30000;

/** Fallback view when nothing on the map has coordinates (central Delhi). */
const FALLBACK_CENTER: L.LatLngTuple = [28.6139, 77.209];

const AMBULANCE_STATUS = {
  AVAILABLE:   { color: '#00875a', label: 'Available' },
  BUSY:        { color: '#de350b', label: 'On a case' },
  RESERVED:    { color: '#ff8b00', label: 'Reserved' },
  MAINTENANCE: { color: '#8777d9', label: 'Maintenance' },
  OFFLINE:     { color: '#97a0af', label: 'Offline' },
  PENDING:     { color: '#6b778c', label: 'Pending' },
} as const;

const HOSPITAL_STATUS = {
  ACCEPTING: { color: '#0066cc', label: 'Accepting' },
  LIMITED:   { color: '#ff8b00', label: 'Limited' },
  DIVERT:    { color: '#de350b', label: 'On divert' },
} as const;

const ambulanceStyle = (s: string) =>
  AMBULANCE_STATUS[String(s).toUpperCase() as keyof typeof AMBULANCE_STATUS]
  ?? { color: '#6b778c', label: String(s || 'Unknown') };

const hospitalStyle = (s: string) =>
  HOSPITAL_STATUS[String(s).toUpperCase() as keyof typeof HOSPITAL_STATUS]
  ?? { color: '#6b778c', label: String(s || 'Unknown') };

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
    html: `<div class="ops-amb${onCase ? ' ops-amb-active' : ''}" style="background:${color}">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="#fff" aria-hidden="true">
        <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z"/>
      </svg></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
};

/** Hospital pin: a rounded square whose label is its free-bed count. */
const hospitalIcon = (status: string, availableBeds: number) => {
  const { color } = hospitalStyle(status);
  return L.divIcon({
    className: 'ops-marker',
    html: `<div class="ops-hosp" style="background:${color}"><span>${availableBeds}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
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
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setLive(true));
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
    if (pts.length === 0) { map.setView(FALLBACK_CENTER, 11); return; }
    if (pts.length === 1) { map.setView(pts[0], 13); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 14 });
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
        L.marker([h.latitude as number, h.longitude as number], { icon: hospitalIcon(h.status, h.availableBeds) })
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

        L.marker(pos, { icon: ambulanceIcon(a.status, onCase), zIndexOffset: 500 })
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
    <div className="management-section">
      <style>{`
        .ops-marker { background: none; border: none; }
        .ops-amb, .ops-hosp {
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 6px rgba(9,30,66,.35); border: 2px solid #fff;
        }
        .ops-amb { width: 26px; height: 26px; border-radius: 50%; }
        .ops-hosp { width: 30px; height: 30px; border-radius: 8px; }
        .ops-hosp span { color: #fff; font-size: 11px; font-weight: 800; font-family: inherit; }
        .ops-amb-active { animation: opsPulse 1.8s ease-out infinite; }
        @keyframes opsPulse {
          0%   { box-shadow: 0 0 0 0 rgba(222,53,11,.55), 0 2px 6px rgba(9,30,66,.35); }
          70%  { box-shadow: 0 0 0 12px rgba(222,53,11,0), 0 2px 6px rgba(9,30,66,.35); }
          100% { box-shadow: 0 0 0 0 rgba(222,53,11,0), 0 2px 6px rgba(9,30,66,.35); }
        }
        .ops-popup { font-family: inherit; min-width: 200px; }
        .ops-popup-title { font-size: 14px; font-weight: 800; color: #172b4d; margin-bottom: 6px; }
        .ops-popup-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; margin-bottom: 8px; }
        .ops-popup dl { margin: 0; display: grid; gap: 4px; }
        .ops-popup dl div { display: flex; justify-content: space-between; gap: 12px; }
        .ops-popup dt { font-size: 11px; color: #6b778c; text-transform: uppercase; letter-spacing: .4px; }
        .ops-popup dd { margin: 0; font-size: 12px; color: #172b4d; font-weight: 600; text-align: right; }
        .ops-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .ops-toggle {
          display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px;
          border-radius: 8px; border: 1px solid #dfe1e6; background: #fff;
          font-size: 13px; font-weight: 600; color: #172b4d; cursor: pointer; font-family: inherit;
        }
        .ops-toggle[data-on="true"] { border-color: #0066cc; background: #e9f2ff; color: #0052cc; }
        .ops-legend { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; font-size: 12px; color: #42526e; }
        .ops-legend span.dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; margin-right: 6px; }
        .ops-legend span.sq { width: 11px; height: 11px; border-radius: 3px; display: inline-block; margin-right: 6px; }
      `}</style>

      <div className="section-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Live Operations Map</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b778c' }}>
            Every ambulance and hospital, updating as positions are reported.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '6px 12px',
            borderRadius: '20px', fontSize: '12px', fontWeight: 700,
            background: live ? '#e3fcef' : '#fff4e6', color: live ? '#006644' : '#b06000',
          }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: live ? '#00875a' : '#ff8b00',
              animation: live ? 'opsPulse 1.8s ease-out infinite' : 'none',
            }} />
            {live ? 'Live' : 'Reconnecting — polling'}
          </span>
          <button onClick={frame} className="ops-toggle" title="Fit every marker in view">⤢ Fit all</button>
        </div>
      </div>

      {/* Fleet + capacity at a glance */}
      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          {[
            { label: 'Ambulances', value: s.ambulances.total, sub: `${s.ambulances.available} available · ${s.ambulances.busy} on a case`, color: '#0066cc' },
            { label: 'Active dispatches', value: s.activeDispatches, sub: 'in progress now', color: '#de350b' },
            { label: 'Hospitals', value: s.hospitals.total, sub: `${s.hospitals.accepting} accepting · ${s.hospitals.divert} on divert`, color: '#00875a' },
            { label: 'Beds free', value: s.hospitals.availableBeds, sub: `of ${s.hospitals.totalBeds} total`, color: '#8777d9' },
          ].map(c => (
            <div key={c.label} style={{ background: '#fff', border: '1px solid #dfe1e6', borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', color: '#6b778c', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 700 }}>{c.label}</div>
              <div style={{ fontSize: '26px', fontWeight: 800, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
              <div style={{ fontSize: '12px', color: '#6b778c' }}>{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="ops-toolbar" style={{ marginBottom: '12px' }}>
        <button className="ops-toggle" data-on={showAmbulances} onClick={() => setShowAmbulances(v => !v)}>
          🚑 Ambulances ({visibleAmbulances.length})
        </button>
        <button className="ops-toggle" data-on={showHospitals} onClick={() => setShowHospitals(v => !v)}>
          🏥 Hospitals ({visibleHospitals.length})
        </button>
        <button className="ops-toggle" data-on={onlyActive} onClick={() => setOnlyActive(v => !v)} title="Show only ambulances currently on a case">
          ⚡ On a case only
        </button>
        <button className="ops-toggle" data-on={showRoutes} onClick={() => setShowRoutes(v => !v)} title="Line from each busy unit to its receiving hospital">
          ↗ Routes
        </button>
      </div>

      {error && (
        <div style={{ background: '#fff4f2', border: '1px solid #de350b', color: '#bf2600', borderRadius: '8px', padding: '12px 14px', marginBottom: '12px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%', height: '560px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #dfe1e6', background: '#eef2f6' }} />
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.7)', borderRadius: '12px', color: '#6b778c', fontWeight: 600 }}>
            Loading operations map…
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginTop: '12px' }}>
        <div className="ops-legend">
          {Object.entries(AMBULANCE_STATUS).filter(([k]) => ['AVAILABLE', 'BUSY', 'MAINTENANCE', 'OFFLINE'].includes(k)).map(([k, v]) => (
            <span key={k}><span className="dot" style={{ background: v.color }} />{v.label}</span>
          ))}
          <span style={{ color: '#c1c7d0' }}>|</span>
          {Object.entries(HOSPITAL_STATUS).map(([k, v]) => (
            <span key={k}><span className="sq" style={{ background: v.color }} />{v.label}</span>
          ))}
        </div>
        <div style={{ fontSize: '12px', color: '#6b778c', textAlign: 'right' }}>
          {(hiddenAmb > 0 || hiddenHosp > 0) && (
            <div style={{ color: '#b06000', fontWeight: 600 }}>
              Not shown (no coordinates on record): {hiddenAmb > 0 ? `${hiddenAmb} ambulance${hiddenAmb === 1 ? '' : 's'}` : ''}
              {hiddenAmb > 0 && hiddenHosp > 0 ? ', ' : ''}
              {hiddenHosp > 0 ? `${hiddenHosp} hospital${hiddenHosp === 1 ? '' : 's'}` : ''}
            </div>
          )}
          {lastEventAt
            ? <div>Last live update {formatTimeAgo(lastEventAt)}</div>
            : <div>No live updates yet this session</div>}
          {data?.generatedAt && <div title={formatIstFull(data.generatedAt)}>Snapshot {formatTimeAgo(data.generatedAt)}</div>}
        </div>
      </div>
    </div>
  );
};

export default OperationsMap;
