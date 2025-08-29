
(function () {
  const cfg = {
    // --- Supabase ---
    SUPABASE_URL: "https://llbdztswyuwcbyykdrdk.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmR6dHN3eXV3Y2J5eWtkcmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0NDY5NDksImV4cCI6MjA3MjAyMjk0OX0.hP97oiseOeXrg6tHa7exLSU6eAjFZpj6oKVvbdvDY0I",

    // --- Mapbox ---
    MAPBOX_ACCESS_TOKEN: "pk.eyJ1IjoibG9nYW5wb29sZSIsImEiOiJjbWR3ZjNmamkyNDRmMmtwenl5MW41MDZxIn0.gRso7kVTaJfJWYAA7ruRjw",

  // --- Profile table mapping ---
    PROFILE: {
      TABLE: "profiles", //Table name
      ID_COLUMN: "user_id", //User column
      AVATAR_COLUMN: "profile_pic", //Avatar
      
      COLUMNS: [
        "username",
        "display_name",
        "website",
        "bio",
        "visibility",
        "findable_by_email",
        "profile_pic"             
      ]
    }
  };

  // Export for the rest of the app
  window.PINGED_CONFIG = cfg;
  // Back-compat if something still reads window.PINGED
  window.PINGED = window.PINGED || cfg;

  // Helpful hint if misconfigured
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error("[config] SUPABASE_URL / SUPABASE_ANON_KEY are empty. Edit scripts/config.js.");
  }
})();
