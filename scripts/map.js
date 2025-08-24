/* ============================================================================
FILE: scripts/map.js  (DROP-IN REPLACEMENT)
CHANGES (this rev)
- Clear all beacons: new trash button in the top-right controls (with confirm).
- Long-press opens an inline note form before placing the beacon.
- 3D mode fixed: terrain + sky + building extrusions with safer fallbacks.
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
  // -------- Status host (inside the map, bottom-left) -----------------------
  const cfg = window.PINGED_CONFIG || window.PINGED || {};
  const STATUS_MODE = (cfg.MAP_STATUS || 'minimal'); // 'off' | 'minimal' | 'verbose'

  function injectMapCSS() {
    if (document.getElementById('pinged-map-css')) return;
    const css = `
      #map{position:relative}
      #map #map-status{
        position:absolute;left:12px;bottom:12px;margin:0;
        pointer-events:none;opacity:.96
      }
      .beacon-marker{
        width:14px;height:14px;border-radius:50%;
        background:#f43f5e;border:3px solid #fff;
        box-shadow:0 0 0 2px rgba(244,63,94,.25);
        cursor:pointer;
      }
      .pinged-style-menu-flyout{
        position:absolute;z-index:9999;
        padding:8px;border-radius:10px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18);
        display:flex;flex-direction:column;gap:6px
      }
      .pinged-style-menu-flyout .style-item{
        display:flex;align-items:center;gap:8px;
        padding:8px 10px;border-radius:8px;border:1px solid #eef;
        background:#fafbff;cursor:pointer
      }
      .pinged-style-menu-flyout .style-item.active{background:#e8f0ff;border-color:#cfe0ff}
      .pinged-style-menu-flyout .dot{width:8px;height:8px;border-radius:50%;background:#2563eb}
      .pinged-style-menu-flyout .label{font:500 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu}

      /* Inline "Add beacon" form */
      .beacon-form{min-width:220px}
      .beacon-form .row{display:flex;gap:6px;margin-top:8px}
      .beacon-form input[type="text"]{
        flex:1;border:1px solid #dbe1ea;border-radius:8px;padding:8px;font:13px system-ui,-apple-system,Segoe UI,Roboto,Ubuntu
      }
      .beacon-form .btn{
        border:1px solid #cfe0ff;background:#e8f0ff;border-radius:8px;padding:8px 10px;
        font:600 12px system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;cursor:pointer
      }
      .beacon-form .btn.secondary{background:#fff;border-color:#e2e8f0}
    `.trim();
    const style = document.createElement('style');
    style.id = 'pinged-map-css';
    style.textContent = css;
    document.head.appendChild(style);
  }
  injectMapCSS();

  function ensureStatusHost() {
    const mapWrap = document.getElementById('map');
    if (!mapWrap) return null;

    let s = document.getElementById('map-status');
    if (!s) {
      s = document.createElement('div');
      s.id = 'map-status';
      s.className = 'badge';
      s.hidden = true;
      mapWrap.appendChild(s); // inside #map
    } else if (s.parentNode !== mapWrap) {
      s.parentNode.removeChild(s);
      mapWrap.appendChild(s);
    }
    return s;
  }
  const statusEl = ensureStatusHost();

  const THROTTLE_MS = 2000;
  let lastStatusAt = 0;
  function setStatus(msg, ms = 1800, force = false) {
    if (!statusEl) return;
    if (!msg) { statusEl.hidden = true; return; }
    if (STATUS_MODE === 'off' && !force) return;

    const now = Date.now();
    if (!force && STATUS_MODE === 'minimal' && now - lastStatusAt < THROTTLE_MS) return;

    statusEl.textContent = msg;
    statusEl.hidden = false;
    lastStatusAt = now;
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => (statusEl.hidden = true), ms);
  }

  // -------- Mapbox init -----------------------------------------------------
  if (!window.mapboxgl || !mapboxgl.Map) {
    setStatus('Map failed to load: Mapbox GL JS not found.', 4000, true);
    console.error('[map] Mapbox GL JS not loaded. Load CDN script before scripts/map.js');
    return;
  }

  const token = cfg.MAPBOX_ACCESS_TOKEN || '';
  if (!token) {
    setStatus('Map is unavailable — missing Mapbox token.', 6000, true);
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
      zoom: 14.5, // default zoom
      pitch: 0,
      bearing: 0,
      attributionControl: true,
      pitchWithRotate: true,
      dragRotate: true
    });
  } catch (e) {
    setStatus('Map failed to initialise: ' + (e?.message || e), 5000, true);
    console.error('[map] init error:', e);
    return;
  }

  map.on('error', (e) => {
    const msg = e?.error?.message || String(e?.error || 'Unknown map error');
    if (/access token/i.test(msg)) {
      setStatus('Your Mapbox token is invalid or missing required scopes.', 6000, true);
    } else {
      setStatus('Map error: ' + msg, 4000, true);
    }
    e.preventDefault?.();
  });

  // Locale labels if available
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
    fitBoundsOptions: { maxZoom: 16 }
  });
  map.addControl(geolocate, 'top-right');

  // -------- “Puck” (you) + location logic ----------------------------------
  const state = {
    gotFirstFix: false,
    meLngLat: null,
    meName: 'You',
    bestAcc: Infinity,
    lastRecenterAt: 0
  };

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

  const FIRST_FIX_ZOOM = 16;           // zoom on first fix
  const RECENTER_IF_MOVED_M = 400;     // recenter if you moved this far from map center
  const RECENTER_MIN_INTERVAL = 20000; // ms between auto recenters

  function handleFix(coords) {
    const { latitude, longitude, accuracy } = coords || {};
    if (!isFinite(latitude) || !isFinite(longitude)) return;

    updatePuck(latitude, longitude);

    if (!state.gotFirstFix) {
      state.gotFirstFix = true;
      map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), FIRST_FIX_ZOOM) });
      state.bestAcc = isFinite(accuracy) ? accuracy : state.bestAcc;
      setStatus('Location found', 1200);
      return;
    }

    try {
      const c = map.getCenter();
      const moved = distanceMeters(c.lng, c.lat, longitude, latitude);
      const since = Date.now() - state.lastRecenterAt;
      if (moved > RECENTER_IF_MOVED_M && since > RECENTER_MIN_INTERVAL) {
        map.easeTo({ center: [longitude, latitude] });
        state.lastRecenterAt = Date.now();
      }
    } catch { }

    if (isFinite(accuracy)) state.bestAcc = Math.min(state.bestAcc, accuracy);
  }

  function startLivePuckWatch() {
    if (!('geolocation' in navigator)) {
      setStatus('Geolocation not supported on this device/browser.', 4000, true);
      return;
    }
    geolocate.on('geolocate', (e) => handleFix(e?.coords));

    map.once('load', () => {
      try { geolocate.trigger(); } catch { }
      navigator.geolocation.getCurrentPosition(
        (pos) => handleFix(pos && pos.coords),
        () => { }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
      navigator.geolocation.watchPosition(
        (pos) => handleFix(pos && pos.coords),
        () => { }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
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

  // -------- Geocoder & destination marker -----------------------------------
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
          if (!state.meLngLat) { try { geolocate.trigger(); } catch { } return; }
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
          clrBtn.style.display = stateStyle.routeGeoJSON ? '' : 'none';
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
          map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15.5) });
        }
      });
    } catch { }
  }

  // -------- Optional layers (3D, traffic) + style picker --------------------
  const STYLES = [
    { id: 'mapbox://styles/mapbox/streets-v12', label: 'Streets' },
    { id: 'mapbox://styles/mapbox/outdoors-v12', label: 'Outdoors' },
    { id: 'mapbox://styles/mapbox/light-v11', label: 'Light' },
    { id: 'mapbox://styles/mapbox/dark-v11', label: 'Dark' },
    { id: 'mapbox://styles/mapbox/satellite-streets-v12', label: 'Satellite' }
  ];
  const BLD_LAYER_ID = 'pinged-3d-buildings';
  const SKY_LAYER_ID = 'pinged-sky';
  const DEM_SRC = 'mapbox-dem';
  const TRAFFIC_SRC = 'mapbox-traffic';
  const TRAFFIC_LAYER = 'pinged-traffic';

  const stateStyle = { idx: 0, trafficOn: false, buildings3dOn: false, terrainOn: false, routeGeoJSON: null };

  map.on('styledata', () => {
    try {
      const name = (map.getStyle()?.name || '').toLowerCase();
      const hit = STYLES.findIndex(s => name.includes((s.label || '').toLowerCase()));
      if (hit >= 0) stateStyle.idx = hit;
    } catch { }
    if (stateStyle.terrainOn) { addTerrain(); addSky(); }
    if (stateStyle.buildings3dOn) add3DBuildings();
    if (stateStyle.trafficOn) addTrafficLayer();
    if (stateStyle.routeGeoJSON) renderRoute(stateStyle.routeGeoJSON);
  });

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
            minzoom: 14, // earlier start to make it obvious
            filter: ['any',
              ['has', 'height'],
              ['has', 'render_height'],
              ['==', ['get', 'extrude'], 'true'] // fallback used in some styles
            ],
            paint: {
              'fill-extrusion-color': '#aaa',
              'fill-extrusion-opacity': 0.6,
              'fill-extrusion-height': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                14.05, [
                  'coalesce',
                  ['to-number', ['get', 'height']],
                  ['to-number', ['get', 'render_height']],
                  20 // fallback meters if no explicit height
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
        const target = Math.max(map.getZoom(), 15);
        const pitch = Math.max(map.getPitch(), 55);
        map.easeTo({ zoom: target, pitch, duration: 600 });
      } catch (e) { console.warn('[3D] Could not add layer:', e); }
    });
  }
  function remove3DBuildings() { if (map.getLayer(BLD_LAYER_ID)) map.removeLayer(BLD_LAYER_ID); }

  function addTerrain() {
    try {
      if (!map.getSource(DEM_SRC)) {
        map.addSource(DEM_SRC, {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512, maxzoom: 14
        });
      }
      map.setTerrain({ source: DEM_SRC, exaggeration: 1.2 });
      if (map.getPitch() < 45) map.easeTo({ pitch: 60, duration: 600 });
    } catch (e) { console.warn('[terrain] failed:', e); }
  }
  function removeTerrain() { try { map.setTerrain(null); } catch { } }

  function addSky() {
    try {
      if (!map.getLayer(SKY_LAYER_ID)) {
        map.addLayer({
          id: SKY_LAYER_ID,
          type: 'sky',
          paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun-intensity': 15 }
        });
      }
    } catch (e) { console.warn('[sky] failed:', e); }
  }
  function removeSky() { if (map.getLayer(SKY_LAYER_ID)) map.removeLayer(SKY_LAYER_ID); }

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
      }
    } catch (e) { console.warn('[traffic] layer add failed:', e); }
  }
  function removeTrafficLayer() { if (map.getLayer(TRAFFIC_LAYER)) map.setLayoutProperty(TRAFFIC_LAYER, 'visibility', 'none'); }

  // -------- Controls (top-right). Style menu opens LEFT of the button -------
  let floatingMenu = null, cleanupClickAway = null;
  class IconCtrl {
    onAdd() {
      const d = document.createElement('div');
      d.className = 'mapboxgl-ctrl mapboxgl-ctrl-group pinged-ctrl iconbar';
      d.innerHTML = `
        <button id="ic-3d"      class="ctrl-btn" title="3D view">${svgCube()}</button>
        <button id="ic-traffic" class="ctrl-btn" title="Traffic">${svgLanes()}</button>
        <button id="ic-style"   class="ctrl-btn" title="Choose map style">${svgLayers()}</button>
        <button id="ic-clear"   class="ctrl-btn" title="Clear all beacons">${svgTrash()}</button>
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
      const bClr = d.querySelector('#ic-clear');

      const setActive = (btn, on) => btn.classList.toggle('active', !!on);
      const hideMenu = () => { if (floatingMenu) floatingMenu.hidden = true; };
      const showMenu = () => {
        if (!floatingMenu) return;
        floatingMenu.hidden = false; // show to measure
        floatingMenu.querySelectorAll('.style-item').forEach(x =>
          x.classList.toggle('active', +x.dataset.i === stateStyle.idx)
        );

        const r = bLy.getBoundingClientRect();
        const menuW = floatingMenu.offsetWidth || 220;
        let left = Math.round(r.left + window.scrollX - menuW - 8);
        const top = Math.round(r.top + window.scrollY);
        left = Math.max(8, Math.min(left, window.scrollX + window.innerWidth - menuW - 8));
        floatingMenu.style.left = left + 'px';
        floatingMenu.style.top = top + 'px';

        cleanupClickAway?.();
        const onDoc = (ev) => { if (!floatingMenu.contains(ev.target) && !d.contains(ev.target)) hideMenu(); };
        document.addEventListener('mousedown', onDoc);
        cleanupClickAway = () => document.removeEventListener('mousedown', onDoc);
      };

      b3d.addEventListener('click', () => {
        const on = !(stateStyle.terrainOn || stateStyle.buildings3dOn);
        stateStyle.terrainOn = on;
        stateStyle.buildings3dOn = on;

        if (on) {
          addTerrain(); addSky(); add3DBuildings();
          setActive(b3d, true);
          setStatus('3D view: On');
        } else {
          remove3DBuildings(); removeTerrain(); removeSky();
          setActive(b3d, false);
          map.easeTo({ pitch: 0, duration: 400 });
          setStatus('3D view: Off');
        }
      });

      bTr.addEventListener('click', () => {
        const on = !bTr.classList.contains('active');
        setActive(bTr, on);
        stateStyle.trafficOn = on;
        on ? addTrafficLayer() : removeTrafficLayer();
        setStatus(`Traffic: ${on ? 'On' : 'Off'}`);
      });

      bLy.addEventListener('click', () => {
        if (!floatingMenu.hidden) return hideMenu();
        showMenu();
      });

      floatingMenu.addEventListener('click', (e) => {
        const btn = e.target.closest('button.style-item'); if (!btn) return;
        const i = +btn.dataset.i;
        if (STYLES[i]) {
          stateStyle.idx = i;
          map.setStyle(STYLES[i].id);
          hideMenu();
          setStatus(`Style: ${STYLES[i].label}`);
        }
      });

      bClr.addEventListener('click', () => {
        if (confirm('Clear ALL beacons? This cannot be undone.')) clearAllBeacons();
      });

      return d;
    }
    onRemove() {
      cleanupClickAway?.();
      if (floatingMenu && floatingMenu.parentNode) floatingMenu.parentNode.removeChild(floatingMenu);
      floatingMenu = null;
    }
  }
  map.addControl(new IconCtrl(), 'top-right');

  // -------- Routing ----------------------------------------------------------
  const ROUTE_SRC = 'pinged-route-src';
  const ROUTE_LAYER = 'pinged-route-line';

  function renderRoute(geojson) {
    if (!geojson || !geojson.features?.[0]?.geometry?.coordinates?.length) return;
    stateStyle.routeGeoJSON = geojson;

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
    stateStyle.routeGeoJSON = null;
  }

  async function routeFromTo(fromLngLat, toLngLat) {
    try {
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
      setStatus('Routing failed', 3000, true);
    }
  }

  // -------- Beacons (right-click to add; right-click beacon to remove) ------
  const BEACON_KEY = 'pinged_beacons_v1';
  let beacons = [];
  const beaconMarkers = new Map();

  function loadBeacons() { try { beacons = JSON.parse(localStorage.getItem(BEACON_KEY) || '[]'); } catch { beacons = []; } }
  function saveBeacons() { try { localStorage.setItem(BEACON_KEY, JSON.stringify(beacons)); } catch { } }

  function clearAllBeacons() {
    beacons = [];
    saveBeacons();
    for (const [, m] of beaconMarkers) { try { m.remove(); } catch { } }
    beaconMarkers.clear();
    setStatus('All beacons cleared');
  }

  function deleteBeacon(id) {
    beacons = beacons.filter(b => b.id !== id);
    saveBeacons();
    const m = beaconMarkers.get(id);
    if (m) { try { m.remove(); } catch { } beaconMarkers.delete(id); }
    setStatus('Beacon removed');
  }

  function placeBeaconMarker(b) {
    if (beaconMarkers.has(b.id)) { beaconMarkers.get(b.id).setLngLat([b.lng, b.lat]); return; }
    const el = document.createElement('div');
    el.className = 'beacon-marker';
    el.title = b.label || 'Beacon';
    el.dataset.id = b.id;

    // Left-click: small popup
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      new mapboxgl.Popup({ offset: 12 })
        .setLngLat([b.lng, b.lat])
        .setHTML(`
          <div class="mini-card">
            <div class="title">${b.label || 'Beacon'}</div>
            <div class="subtle">${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}</div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button id="bcp-route" class="btn small">Route from me</button>
              <button id="bcp-copy" class="btn small">Copy</button>
              <button id="bcp-del"  class="btn small">Delete</button>
            </div>
          </div>
        `)
        .addTo(map)
        .on('open', () => {
          setTimeout(() => {
            const r = document.getElementById('bcp-route');
            const c = document.getElementById('bcp-copy');
            const d = document.getElementById('bcp-del');
            if (r) r.onclick = () => {
              if (!state.meLngLat) { try { geolocate.trigger(); } catch { } return; }
              routeFromTo([state.meLngLat.lng, state.meLngLat.lat], [b.lng, b.lat]);
            };
            if (c) c.onclick = async () => {
              try { await navigator.clipboard.writeText(`${b.lat},${b.lng}`); setStatus('Copied coordinates'); }
              catch { setStatus('Copy failed'); }
            };
            if (d) d.onclick = () => deleteBeacon(b.id);
          }, 0);
        });
    });

    // Right-click ON the beacon removes it
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      deleteBeacon(b.id);
    });

    const m = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([b.lng, b.lat]).addTo(map);
    beaconMarkers.set(b.id, m);
  }

  function renderBeacons() { for (const b of beacons) placeBeaconMarker(b); }
  function addBeacon(lat, lng, label = '') {
    if (!isFinite(lat) || !isFinite(lng)) return;
    const b = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), lat, lng, label };
    beacons.push(b); saveBeacons(); placeBeaconMarker(b);
    setStatus('Beacon added');
  }

  loadBeacons();
  map.once('load', renderBeacons);

  // --- Long-press to open inline note form, then place beacon ----------------
  const HOLD_MS = 550;
  let holdTimer = null, holdLngLat = null, startXY = null, activeFormPopup = null;
  const canvas = map.getCanvas();

  function unproject(ev) {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    return map.unproject([x, y]);
  }

  function openBeaconForm(ll) {
    try { activeFormPopup?.remove(); } catch { }
    const popup = new mapboxgl.Popup({ offset: 12, closeOnClick: true })
      .setLngLat([ll.lng, ll.lat])
      .setHTML(`
        <div class="beacon-form">
          <div class="title" style="font-weight:600">Add beacon</div>
          <div class="subtle" style="opacity:.7;font-size:12px;margin-top:2px">
            ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}
          </div>
          <div class="row">
            <input id="bf-label" type="text" placeholder="Note (optional)">
            <button id="bf-add" class="btn">Add</button>
            <button id="bf-cancel" class="btn secondary">Cancel</button>
          </div>
        </div>
      `)
      .addTo(map);

    popup.on('open', () => {
      const inp = document.getElementById('bf-label');
      const add = document.getElementById('bf-add');
      const cancel = document.getElementById('bf-cancel');
      if (inp) inp.focus();
      if (add) add.onclick = () => { addBeacon(ll.lat, ll.lng, inp?.value?.trim() || ''); popup.remove(); };
      if (cancel) cancel.onclick = () => popup.remove();
      inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { add?.click(); } });
    });

    activeFormPopup = popup;
  }

  function startHold(ev) {
    if (ev.button === 2 || (ev.touches && ev.touches.length > 1)) return; // ignore right-click & multi-touch
    clearTimeout(holdTimer);
    startXY = [ev.clientX, ev.clientY];
    const ll = unproject(ev);
    holdLngLat = { lat: ll.lat, lng: ll.lng };
    holdTimer = setTimeout(() => openBeaconForm({ lat: holdLngLat.lat, lng: holdLngLat.lng }), HOLD_MS);
  }
  function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }
  function maybeCancelOnMove(ev) {
    if (!startXY) return;
    const dx = Math.abs(ev.clientX - startXY[0]);
    const dy = Math.abs(ev.clientY - startXY[1]);
    if (dx > 6 || dy > 6) cancelHold();
  }

  canvas.addEventListener('pointerdown', startHold);
  canvas.addEventListener('pointerup', cancelHold);
  canvas.addEventListener('pointerleave', cancelHold);
  canvas.addEventListener('pointermove', maybeCancelOnMove);

  // Right-click on the MAP drops a quick beacon (no note)
  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const ll = unproject(ev);
    addBeacon(ll.lat, ll.lng, '');
  });

  // -------- Icons ------------------------------------------------------------
  function svgCube() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l10 6v8l-10 6L2 16V8l10-6zm0 2.2L4 8v8l8 4.6 8-4.6V8l-8-3.8z"/></svg>`; }
  function svgLanes() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 7h5v2H2V7zm15 0h5v2h-5V7zM2 15h5v2H2v-2zm15 0h5v2h-5v-2zM11 2h2v20h-2z"/></svg>`; }
  function svgLayers() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l9 5-9 5-9-5 9-5zm0 8.5l9 5-9 5-9-5 9-5z"/></svg>`; }
  function svgTrash() { return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>`; }

  // Start location/watch
  startLivePuckWatch();
})();
