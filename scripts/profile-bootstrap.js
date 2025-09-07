// Ensure I have a profiles row (user_id = auth.uid()), creating one if missing.
async function ensureMyProfile(sb) {
  const { data: u } = await sb.auth.getUser();
  const user = u?.user;
  if (!user) return;

  // If row exists, stop
  const { data: existing, error: qerr } = await sb
    .from("profiles")
    .select("user_id, username")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!qerr && existing) return;

  const raw = (user.email || "").split("@")[0] || `user-${user.id.slice(0, 6)}`;
  const base = (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || `user_${user.id.slice(0, 6)}`;
  let candidate = base;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await sb
      .from("profiles")
      .upsert(
        {
          user_id: user.id,                 // ← key in DB
          username: candidate,
          display_name: user.user_metadata?.name || null,
          bio: null,
          avatar_url: null
        },
        { onConflict: "user_id" }           // ← matches unique/PK
      );

    if (!error) return;
    if (String(error.code) === "23505") {   // username collision
      candidate = `${base}_${user.id.slice(0, 4 + attempt)}`;
      continue;
    }
    console.error("[ensureMyProfile] upsert failed:", error);
    return;
  }
  console.warn("[ensureMyProfile] username retries exhausted");
}

(function () {
  const sb = window.getSB?.();
  if (!sb) return;
  sb.auth.getSession().then(({ data }) => {
    if (data?.session?.user) ensureMyProfile(sb);
  });
  sb.auth.onAuthStateChange((_e, sess) => {
    if (sess?.user) ensureMyProfile(sb);
  });
})();
