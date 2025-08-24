// scripts/config.js
(function () {
  const cfg = {
    // --- Required ---
    SUPABASE_URL: "https://upacsqjjvlssyxiasbzw.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwYWNzcWpqdmxzc3l4aWFzYnp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0NTM5MzksImV4cCI6MjA2ODAyOTkzOX0.iJ_ykF_SSsRylvccCo7u9KC7-vQBf7G8lPUaFUrPgn4",

    MAPBOX_ACCESS_TOKEN: "pk.eyJ1IjoibG9nYW5wb29sZSIsImEiOiJjbWR3ZjNmamkyNDRmMmtwenl5MW41MDZxIn0.gRso7kVTaJfJWYAA7ruRjw",

    // --- Optional: only set this if you really have such a table/columns ---
    // PROFILE: { TABLE: 'profiles', ID_COLUMN: 'user_id', FIELDS: 'display_name,username,profile_pic,avatar_url' }
  };

  // What the rest of the app expects:
  window.PINGED_CONFIG = cfg;

  // Back-compat if anything still reads window.PINGED:
  window.PINGED = window.PINGED || cfg;
})();
