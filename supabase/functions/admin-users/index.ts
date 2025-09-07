// supabase/functions/admin-users/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, preflight, allowOrigin } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
const json = (data: Json, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": origin,
    },
  });

function sbFromReq(req: Request) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}
function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE);
}

async function getRequester(req: Request) {
  const supabase = sbFromReq(req);
  const { data } = await supabase.auth.getUser();
  return data.user;
}
async function isAdmin(userId: string) {
  // service role bypasses RLS
  const svc = adminClient();
  const { data } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data && (data.role === "admin" || data.role === "super_admin");
}

// Narrow user payload
function safeUser(u: any) {
  return {
    id: u.id,
    email: u.email ?? null,
    created_at: u.created_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    banned_until: u.banned_until ?? null,
    user_metadata: {
      username: u.user_metadata?.username ?? null,
      display_name: u.user_metadata?.display_name ?? null,
      profile_pic: u.user_metadata?.profile_pic ?? null,
    },
  };
}

// Robust profiles upsert: first try user_id, then retry with id if schema uses that key
async function upsertProfileRow(
  svc: ReturnType<typeof adminClient>,
  userId: string,
  user_metadata: any,
) {
  const common = {
    username: user_metadata?.username ?? null,
    display_name: user_metadata?.display_name ?? null,
    profile_pic: user_metadata?.profile_pic ?? null,
  };

  let { error } = await svc
    .from("profiles")
    .upsert({ user_id: userId, ...common }, { onConflict: "user_id" });

  if (
    error &&
    (error.code === "42703" ||
      /column .* does not exist/i.test(error.message || "") ||
      error.code === "PGRST204")
  ) {
    // Retry against id PK shape
    const { error: e2 } = await svc
      .from("profiles")
      .upsert({ id: userId, ...common }, { onConflict: "id" });
    if (e2) throw e2;
  } else if (error) {
    throw error;
  }
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
    if (page > 200) break; // hard cap
  }
  return { users: all, total };
}

serve(async (req: Request) => {
  const origin = allowOrigin(req);
  if (req.method === "OPTIONS") return cors(preflight(), origin);
  if (!origin) return json({ error: "Origin not allowed" }, 403, "*");

  try {
    const user = await getRequester(req);
    if (!user) return json({ error: "Unauthorized" }, 401, origin);
    if (!(await isAdmin(user.id))) return json({ error: "Forbidden (admin only)" }, 403, origin);

    const url = new URL(req.url);
    const search = url.searchParams;
    const svc = adminClient();

    // -- Lightweight "who am I" (helpful in UI debugging)
    if (req.method === "GET" && search.get("who") === "1") {
      const roleRow = await svc
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      return json({ user: { id: user.id, email: user.email }, role: roleRow.data?.role ?? null }, 200, origin);
    }

    // -- STATS
    if (req.method === "GET" && search.get("stats") === "1") {
      const { users } = await fetchAllUsers();
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

      const { data: roles } = await svc.from("user_roles").select("user_id, role");
      const admins = new Set(
        (roles ?? [])
          .filter((r) => r.role === "admin" || r.role === "super_admin")
          .map((r) => r.user_id),
      );

      let total_users = users.length;
      let banned = 0;
      let active_24h = 0;
      let active_30d = 0;
      let new_7d = 0;
      let admin_count = admins.size;

      const days: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
        days[d.toISOString().slice(0, 10)] = 0;
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

      const recent_logins = users
        .filter((u) => !!u.last_sign_in_at)
        .sort(
          (a, b) =>
            new Date(b.last_sign_in_at!).getTime() -
            new Date(a.last_sign_in_at!).getTime(),
        )
        .slice(0, 20)
        .map((u) => ({ id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at }));

      return json(
        {
          totals: { total_users, admins: admin_count, banned, active_24h, active_30d, new_7d },
          signups_by_day: Object.entries(days).map(([date, count]) => ({ date, count })),
          recent_logins,
        },
        200,
        origin,
      );
    }

    // -- ROLE MANAGEMENT
    if (req.method === "POST" && search.get("action") === "set_role") {
      const body = await req.json().catch(() => ({}));
      const user_id = String(body.user_id || "");
      const role = String(body.role || "");
      const allowed = new Set(["user", "admin", "super_admin"]);
      if (!user_id || !allowed.has(role)) return json({ error: "Bad input" }, 400, origin);

      const { error } = await svc.from("user_roles").upsert({ user_id, role });
      if (error) return json({ error: error.message }, 400, origin);
      return json({ ok: true }, 200, origin);
    }

    // -- LIST USERS
    if (req.method === "GET") {
      const page = Math.max(1, Number(search.get("page") ?? "1"));
      const perPage = Math.min(200, Math.max(1, Number(search.get("perPage") ?? "50")));
      const q = (search.get("q") ?? "").toLowerCase();

      const { data, error } = await svc.auth.admin.listUsers({ page, perPage });
      if (error) return json({ error: error.message }, 400, origin);

      let users = (data.users ?? []).map(safeUser);
      if (q) {
        users = users.filter(
          (u) =>
            (u.email ?? "").toLowerCase().includes(q) ||
            (u.user_metadata?.username ?? "").toLowerCase().includes(q) ||
            (u.user_metadata?.display_name ?? "").toLowerCase().includes(q),
        );
      }
      return json({ users, page, perPage, total: data.total }, 200, origin);
    }

    // -- CREATE USER
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { email, password, email_confirm = false, user_metadata = {} } = body;
      if (!email) return json({ error: "email is required" }, 400, origin);

      const { data, error } = await svc.auth.admin.createUser({
        email,
        password,
        email_confirm: !!email_confirm,
        user_metadata,
      });
      if (error) return json({ error: error.message }, 400, origin);

      if (data.user?.id) {
        await upsertProfileRow(svc, data.user.id, user_metadata);
      }
      return json({ user: safeUser(data.user) }, 201, origin);
    }

    // -- UPDATE USER
    if (req.method === "PATCH") {
      const id = search.get("id");
      if (!id) return json({ error: "id is required" }, 400, origin);
      const body = await req.json().catch(() => ({}));

      const { data, error } = await svc.auth.admin.updateUserById(id, body);
      if (error) return json({ error: error.message }, 400, origin);

      // Optionally sync profile metadata if provided
      if (data.user?.id && body?.user_metadata) {
        try {
          await upsertProfileRow(svc, data.user.id, body.user_metadata);
        } catch { /* non-fatal */ }
      }

      return json({ user: safeUser(data.user) }, 200, origin);
    }

    // -- DELETE USER
    if (req.method === "DELETE") {
      const id = search.get("id");
      if (!id) return json({ error: "id is required" }, 400, origin);
      const { error } = await svc.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400, origin);
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "Method not allowed" }, 405, origin);
  } catch (err) {
    console.error("[admin-users] error", err);
    return json({ error: "Server error" }, 500, "*");
  }
});
