/* Author: Logan Poole — 30083609
   FILE: /scripts/config.js */
window.PINGED_CONFIG = {
  SUPABASE_URL: 'https://chqfdnicmdyvuidnnllh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNocWZkbmljbWR5dnVpZG5ubGxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyMDU4MDIsImV4cCI6MjA3Mjc4MTgwMn0.6Yc9n93ar_IvgeHoCQM_EEu_G1WB9fs35jXGydn-vkE',

  TABLES: {
    PROFILES: 'profiles',
    POSTS: 'posts',
    CONVERSATIONS: 'conversations',
    PARTICIPANTS: 'conversation_participants',
    MESSAGES: 'messages',
    FRIENDSHIPS: 'friendships'
  },

  PROFILE: {
    AVATAR_COLUMN: 'avatar_url',
    DISPLAY_NAME_KEYS: ['display_name', 'username']
  },

  ROUTES: {
    LOGIN: 'index.html',
    DASHBOARD: 'dashboard.html'
  },

  FUNCTIONS_BASE: undefined,
  MAPBOX_PUBLIC_TOKEN: 'pk.eyJ1IjoibG9nYW5wb29sZSIsImEiOiJjbWR3ZjNmamkyNDRmMmtwenl5MW41MDZxIn0.gRso7kVTaJfJWYAA7ruRjw',
  MAPBOX_ACCESS_TOKEN:  'pk.eyJ1IjoibG9nYW5wb29sZSIsImEiOiJjbWR3ZjNmamkyNDRmMmtwenl5MW41MDZxIn0.gRso7kVTaJfJWYAA7ruRjw'
};
