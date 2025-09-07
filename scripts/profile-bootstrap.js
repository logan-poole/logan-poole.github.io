// Ensure I have a profiles row (user_id = auth.uid()), creating one if missing.
async function ensureMyProfile(sb) {
  try {
    const { data: u } = await sb.auth.getUser();
    const user = u?.user;
    if (!user) return;

    // If row exists, stop (avoid touching username accidentally)
    const { data: existing, error: qerr } = await sb
      .from("profiles")
      .select("user_id, username")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!qerr && existing) return;

    // Choose a base username (must be unique & NOT NULL)
    const rawLocal = (user.email || "").split("@")[0] || `user-${user.id.slice(0, 6)}`;
    const base = rawLocal
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || `user_${user.id.slice(0, 6)}`;

    let candidate = base;

    // UPSERT with conflict on user_id; retry on username unique_violation (23505)
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await sb
        .from("profiles")
        .upsert(
          {
            user_id: user.id, // must equal auth.uid()
            username: candidate,
            display_name: user.user_metadata?.name || null,
            profile_pic: null, // store a STORAGE PATH here, e.g. "avatars/<uid>/<file>"
          },
          { onConflict: "user_id" }
        );

      if (!error) return; // success

      if (String(error.code) === "23505") {
        // likely username unique violation; try a slightly different suffix
        candidate = `${base}_${user.id.slice(0, 4 + attempt)}`;
        continue;
      }

      console.error("[ensureMyProfile] upsert failed:", error);
      return;
    }

    console.warn("[ensureMyProfile] username retries exhausted");
  } catch (err) {
    console.error("[ensureMyProfile] unexpected error:", err);
  }
}

// Wire it once after sb-client.js
(function () {
  const sb = (typeof window.getSB === "function" ? window.getSB() : window.__sb);
  if (!sb) return;

  // Run immediately for existing session
  sb.auth.getSession().then(({ data }) => {
    if (data?.session?.user) ensureMyProfile(sb);
  });

  // And whenever auth state changes
  sb.auth.onAuthStateChange((_e, sess) => {
    if (sess?.user) ensureMyProfile(sb);
  });
})();
