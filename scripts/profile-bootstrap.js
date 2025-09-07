// Ensure I have a profiles row (id = auth.uid()), creating one if missing.
async function ensureMyProfile(sb) {
    const { data: u } = await sb.auth.getUser();
    const user = u?.user;
    if (!user) return;

    // If row exists, stop (avoids touching username accidentally)
    const { data: existing, error: qerr } = await sb
        .from("profiles")
        .select("id, username")
        .eq("id", user.id)
        .maybeSingle();
    if (!qerr && existing) return;

    // Choose a base username (must be unique & NOT NULL)
    const raw = (user.email || "").split("@")[0] || `user-${user.id.slice(0, 6)}`;
    const base = raw.toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "") || `user_${user.id.slice(0, 6)}`;

    let candidate = base;

    // Use UPSERT to handle races; retry if username collides (23505)
    for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await sb
            .from("profiles")
            .upsert({
                id: user.id, // must equal auth.uid()
                username: candidate,
                display_name: user.user_metadata?.name || null,
                bio: null,
                avatar_url: null
                // privacy has a DEFAULT in DB
            }, { onConflict: "id" });

        if (!error) return;                             // success
        if (String(error.code) === "23505") {           // unique_violation (likely username)
            candidate = `${base}_${user.id.slice(0, 4 + attempt)}`;
            continue;
        }
        console.error("[ensureMyProfile] upsert failed:", error);
        return;
    }
    console.warn("[ensureMyProfile] username retries exhausted");
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
