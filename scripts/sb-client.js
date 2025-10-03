/* Author: Logan Poole — 30083609
   FILE: /scripts/sb-client.js
   Purpose:
   - Stable Supabase AUTH client (session).
   - PostgREST bridge that prefers the user's access_token.
   - Expose sbUser/sbAccessToken and guard helper. */
(function () {
  'use strict';

  const CFG  = window.PINGED_CONFIG || {};
  const RAW  = (CFG.SUPABASE_URL || '').trim().replace(/\/+$/,'');
  const KEY  = CFG.SUPABASE_ANON_KEY || '';
  let BASE;
  try { BASE = new URL(RAW).origin; } catch { BASE = RAW; }

  // Globals used by other scripts
  window.sbUser = window.sbUser || null;
  window.sbAccessToken = window.sbAccessToken || null;

  function headers(json = true) {
    const token = window.sbAccessToken || KEY; // prefer session token
    const h = { apikey: KEY, Authorization: 'Bearer ' + token };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function qs(obj) {
    const u = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k,v]) => u.append(k, v));
    return u.toString();
  }

  async function rget(table, params) {
    const query = qs(params);
    const url = BASE + '/rest/v1/' + table + (query ? ('?' + query) : '');
    const r = await fetch(url, { headers: headers(false) });
    if (!r.ok) throw new Error('GET ' + table + ' -> ' + r.status);
    return r.json();
  }
  async function rpost(table, body, preferReturn = true) {
    const url = BASE + '/rest/v1/' + table;
    const h = headers(true);
    if (preferReturn) h.Prefer = 'return=representation';
    const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('POST ' + table + ' -> ' + r.status);
    return r.json();
  }
  async function rpatch(table, body, params, preferReturn = true) {
    const url = BASE + '/rest/v1/' + table + (params ? ('?' + qs(params)) : '');
    const h = headers(true);
    if (preferReturn) h.Prefer = 'return=representation';
    const r = await fetch(url, { method: 'PATCH', headers: h, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('PATCH ' + table + ' -> ' + r.status);
    return r.json();
  }
  async function rdel(table, params, preferReturn = true) {
    const url = BASE + '/rest/v1/' + table + (params ? ('?' + qs(params)) : '');
    const h = headers(false);
    if (preferReturn) h.Prefer = 'return=representation';
    const r = await fetch(url, { method: 'DELETE', headers: h });
    if (!r.ok) throw new Error('DELETE ' + table + ' -> ' + r.status);
    return r.json();
  }

  function SelectBuilder(table) { this.table = table; this._params = {}; }
  SelectBuilder.prototype.select = function (cols) { this._params.select = cols || '*'; return this; };
  SelectBuilder.prototype.eq     = function (col,val){ this._params[col] = 'eq.' + val; return this; };
  SelectBuilder.prototype.in     = function (col,csv){ this._params[col] = 'in.(' + csv + ')'; return this; };
  SelectBuilder.prototype.or     = function (expr)  { this._params.or = expr; return this; };
  SelectBuilder.prototype.order  = function (col,dir){ this._params.order = col + '.' + ((dir||'asc').toLowerCase()); return this; };
  SelectBuilder.prototype.limit  = function (n)     { this._params.limit = String(n); return this; };
  SelectBuilder.prototype.then   = function (res,rej){ return rget(this.table, this._params).then(res, rej); };

  function Bridge(){}
  Bridge.prototype.from   = function (t){ return new SelectBuilder(t); };
  Bridge.prototype.insert = function (t,b){ return rpost(t,b); };
  Bridge.prototype.update = function (t,b,p){ return rpatch(t,b,p); };
  Bridge.prototype.delete = function (t,p){ return rdel(t,p); };

  window.sbRest = new Bridge();

  // Auth client
  let __sb = { auth: { getSession: async()=>({data:{session:null}}),
                       onAuthStateChange: ()=>({data:{subscription:{unsubscribe(){}}}}) } };
  try {
    if (BASE && KEY && window.supabase && typeof window.supabase.createClient === 'function') {
      __sb = window.supabase.createClient(BASE, KEY, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
      });
    } else {
      console.error('[sb-client] Missing SUPABASE_URL/KEY or supabase-js not loaded.');
    }
  } catch (e) { console.error('[sb-client] createClient failed:', e); }

  async function syncSession() {
    try {
      const { data } = await __sb.auth.getSession();
      const sess = data && data.session;
      window.sbAccessToken = (sess && sess.access_token) || null;
      window.sbUser = (sess && sess.user) || null;
      window.dispatchEvent(new CustomEvent('sb:session', { detail: { user: window.sbUser }}));
    } catch (e) {
      window.sbAccessToken = null; window.sbUser = null;
    }
  }

  try {
    __sb.auth.onAuthStateChange((_event, session) => {
      window.sbAccessToken = (session && session.access_token) || null;
      window.sbUser = (session && session.user) || null;
      window.dispatchEvent(new CustomEvent('sb:session', { detail: { user: window.sbUser }}));
    });
  } catch (e) { console.warn('[sb-client] onAuthStateChange failed:', e); }

  window.guardRequireAuth = async function guardRequireAuth(opts = {}) {
    const redirectTo = opts.redirectTo || (CFG.ROUTES && CFG.ROUTES.LOGIN) || 'index.html';
    await syncSession();
    if (!window.sbUser) {
      location.replace(redirectTo);
      throw new Error('[auth-guard] Not authenticated: redirecting to ' + redirectTo);
    }
  };

  window.getSB = () => __sb;
  syncSession().finally(() => window.dispatchEvent(new Event('sb:ready')));
})();
