// scripts/admin-api.js
export async function withToken(sb) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session.access_token;
}

export async function fnUrl(path) {
  const base = (window.PINGED_CONFIG && window.PINGED_CONFIG.SUPABASE_URL) || '';
  return `${base}/functions/v1/${path}`;
}

export async function adminWho(sb) {
  const token = await withToken(sb);
  const res = await fetch(await fnUrl('admin-users?who=1'), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'who failed');
  return j;
}

export async function listUsers(sb, { page=1, perPage=50, q='' } = {}) {
  const token = await withToken(sb);
  const url = new URL(await fnUrl('admin-users'));
  url.searchParams.set('page', String(page));
  url.searchParams.set('perPage', String(perPage));
  if (q) url.searchParams.set('q', q);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'list failed');
  return j;
}

export async function setRole(sb, user_id, role) {
  const token = await withToken(sb);
  const url = await fnUrl('admin-users?action=set_role');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id, role })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'set_role failed');
  return j;
}

export async function createUser(sb, { email, password, email_confirm=false, user_metadata={} }) {
  const token = await withToken(sb);
  const url = await fnUrl('admin-users');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm, user_metadata })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'create failed');
  return j;
}

export async function updateUser(sb, id, payload) {
  const token = await withToken(sb);
  const url = new URL(await fnUrl('admin-users'));
  url.searchParams.set('id', id);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'update failed');
  return j;
}

export async function deleteUser(sb, id) {
  const token = await withToken(sb);
  const url = new URL(await fnUrl('admin-users'));
  url.searchParams.set('id', id);
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'delete failed');
  return j;
}

export async function getStats(sb) {
  const token = await withToken(sb);
  const url = await fnUrl('admin-users?stats=1');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'stats failed');
  return j;
}
