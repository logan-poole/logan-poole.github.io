import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, preflight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
const json = (data: Json, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function sbFromReq(req: Request) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}
function adminClient() { return createClient(SUPABASE_URL, SERVICE_ROLE); }

async function getRequester(req: Request) {
  const supabase = sbFromReq(req);
  const { data } = await supabase.auth.getUser();
  return data.user;
}

async function isAdmin(userId: string) {
  const svc = adminClient();
  const { data } = await svc.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  return !!data && (data.role === "admin" || data.role === "super_admin");
}

async function fetchAllUsers() {
  const svc = adminClient();
  const perPage = 200;
  let page = 1;
  let all: any[] = [];
  let total = 0;

  while (true) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const chunk = data.users ?? [];
    total = data.total ?? Math.max(total, all.length + chunk.length);
    all = all.concat(chunk);
    if (chunk.length < perPage) break;
    page += 1;
    // Safety stop to avoid infinite loops
    if (page > 200) break;
  }
  return { users: all, total };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return cors(preflight());

  try {
    const user = await getRequester(req);
    if (!user) return cors(json({ error: "Unauthorized" }, 401));
    if (!(await isAdmin(user.id))) return cors(json({ error: "Forbidden (admin only)" }, 403));

    const url = new URL(req.url);
    const search = url.searchParams;
    const svc = adminClient();

    // --------- STATS (GET ?stats=1) ----------
    if (req.method === "GET" && search.get("stats") === "1") {
      const { users } = await fetchAllUsers();

      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

      // roles
      const { data: roles } = await svc.from("user_roles").select("user_id, role");
      const admins = new Set((roles ?? []).filter(r => r.role === "admin" || r.role === "super_admin").map(r => r.user_id));

      // metrics
      let total_users = users.length;
      let banned = 0;
      let active_24h = 0;
      let active_30d = 0;
      let new_7d = 0;
      let admin_count = admins.size;

      // signups histogram for last 30 days
      const days: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
        const key = d.toISOString().slice(0, 10);
        days[key] = 0;
      }

      for (const u of users) {
        const created = new Date(u.created_at);
        const last = u.last_sign_in_at ? new Date(u.last_sign_in_at) : null;
        if (u.banned_until) banned++;
        if (last && last >= dayAgo) active_24h++;
        if (last && last >= monthAgo) active_30d++;
        if (created >= weekAgo) new_7d++;

        const key = created.toISOString().slice(0, 10);
        if (key in days) days[key] += 1;
      }

      // recent logins (top 20)
      const recent_logins = users
        .filter(u => !!u.last_sign_in_at)
        .sort((a, b) => (new Date(b.last_sign_in_at!).getTime() - new Date(a.last_sign_in_at!).getTime()))
        .slice(0, 20)
        .map(u => ({ id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at }));

      return cors(json({
        totals: { total_users, admins: admin_count, banned, active_24h, active_30d, new_7d },
        signups_by_day: Object.entries(days).map(([date, count]) => ({ date, count })),
        recent_logins
      }));
    }

    // --------- LIST USERS (existing) ----------
    if (req.method === "GET") {
      const page = Math.max(1, Number(search.get("page") ?? "1"));
      const perPage = Math.min(200, Math.max(1, Number(search.get("perPage") ?? "50")));
      const q = (search.get("q") ?? "").toLowerCase();

      const { data, error } = await svc.auth.admin.listUsers({ page, perPage });
      if (error) return cors(json({ error: error.message }, 400));

      let users = data.users ?? [];
      if (q) {
        users = users.filter(u =>
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.user_metadata?.username ?? "").toLowerCase().includes(q) ||
          (u.user_metadata?.display_name ?? "").toLowerCase().includes(q)
        );
      }
      return cors(json({ users, page, perPage, total: data.total }));
    }

    // --------- CREATE USER (existing) ----------
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { email, password, email_confirm = false, user_metadata = {} } = body;
      if (!email) return cors(json({ error: "email is required" }, 400));

      const { data, error } = await svc.auth.admin.createUser({
        email,
        password,
        email_confirm: !!email_confirm,
        user_metadata,
      });
      if (error) return cors(json({ error: error.message }, 400));

      if (data.user?.id) {
        await svc.from("profiles").upsert({
          user_id: data.user.id,
          username: user_metadata.username ?? null,
          display_name: user_metadata.display_name ?? null,
          profile_pic: user_metadata.profile_pic ?? null,
        });
      }
      return cors(json({ user: data.user }, 201));
    }

    // --------- UPDATE USER (existing) ----------
    if (req.method === "PATCH") {
      const id = search.get("id");
      if (!id) return cors(json({ error: "id is required" }, 400));
      const body = await req.json().catch(() => ({}));

      const { data, error } = await svc.auth.admin.updateUserById(id, body);
      if (error) return cors(json({ error: error.message }, 400));

      if (data.user?.id && body.user_metadata) {
        await svc.from("profiles").upsert({
          user_id: data.user.id,
          username: body.user_metadata.username ?? undefined,
          display_name: body.user_metadata.display_name ?? undefined,
          profile_pic: body.user_metadata.profile_pic ?? undefined,
        });
      }
      return cors(json({ user: data.user }));
    }

    // --------- DELETE USER (existing) ----------
    if (req.method === "DELETE") {
      const id = search.get("id");
      if (!id) return cors(json({ error: "id is required" }, 400));
      const { error } = await svc.auth.admin.deleteUser(id);
      if (error) return cors(json({ error: error.message }, 400));
      return cors(json({ ok: true }));
    }

    return cors(json({ error: "Method not allowed" }, 405));
  } catch (err) {
    console.error("[admin-users] error", err);
    return cors(json({ error: "Server error" }, 500));
  }
});
