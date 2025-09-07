

/* scripts/config.js

*/
(function () {
  const cfg = {

    FUNCTIONS_BASE: "https://chqfdnicmdyvuidnnllh.functions.supabase.co", 
    
    /* === Supabase project === */
    SUPABASE_URL: "https://chqfdnicmdyvuidnnllh.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNocWZkbmljbWR5dnVpZG5ubGxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyMDU4MDIsImV4cCI6MjA3Mjc4MTgwMn0.6Yc9n93ar_IvgeHoCQM_EEu_G1WB9fs35jXGydn-vkE",

    /* === Third-party tokens =================================================== */
    MAPBOX_ACCESS_TOKEN: "pk.eyJ1IjoibG9nYW5wb29sZSIsImEiOiJjbWR3ZjNmamkyNDRmMmtwenl5MW41MDZxIn0.gRso7kVTaJfJWYAA7ruRjw",

/* === Storage buckets === */
    BUCKETS: {
      AVATARS: "avatars",
      DM_MEDIA: "dm-media",
      CHAT_MEDIA: "dm-media"
    },

    /* === Database tables / views === */
    TABLES: {
      PROFILES: "profiles",
      POSTS: "posts",
      FOLLOWS: "follows",
      FRIENDS_VIEW: "friends_ui", // optional view; scripts auto-fallback if missing
      CONVERSATIONS: "conversations",
      PARTICIPANTS: "conversation_participants",
      MESSAGES: "messages",
      LIVE_LOCATIONS: "live_locations"
    }
  };

  window.PINGED_CONFIG = cfg;
  window.PINGED = window.PINGED || cfg; // back-compat alias

})();

