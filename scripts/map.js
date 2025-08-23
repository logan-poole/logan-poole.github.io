/* ========================================================================
   scripts/map.js
=========================================================================== */

/* Keep #map filling the viewport minus header+footer */
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
  // Guard: require Mapbox GL to be loaded first
  if (!window.mapboxgl || !mapboxgl.Map) {
    const s = document.getElementById('map-status');
    if (s) { s.hidden = false; s.textContent = 'Map failed to load: Mapbox GL JS not found.'; }
    console.error('[map] Mapbox GL JS not loaded. Load CDN script before scripts/map.js');
    return;
  }

  const cfg = window.PINGED_CONFIG || {};
  mapboxgl.accessToken = cfg.MAPBOX_ACCESS_TOKEN || '';

  const elMap = document.getElementById('map');
  if (!elMap) { console.error('[map] #map not found'); return; }

  /* ---------- Map ---------- */
  const map = new mapboxgl.Map({
    container: elMap,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [174.7633, -36.8485], // default center
    zoom: 12.5,
    pitch: 0,
    bearing: 0,
    attributionControl: true,
    pitchWithRotate: true,
    dragRotate: true
  });
  map.scrollZoom.enable();
  map.boxZoom.enable();
  map.doubleClickZoom.enable();
  map.touchZoomRotate.enable();

  if (window.MapboxLanguage) {
    map.addControl(new MapboxLanguage({
      defaultLanguage: (navigator.language || 'en').split('-')[0]
    }));
  }

  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  // Geolocate control UI + our own watch below
  const geolocate = new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    trackUserLocation: true,
    showUserLocation: false,
    fitBoundsOptions: { maxZoom: 15 }
  });
  map.addControl(geolocate, 'top-right');

  map.on('load', () => {
    try { geolocate.trigger(); } catch (_) { }
    startLivePuckWatch();
    injectToolbarCSS();
  });

  /* ---------- Geocoder (Search) ---------- */
  let destMarker = null;
  function setDestMarker(lng, lat, label) {
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
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button id="nav-here" class="btn small">Navigate here</button>
          </div>
        </div>
      `)
      .addTo(map);

    popup.on('open', () => {
      setTimeout(() => {
        const b = document.getElementById('nav-here');
        if (b) b.onclick = () => {
          const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
          window.open(url, '_blank', 'noopener');
        };
      }, 0);
    });
  }

  if (window.MapboxGeocoder) {
    const geocoder = new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl,
      marker: false,
      placeholder: 'Search for a place…',
      proximity: cfg.defaultProximity || undefined
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
  }

  /* ---------- State ---------- */
  const state = {
    gotFirstFix: false,
    styleIdx: 0,
    meLngLat: null,
    meName: 'You',
    trafficOn: false,
    wxOn: false,
    buildings3dOn: false,

    // Weather cycling state
    wxKeys: [],
    wxIndex: 0
  };

  /* ---------- Styles (for theme sync + menu) ---------- */
  const STYLES = [
    { id: 'mapbox://styles/mapbox/streets-v12', label: 'Streets' },
    { id: 'mapbox://styles/mapbox/outdoors-v12', label: 'Outdoors' },
    { id: 'mapbox://styles/mapbox/light-v11', label: 'Light' },
    { id: 'mapbox://styles/mapbox/dark-v11', label: 'Dark' },
    { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Satellite' }
  ];

  map.on('styledata', () => {
    const name = (map.getStyle()?.name || '').toLowerCase();
    const hit = STYLES.findIndex(s => name.includes((s.label || '').toLowerCase()));
    if (hit >= 0) state.styleIdx = hit;
    // Re-add optional layers when style changes
    if (state.buildings3dOn) add3DBuildings();
    if (state.trafficOn) addTrafficLayer();
    if (state.wxOn) addWeatherLayer(); // re-apply raster on style change
  });

  // Theme sync — only switches between light/dark base styles if you’re on one
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
    } catch (_) { }
  });

  /* ---------- Status toast ---------- */
  const elStatus = document.getElementById('map-status');
  function setStatus(msg, ms = 1800) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.hidden = !msg;
    if (msg) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => (elStatus.hidden = true), ms);
    }
  }

  /* ---------- Your location puck ---------- */
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

  function startLivePuckWatch() {
    if (!('geolocation' in navigator)) {
      setStatus('Geolocation not supported on this device/browser.');
      return;
    }
    // Fast one-shot first fix (recenters and toasts once)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords || {};
        if (isFinite(latitude) && isFinite(longitude) && !state.gotFirstFix) {
          state.gotFirstFix = true;
          updatePuck(latitude, longitude);
          map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
          setStatus('Location acquired');
        }
      },
      (err) => { console.warn('[geo one-shot] error:', err?.message || err); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    // Continuous updates
    navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords || {};
        if (!isFinite(latitude) || !isFinite(longitude)) return;
        updatePuck(latitude, longitude);
        if (!state.gotFirstFix) {
          state.gotFirstFix = true;
          map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
          setStatus('Location acquired');
        }
      },
      (err) => { console.warn('[geo watch] error:', err?.message || err); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  async function showPersonPopup(name, lngLat) {
    const popup = new mapboxgl.Popup({ closeOnClick: true, offset: 14 });
    popup.setLngLat([lngLat.lng, lngLat.lat]).setHTML(`
      <div class="mini-card">
        <div class="title">${name || 'You'}</div>
        <div class="subtle">${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}</div>
      </div>
    `).addTo(map);
  }

  /* ======================  BEACONS (local storage)  ===================== */
  const BEACON_STORAGE_KEY = 'pinged_beacons_v1';
  let beacons = [];                 // [{id,lat,lng,label}]
  const beaconMarkers = new Map();  // id -> Marker
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
    const b = { id: String(Date.now()), lat, lng, label };
    beacons.push(b); saveBeacons(); placeBeaconMarker(b);
    setStatus('Beacon added');
  }
  loadBeacons(); renderBeacons();

  /* ---------- Long-press “drop beacon” ---------- */
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

  /* ===========================  Layers / Toggles  =========================== */

  // ---- 3D Buildings
  const BLD_LAYER_ID = 'pinged-3d-buildings';
  function add3DBuildings() {
    if (map.getLayer(BLD_LAYER_ID)) map.removeLayer(BLD_LAYER_ID);
    const labelLayerId = map.getStyle().layers.find(l => l.type === 'symbol' && l.layout['text-field'])?.id;
    map.addLayer({
      id: BLD_LAYER_ID,
      source: 'composite',
      'source-layer': 'building',
      filter: ['==', ['get', 'extrude'], 'true'],
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#aaa',
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': ['get', 'min_height'],
        'fill-extrusion-opacity': 0.6
      }
    }, labelLayerId);
  }
  function remove3DBuildings() {
    if (map.getLayer(BLD_LAYER_ID)) map.removeLayer(BLD_LAYER_ID);
  }

  // ---- Traffic (Mapbox Traffic v1) — FIXED ORDERING (add on top)
  const TRAFFIC_SRC = 'mapbox-traffic';
  const TRAFFIC_LAYER = 'pinged-traffic';
  function addTrafficLayer() {
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
          // show even when 'congestion' is missing
          'line-color': [
            'match', ['coalesce', ['get', 'congestion'], 'unknown'],
            'low', '#43a047',
            'moderate', '#fbc02d',
            'heavy', '#fb8c00',
            'severe', '#e53935',
            /* unknown/other */ '#808080'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 2.0, 12, 3.0, 16, 6.0],
          'line-opacity': 0.95
        }
      }); // IMPORTANT: no "beforeId" => layer goes on TOP of the style
    } else {
      map.setLayoutProperty(TRAFFIC_LAYER, 'visibility', 'visible');
      // also move it to top in case a style change re-ordered layers
      try { map.moveLayer(TRAFFIC_LAYER); } catch (_) { }
    }
  }
  function removeTrafficLayer() {
    if (map.getLayer(TRAFFIC_LAYER)) {
      map.setLayoutProperty(TRAFFIC_LAYER, 'visibility', 'none');
    }
  }

  // ---- Weather (MetService raster overlay)
  const WX_SRC = 'pinged-weather';
  const WX_LAYER = 'pinged-weather-layer';

  function initWeatherKeys() {
    // Only include non-empty URLs
    const raw = cfg.METSERVICE_TILES || {};
    const order = ['precipitation', 'clouds', 'temp', 'wind', 'pressure'];
    state.wxKeys = order.filter(k => typeof raw[k] === 'string' && raw[k].trim().length);
    // Start at configured default if present, else first available
    const defKey = cfg.WEATHER_DEFAULT_KEY || 'precipitation';
    const defIdx = state.wxKeys.indexOf(defKey);
    state.wxIndex = defIdx >= 0 ? defIdx : 0;
  }
  initWeatherKeys();

  function currentWeatherKey() {
    if (!state.wxKeys.length) return null;
    const i = ((state.wxIndex % state.wxKeys.length) + state.wxKeys.length) % state.wxKeys.length;
    return state.wxKeys[i];
  }

  function addWeatherLayer() {
    if (cfg.WEATHER_PROVIDER !== 'metservice') {
      setStatus('Unsupported weather provider.');
      return;
    }
    const key = currentWeatherKey();
    const tiles = (cfg.METSERVICE_TILES || {});
    const url = key ? tiles[key] : '';
    if (!key || !url) {
      setStatus('No MetService tiles configured.');
      return;
    }
    const opacity = typeof cfg.WEATHER_OPACITY === 'number' ? cfg.WEATHER_OPACITY : 0.6;
    const tilesUrl = url + (url.includes('?') ? '&' : '?') + '_cb=' + Date.now(); // cache-buster

    if (!map.getSource(WX_SRC)) {
      map.addSource(WX_SRC, {
        type: 'raster',
        tiles: [tilesUrl],
        tileSize: 256,
        attribution: '© MetService'
      });
    } else {
      try { map.getSource(WX_SRC).setTiles([tilesUrl]); } catch (_) { }
    }

    if (!map.getLayer(WX_LAYER)) {
      map.addLayer({ id: WX_LAYER, type: 'raster', source: WX_SRC, paint: { 'raster-opacity': opacity } });
    } else {
      map.setLayoutProperty(WX_LAYER, 'visibility', 'visible');
      map.setPaintProperty(WX_LAYER, 'raster-opacity', opacity);
      try { map.moveLayer(WX_LAYER); } catch (_) { } // keep on top
    }
    const label = key[0].toUpperCase() + key.slice(1);
    setStatus(`Weather: ${label}`);
  }

  function removeWeatherLayer() {
    if (map.getLayer(WX_LAYER)) map.setLayoutProperty(WX_LAYER, 'visibility', 'none');
  }

  function cycleWeather() {
    if (!state.wxKeys.length) { setStatus('No MetService layers available.'); return; }
    state.wxIndex = (state.wxIndex + 1) % state.wxKeys.length;
    addWeatherLayer();
  }

  /* ============================  Icon Toolbar  ============================ */

  let floatingMenu = null; // element appended to body
  let cleanupClickAway = null;

  class IconCtrl {
    onAdd() {
      const d = document.createElement('div');
      d.className = 'mapboxgl-ctrl mapboxgl-ctrl-group pinged-ctrl iconbar';
      d.innerHTML = `
        <button id="ic-3d"      class="ctrl-btn" title="3D buildings">${svgCube()}</button>
        <button id="ic-traffic" class="ctrl-btn" title="Traffic">${svgLanes()}</button>
        <button id="ic-weather" class="ctrl-btn" title="Weather (right-click to cycle)">${svgCloud()}</button>
        <button id="ic-style"   class="ctrl-btn" title="Choose map style">${svgLayers()}</button>
      `;

      // Build floating menu once and append to body (avoid clipping)
      floatingMenu = document.createElement('div');
      floatingMenu.className = 'pinged-style-menu-flyout';
      floatingMenu.hidden = true;
      floatingMenu.innerHTML = STYLES.map((s, i) =>
        `<button data-i="${i}" class="style-item"><span class="dot"></span><span class="label">${s.label}</span></button>`
      ).join('');
      document.body.appendChild(floatingMenu);

      const b3d = d.querySelector('#ic-3d');
      const bTr = d.querySelector('#ic-traffic');
      const bWx = d.querySelector('#ic-weather');
      const bLy = d.querySelector('#ic-style');

      const setActive = (btn, on) => btn.classList.toggle('active', !!on);
      const hideMenu = () => { if (floatingMenu) floatingMenu.hidden = true; };
      const showMenu = () => {
        if (!floatingMenu) return;
        // mark current
        floatingMenu.querySelectorAll('.style-item').forEach(x =>
          x.classList.toggle('active', +x.dataset.i === state.styleIdx)
        );
        // position next to bLy
        const r = bLy.getBoundingClientRect();
        const left = Math.round(r.right + 8 + window.scrollX);
        const top = Math.round(r.top + window.scrollY);
        floatingMenu.style.left = left + 'px';
        floatingMenu.style.top = top + 'px';
        floatingMenu.hidden = false;

        // click-away
        cleanupClickAway?.();
        const onDoc = (ev) => { if (!floatingMenu.contains(ev.target) && !d.contains(ev.target)) hideMenu(); };
        document.addEventListener('mousedown', onDoc);
        cleanupClickAway = () => document.removeEventListener('mousedown', onDoc);
      };

      // 3D buildings
      b3d.addEventListener('click', () => {
        const on = !b3d.classList.contains('active');
        setActive(b3d, on);
        state.buildings3dOn = on;
        if (on) { add3DBuildings(); setStatus('3D buildings: On'); }
        else { remove3DBuildings(); setStatus('3D buildings: Off'); }
      });

      // Traffic
      bTr.addEventListener('click', () => {
        const on = !bTr.classList.contains('active');
        setActive(bTr, on);
        state.trafficOn = on;
        if (on) { addTrafficLayer(); setStatus('Traffic: On'); }
        else { removeTrafficLayer(); setStatus('Traffic: Off'); }
      });

      // Weather (MetService): click toggles; right-click cycles
      bWx.addEventListener('click', () => {
        const on = !bWx.classList.contains('active');
        setActive(bWx, on);
        state.wxOn = on;
        if (on) addWeatherLayer();
        else removeWeatherLayer();
      });
      bWx.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cycleWeather();
      });

      // Style menu
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

  /* ---------- Inject CSS for flyout + markers ---------- */
  function injectToolbarCSS() {
    if (document.getElementById('pinged-toolbar-css')) return;
    const css = `
      .mapboxgl-ctrl-group .ctrl-btn {
        width: 32px; height: 32px; display:flex; align-items:center; justify-content:center;
      }
      .pinged-style-menu-flyout {
        position: absolute; z-index: 1000;
        min-width: 220px; max-width: 260px;
        padding: 8px;
        background: #fff; color: #111;
        border: 1px solid rgba(0,0,0,0.12);
        border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      }
      html[data-theme="dark"] .pinged-style-menu-flyout {
        background: #1f2125; color: #e6e6e6; border-color: #2b2d31;
      }
      .style-item {
        display: flex; align-items: center; gap: 10px;
        width: 100%;
        padding: 10px 12px;
        border: 0; border-radius: 10px;
        background: transparent;
        cursor: pointer; text-align: left;
        font: 500 14px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans";
        white-space: nowrap;
      }
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
      /* Destination + puck basics */
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

  /* ---------- Utility SVGs ---------- */
  function svgCube() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l10 6v8l-10 6L2 16V8l10-6zm0 2.2L4 8v8l8 4.6 8-4.6V8l-8-3.8z"/></svg>`; }
  function svgLanes() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 7h5v2H2V7zm15 0h5v2h-5V7zM2 15h5v2H2v-2zm15 0h5v2h-5v-2zM11 2h2v20h-2z"/></svg>`; }
  function svgCloud() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 18a4 4 0 010-8 5 5 0 019.6-1.2A4 4 0 1118 18H6z"/></svg>`; }
  function svgLayers() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l9 5-9 5-9-5 9-5zm0 8.5l9 5-9 5-9-5 9-5z"/></svg>`; }
})();
