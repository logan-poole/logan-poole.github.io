// Central CORS helper for Edge Functions.
//
// Allow local dev + your production origin(s) by default.
// You can override with a comma-separated ALLOWED_ORIGINS secret.
// Set ALLOW_ANY_ORIGIN=1 during local development if you want to disable checks.

const DEFAULT_ALLOWED = [
  // Local (adjust as needed)
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  // GitHub Pages (your site)
  "https://logan-poole.github.io",
];

function truthy(v?: string | null) {
  return !!v && /^(1|true|yes)$/i.test(v);
}

function readAllowedFromEnv(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") || "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ALLOWED;
}

/** Returns the allowed origin string if permitted, or "" if not allowed. */
export function allowOrigin(req: Request): string {
  // Optional bypass (local dev): ALLOW_ANY_ORIGIN=1
  if (truthy(Deno.env.get("ALLOW_ANY_ORIGIN"))) {
    return req.headers.get("origin") ?? "*";
  }

  const origin = req.headers.get("origin") ?? "";
  if (!origin) return ""; // non-browser or missing Origin
  const allowed = readAllowedFromEnv();
  return allowed.includes(origin) ? origin : "";
}

export function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*", // reflected later for actual requests
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "3600",
    },
  });
}

export function cors(res: Response, origin = "*") {
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", origin || "*");
  headers.set("vary", "origin");
  return new Response(res.body, { status: res.status, headers });
}
