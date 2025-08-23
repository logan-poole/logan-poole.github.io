/* ============================================================================
FILE: scripts/map.js  (COMPLETE, UPDATED)
NOTE
- Same robust version I provided, with guards for token/library, embed-safe UI,
  and no duplicate navbar in modal (handled in map.html/css). If you already
  pasted this earlier, you can keep that copy; this is the authoritative one.
============================================================================ */
(function fixMapHeight() {
  const elMap = document.getElementById('map');
  if (!elMap) return;
  function size() {
    const head = document.querySelector('.topnav')?.offsetHeight || 0;
    const foot = document.querySelector('footer')?.offsetHeight || 0;
    elMap.style.minHeight = Math.max(240, window.innerHeight - head - foot) + 'px';
  }
  window.addEventListener('resize', size);
  size();
})();

(function () {
  function ensureStatusHost() {
    let s = document.getElementById('map-status');
    if (!s) {
      s = document.createElement('div');
      s.id = 'map-status';
      s.className = 'badge';
      s.hidden = true;
      const mapWrap = document.getElementById('map');
      (mapWrap?.parentNode || document.body).insertBefore(s, mapWrap || null);
    }
    return s;
  }
  const statusEl = ensureStatusHost();
  function setStatus(msg, ms = 1800) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.hidden = !msg;
    if (msg) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => (statusEl.hidden = true), ms);
    }
  }

  if (!window.mapboxgl || !mapboxgl.Map) {
    setStatus('Map failed to load: Mapbox GL JS not found.');
    console.error('[map] Mapbox GL JS not loaded. Load CDN script before scripts/map.js');
    return;
  }

  const cfg = window.PINGED_CONFIG || {};
  const token = cfg.MAPBOX_ACCESS_TOKEN || '';
  if (!token) {
    setStatus('Map is unavailable — missing Mapbox token. Set MAPBOX_ACCESS_TOKEN in scripts/config.js.', 6000);
    console.warn('[map] Missing MAPBOX_ACCESS_TOKEN');
    return;
  }
  mapboxgl.accessToken = token;

  const elMap = document.getElementById('map');
  if (!elMap) { console.error('[map] #map not found'); return; }

  let map;
  try {
    map = new mapboxgl.Map({
      container: elMap,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [174.7633, -36.8485],
      zoom: 12.5,
      pitch: 0,
      bearing: 0,
      attributionControl: true,
      pitchWithRotate: true,
      dragRotate: true
    });
  } catch (e) {
    setStatus('Map failed to initialise: ' + (e?.message || e), 5000);
    console.error('[map] init error:', e);
    return;
  }

  map.on('error', (e) => {
    const msg = e?.error?.message || String(e?.error || 'Unknown map error');
    if (/access token/i.test(msg)) {
      setStatus('Your Mapbox token is invalid or missing required scopes.', 6000);
    } else {
      setStatus('Map error: ' + msg, 4000);
    }
    e.preventDefault?.();
  });

  map.scrollZoom.enable();
  map.boxZoom.enable();
  map.doubleClickZoom.enable();
  map.touchZoomRotate.enable();

  if (window.MapboxLanguage) {
    try {
      map.addControl(new MapboxLanguage({
        defaultLanguage: (navigator.language || 'en').split('-')[0]
      }));
    } catch { }
  }

  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  const geolocate = new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    trackUserLocation: true,
    showUserLocation: false,
    fitBoundsOptions: { maxZoom: 15 }
  });
  map.addControl(geolocate, 'top-right');

  map.on('load', () => {
    try { geolocate.trigger(); } catch { }
    startLivePuckWatch();
    injectToolbarCSS();
  });

  let destMarker = null;
  function setDestMarker(lng, lat, label) {
    if (!isFinite(lng) || !isFinite(lat)) return;
    if (!destMarker) {
      const el = document.createElement('div');
      el.className = 'dest-marker';
      destMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
    } else {
      destMarker.setLngLat([lng, lat]);
    }
    const popup = new mapboxgl.Popup({ offset: 14 })
      .setLngLat([lng, lat])
      .setHTML(`
        <div class="mini-card">
          <div class="title">${label || 'Destination'}</div>
          <div class="subtle">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <button id="route-here" class="btn small">Route from my location</button>
            <button id="copy-coords" class="btn small">Copy coords</button>
            <button id="clear-route" class="btn small" style="display:none;">Clear route</button>
          </div>
        </div>
      `)
      .addTo(map);

    popup.on('open', () => {
      setTimeout(() => {
        const routeBtn = document.getElementById('route-here');
        if (routeBtn) routeBtn.onclick = async () => {
          if (!state.meLngLat) { setStatus('Need your location first…'); try { geolocate.trigger(); } catch { } return; }
          await routeFromTo([state.meLngLat.lng, state.meLngLat.lat], [lng, lat]);
        };

        const copyBtn = document.getElementById('copy-coords');
        if (copyBtn) copyBtn.onclick = async () => {
          const txt = `${lat},${lng}`;
          try { await navigator.clipboard.writeText(txt); setStatus('Copied coordinates'); }
          catch { setStatus('Copy failed'); }
        };

        const clrBtn = document.getElementById('clear-route');
        if (clrBtn) {
          clrBtn.style.display = state.routeGeoJSON ? '' : 'none';
          clrBtn.onclick = () => { clearRoute(); setStatus('Route cleared'); clrBtn.style.display = 'none'; };
        }
      }, 0);
    });
  }

  if (window.MapboxGeocoder) {
    try {
      const geocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken,
        mapboxgl,
        marker: false,
        placeholder: 'Search for a place…'
      });
      map.addControl(geocoder, 'top-left');

      geocoder.on('result', (e) => {
        const c = e?.result?.center;
        if (Array.isArray(c) && c.length >= 2) {
          const [lng, lat] = c;
          setDestMarker(lng, lat, e.result.text || e.result.place_name);
          map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14) });
        }
      });
    } catch { }
  }

  const state = {
    gotFirstFix: false,
    styleIdx: 0,
    meLngLat: null,
    meName: 'You',
    trafficOn: false,
    buildings3dOn: false,
    bestAcc: Infinity,
    retryTimer: null,
    routeGeoJSON: null
  };

  const STYLES = [
    { id: 'mapbox://styles/mapbox/streets-v12', label: 'Streets' },
    { id: 'mapbox://styles/mapbox/outdoors-v12', label: 'Outdoors' },
    { id: 'mapbox://styles/mapbox/light-v11', label: 'Light' },
    { id: 'mapbox://styles/mapbox/dark-v11', label: 'Dark' },
    { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Satellite' }
  ];

  map.on('styledata', () => {
    try {
      const name = (map.getStyle()?.name || '').toLowerCase();
      const hit = STYLES.findIndex(s => name.includes((s.label || '').toLowerCase()));
      if (hit >= 0) state.styleIdx = hit;
    } catch { }

    if (state.buildings3dOn) add3DBuildings();
    if (state.trafficOn) addTrafficLayer();
    if (state.routeGeoJSON) renderRoute(state.routeGeoJSON);
  });

  window.addEventListener('pinged:theme', (e) => {
    try {
      const next = e.detail === 'dark' ? 'dark' : 'light';
      const isLight = STYLES[state.styleIdx]?.id.includes('light');
      const isDark = STYLES[state.styleIdx]?.id.includes('dark');
      if (isLight || isDark) {
        const wantId = next === 'dark'
          ? (STYLES.find(s => s.id.includes('dark'))?.id || STYLES[state.styleIdx].id)
          : (STYLES.find(s => s.id.includes('light'))?.id || STYLES[state.styleIdx].id);
        if (wantId && wantId !== STYLES[state.styleIdx].id) {
          state.styleIdx = STYLES.findIndex(s => s.id === wantId);
          map.setStyle(wantId);
          setStatus(`Theme: ${next[0].toUpperCase() + next.slice(1)}`);
        }
      }
    } catch { }
  });

  let meMarker = null;
  function buildPuckEl() {
    const el = document.createElement('div');
    el.className = 'me-puck';
    el.title = 'You';
    return el;
  }
  function updatePuck(lat, lng) {
    state.meLngLat = { lat, lng };
    if (!meMarker) {
      const el = buildPuckEl();
      el.addEventListener('click', () => showPersonPopup(state.meName, state.meLngLat));
      meMarker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
    } else {
      meMarker.setLngLat([lng, lat]);
    }
  }

  const ACC_OK = 1500;
  const RECENTER_MOVE_M = 300;
  const RECENTER_IMPROVE = 0.6;

  const toRad = (x) => x * Math.PI / 180;
  function distanceMeters(lon1, lat1, lon2, lat2) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function handleFix(coords) {
    const { latitude, longitude, accuracy } = coords || {};
    if (!isFinite(latitude) || !isFinite(longitude)) return;

    updatePuck(latitude, longitude);

    if (!state.gotFirstFix) {
      if (isFinite(accuracy) && accuracy <= ACC_OK) {
        state.gotFirstFix = true;
        map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
      } else if (!state.retryTimer) {
        setStatus('Getting a better GPS fix…');
        state.retryTimer = setTimeout(() => { try { geolocate.trigger(); } catch { } state.retryTimer = null; }, 1500);
      }
    } else if (isFinite(accuracy) && state.bestAcc !== Infinity && accuracy < state.bestAcc * (1 - RECENTER_IMPROVE)) {
      const c = map.getCenter();
      const moved = distanceMeters(c.lng, c.lat, longitude, latitude);
      if (moved > RECENTER_MOVE_M) {
        map.easeTo({ center: [longitude, latitude] });
      }
    }

    if (isFinite(accuracy)) {
      state.bestAcc = Math.min(state.bestAcc, accuracy);
      setStatus(`Location ~${Math.round(accuracy)}m`);
    } else {
      setStatus('Location updated');
    }
  }

  function startLivePuckWatch() {
    if (!('geolocation' in navigator)) {
      setStatus('Geolocation not supported on this device/browser.');
      return;
    }
    geolocate.on('geolocate', (e) => handleFix(e?.coords));

    navigator.geolocation.getCurrentPosition(
      (pos) => handleFix(pos && pos.coords),
      () => { },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
    navigator.geolocation.watchPosition(
      (pos) => handleFix(pos && pos.coords),
      () => { },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  async function showPersonPopup(name, lngLat) {
    if (!lngLat) return;
    new mapboxgl.Popup({ closeOnClick: true, offset: 14 })
      .setLngLat([lngLat.lng, lngLat.lat])
      .setHTML(`
        <div class="mini-card">
          <div class="title">${name || 'You'}</div>
          <div class="subtle">${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}</div>
        </div>
      `)
      .addTo(map);
  }

  const BEACON_STORAGE_KEY = 'pinged_beacons_v1';
  let beacons = [];
  const beaconMarkers = new Map();
  function loadBeacons() {
    try { beacons = JSON.parse(localStorage.getItem(BEACON_STORAGE_KEY) || '[]'); }
    catch { beacons = []; }
  }
  function saveBeacons() {
    try { localStorage.setItem(BEACON_STORAGE_KEY, JSON.stringify(beacons)); } catch { }
  }
  function placeBeaconMarker(b) {
    if (beaconMarkers.has(b.id)) { beaconMarkers.get(b.id).setLngLat([b.lng, b.lat]); return; }
    const el = document.createElement('div');
    el.className = 'beacon-marker';
    el.title = b.label || 'Beacon';
    const m = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([b.lng, b.lat]).addTo(map);
    beaconMarkers.set(b.id, m);
  }
  function renderBeacons() { for (const b of beacons) placeBeaconMarker(b); }
  function addBeacon(lat, lng, label = '') {
    if (!isFinite(lat) || !isFinite(lng)) return;
    const b = { id: String(Date.now()), lat, lng, label };
    beacons.push(b); saveBeacons(); placeBeaconMarker(b);
    setStatus('Beacon added');
  }
  loadBeacons(); renderBeacons();

  const HOLD_MS = 500;
  let holdTimer = null, holdLngLat = null, startXY = null;
  const canvas = map.getCanvas();
  function pointerLngLat(ev) {
    const rect = map.getCanvas().getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    return map.unproject([x, y]);
  }
  function startHold(ev) {
    if (ev.button === 2 || (ev.touches && ev.touches.length > 1)) return;
    clearTimeout(holdTimer);
    startXY = [ev.clientX, ev.clientY];
    holdLngLat = pointerLngLat(ev);
    holdTimer = setTimeout(() => openImproveMenu(holdLngLat), HOLD_MS);
  }
  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }
  function openImproveMenu(ll) {
    const label = prompt('Beacon label (optional):', '');
    addBeacon(ll.lat, ll.lng, label || '');
  }
  canvas.addEventListener('pointerdown', startHold);
  canvas.addEventListener('pointerup', cancelHold);
  canvas.addEventListener('pointerleave', cancelHold);
  canvas.addEventListener('pointermove', (ev) => {
    if (!startXY) return;
    const dx = Math.abs(ev.clientX - startXY[0]);
    const dy = Math.abs(ev.clientY - startXY[1]);
    if (dx > 6 || dy > 6) cancelHold();
  });

  const BLD_LAYER_ID = 'pinged-3d-buildings';
  function whenCompositeReady(run) {
    if (map.getSource('composite')) return run();
    const onData = (e) => {
      if (e.sourceId === 'composite' || map.getSource('composite')) {
        map.off('sourcedata', onData);
        run();
      }
    };
    map.on('sourcedata', onData);
  }
  function add3DBuildings() {
    whenCompositeReady(() => {
      try {
        if (map.getLayer(BLD_LAYER_ID)) map.removeLayer(BLD_LAYER_ID);
        const style = map.getStyle();
        const labelLayerId = style.layers.find(
          (l) => l.type === 'symbol' && l.layout && l.layout['text-field']
        )?.id;

        map.addLayer(
          {
            id: BLD_LAYER_ID,
            source: 'composite',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 15,
            filter: ['any', ['has', 'height'], ['has', 'render_height']],
            paint: {
              'fill-extrusion-color': '#aaa',
              'fill-extrusion-opacity': 0.6,
              'fill-extrusion-height': [
                'interpolate', ['linear'], ['zoom'],
                15, 0,
                15.05, [
                  'coalesce',
                  ['to-number', ['get', 'height']],
                  ['to-number', ['get', 'render_height']],
                  0
                ]
              ],
              'fill-extrusion-base': [
                'coalesce',
                ['to-number', ['get', 'min_height']],
                ['to-number', ['get', 'render_min_height']],
                0
              ]
            }
          },
          labelLayerId
        );
      } catch (e) {
        console.warn('[3D] Could not add layer:', e);
      }
    });
  }
  function remove3DBuildings() {
    if (map.getLayer(BLD_LAYER_ID)) map.removeLayer(BLD_LAYER_ID);
  }

  const TRAFFIC_SRC = 'mapbox-traffic';
  const TRAFFIC_LAYER = 'pinged-traffic';
  function addTrafficLayer() {
    try {
      if (!map.getSource(TRAFFIC_SRC)) {
        map.addSource(TRAFFIC_SRC, { type: 'vector', url: 'mapbox://mapbox.mapbox-traffic-v1' });
      }
      if (!map.getLayer(TRAFFIC_LAYER)) {
        map.addLayer({
          id: TRAFFIC_LAYER,
          type: 'line',
          source: TRAFFIC_SRC,
          'source-layer': 'traffic',
          minzoom: 0,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': [
              'match', ['coalesce', ['get', 'congestion'], 'unknown'],
              'low', '#43a047',
              'moderate', '#fbc02d',
              'heavy', '#fb8c00',
              'severe', '#e53935',
              '#808080'
            ],
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 2.0, 12, 3.0, 16, 6.0],
            'line-opacity': 0.95
          }
        });
      } else {
        map.setLayoutProperty(TRAFFIC_LAYER, 'visibility', 'visible');
        try { map.moveLayer(TRAFFIC_LAYER); } catch { }
      }
    } catch (e) {
      console.warn('[traffic] layer add failed:', e);
    }
  }
  function removeTrafficLayer() {
    if (map.getLayer(TRAFFIC_LAYER)) {
      map.setLayoutProperty(TRAFFIC_LAYER, 'visibility', 'none');
    }
  }

  const ROUTE_SRC = 'pinged-route-src';
  const ROUTE_LAYER = 'pinged-route-line';

  function renderRoute(geojson) {
    if (!geojson || !geojson.features?.[0]?.geometry?.coordinates?.length) return;
    state.routeGeoJSON = geojson;

    if (!map.getSource(ROUTE_SRC)) {
      map.addSource(ROUTE_SRC, { type: 'geojson', data: geojson });
    } else {
      map.getSource(ROUTE_SRC).setData(geojson);
    }

    if (!map.getLayer(ROUTE_LAYER)) {
      map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2563eb',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.0, 12, 4.0, 16, 8.0],
          'line-opacity': 0.95
        }
      });
    }
    try {
      const coords = geojson.features[0].geometry.coordinates;
      const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, { padding: 50, duration: 800 });
    } catch { }
  }

  function clearRoute() {
    if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
    if (map.getSource(ROUTE_SRC)) map.removeSource(ROUTE_SRC);
    state.routeGeoJSON = null;
  }

  async function routeFromTo(fromLngLat, toLngLat) {
    try {
      if (!Array.isArray(fromLngLat) || !Array.isArray(toLngLat)) throw new Error('invalid coords');
      const prof = 'mapbox/driving';
      const url = `https://api.mapbox.com/directions/v5/${prof}/${fromLngLat[0]},${fromLngLat[1]};${toLngLat[0]},${toLngLat[1]}?overview=full&geometries=geojson&access_token=${encodeURIComponent(mapboxgl.accessToken)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const route = json?.routes?.[0];
      if (!route) throw new Error('No route found');
      const geojson = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { distance: route.distance, duration: route.duration },
          geometry: route.geometry
        }]
      };
      renderRoute(geojson);
      setStatus('Route ready');
      const clr = document.getElementById('clear-route'); if (clr) clr.style.display = '';
    } catch (e) {
      console.warn('[route] failed:', e);
      setStatus('Routing failed');
    }
  }

  let floatingMenu = null;
  let cleanupClickAway = null;

  class IconCtrl {
    onAdd() {
      const d = document.createElement('div');
      d.className = 'mapboxgl-ctrl mapboxgl-ctrl-group pinged-ctrl iconbar';
      d.innerHTML = `
        <button id="ic-3d"      class="ctrl-btn" title="3D buildings">${svgCube()}</button>
        <button id="ic-traffic" class="ctrl-btn" title="Traffic">${svgLanes()}</button>
        <button id="ic-style"   class="ctrl-btn" title="Choose map style">${svgLayers()}</button>
      `;

      floatingMenu = document.createElement('div');
      floatingMenu.className = 'pinged-style-menu-flyout';
      floatingMenu.hidden = true;
      floatingMenu.innerHTML = STYLES.map((s, i) =>
        `<button data-i="${i}" class="style-item"><span class="dot"></span><span class="label">${s.label}</span></button>`
      ).join('');
      document.body.appendChild(floatingMenu);

      const b3d = d.querySelector('#ic-3d');
      const bTr = d.querySelector('#ic-traffic');
      const bLy = d.querySelector('#ic-style');

      const setActive = (btn, on) => btn.classList.toggle('active', !!on);
      const hideMenu = () => { if (floatingMenu) floatingMenu.hidden = true; };
      const showMenu = () => {
        if (!floatingMenu) return;
        floatingMenu.querySelectorAll('.style-item').forEach(x =>
          x.classList.toggle('active', +x.dataset.i === state.styleIdx)
        );
        const r = bLy.getBoundingClientRect();
        const left = Math.round(r.right + 8 + window.scrollX);
        const top = Math.round(r.top + window.scrollY);
        floatingMenu.style.left = left + 'px';
        floatingMenu.style.top = top + 'px';
        floatingMenu.hidden = false;

        cleanupClickAway?.();
        const onDoc = (ev) => { if (!floatingMenu.contains(ev.target) && !d.contains(ev.target)) hideMenu(); };
        document.addEventListener('mousedown', onDoc);
        cleanupClickAway = () => document.removeEventListener('mousedown', onDoc);
      };

      b3d.addEventListener('click', () => {
        const on = !b3d.classList.contains('active');
        setActive(b3d, on);
        state.buildings3dOn = on;
        if (on) { add3DBuildings(); setStatus('3D buildings: On'); }
        else { remove3DBuildings(); setStatus('3D buildings: Off'); }
      });

      bTr.addEventListener('click', () => {
        const on = !bTr.classList.contains('active');
        setActive(bTr, on);
        state.trafficOn = on;
        if (on) { addTrafficLayer(); setStatus('Traffic: On'); }
        else { removeTrafficLayer(); setStatus('Traffic: Off'); }
      });

      bLy.addEventListener('click', () => {
        if (!floatingMenu.hidden) return hideMenu();
        showMenu();
      });

      floatingMenu.addEventListener('click', (e) => {
        const btn = e.target.closest('button.style-item'); if (!btn) return;
        const i = +btn.dataset.i;
        if (STYLES[i]) {
          state.styleIdx = i;
          map.setStyle(STYLES[i].id);
          hideMenu();
          setStatus(`Style: ${STYLES[i].label}`);
        }
      });

      return d;
    }
    onRemove() {
      cleanupClickAway?.();
      if (floatingMenu && floatingMenu.parentNode) floatingMenu.parentNode.removeChild(floatingMenu);
      floatingMenu = null;
    }
  }
  map.addControl(new IconCtrl(), 'top-left');

  function injectToolbarCSS() {
    if (document.getElementById('pinged-toolbar-css')) return;
    const css = `
      .mapboxgl-ctrl-group .ctrl-btn { width: 32px; height: 32px; display:flex; align-items:center; justify-content:center; }
      .pinged-style-menu-flyout {
        position: absolute; z-index: 1000; min-width: 220px; max-width: 260px; padding: 8px;
        background: #fff; color: #111; border: 1px solid rgba(0,0,0,0.12);
        border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      }
      html[data-theme="dark"] .pinged-style-menu-flyout { background: #1f2125; color: #e6e6e6; border-color: #2b2d31; }
      .style-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px;
        border: 0; border-radius: 10px; background: transparent; cursor: pointer; text-align: left; font: 500 14px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans"; white-space: nowrap; }
      .style-item:hover { background: rgba(0,0,0,0.06); }
      html[data-theme="dark"] .style-item:hover { background: rgba(255,255,255,0.08); }
      .style-item.active { outline: 2px solid rgba(0,0,0,0.15); }
      html[data-theme="dark"] .style-item.active { outline: 2px solid rgba(255,255,255,0.2); }
      .style-item .dot { width: 10px; height: 10px; border-radius: 50%; display:inline-block; }
      .style-item:nth-child(1) .dot { background:#3b82f6 }
      .style-item:nth-child(2) .dot { background:#10b981 }
      .style-item:nth-child(3) .dot { background:#d1d5db }
      .style-item:nth-child(4) .dot { background:#111827 }
      .style-item:nth-child(5) .dot { background:#f59e0b }
      .me-puck { width: 16px; height: 16px; border: 3px solid #fff; border-radius: 50%; background:#2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.2); }
      .dest-marker { width: 14px; height: 14px; border: 3px solid #fff; border-radius: 50%; background:#ef4444; box-shadow: 0 0 0 2px rgba(239,68,68,0.25); }
      .mini-card .title { font-weight: 600; margin-bottom: 2px; }
      .mini-card .subtle { color: #6b7280; font-size: 12px; }
      html[data-theme="dark"] .mini-card .subtle { color: #9ca3af; }
    `.trim();
    const style = document.createElement('style');
    style.id = 'pinged-toolbar-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function svgCube() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l10 6v8l-10 6L2 16V8l10-6zm0 2.2L4 8v8l8 4.6 8-4.6V8l-8-3.8z"/></svg>`; }
  function svgLanes() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 7h5v2H2V7zm15 0h5v2h-5V7zM2 15h5v2H2v-2zm15 0h5v2h-5v-2zM11 2h2v20h-2z"/></svg>`; }
  function svgLayers() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l9 5-9 5-9-5 9-5zm0 8.5l9 5-9 5-9-5 9-5z"/></svg>`; }
})();
