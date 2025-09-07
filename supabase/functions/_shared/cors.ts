// supabase/functions/_shared/cors.ts
// Central CORS helper for Edge Functions.

const DEFAULT_ALLOWED = [
  // Local dev
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  // GitHub Pages (your site)
  "https://logan-poole.github.io",
  // You can add more production origins here:
  // "https://your-custom-domain.com",
];

function readAllowedFromEnv(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") || "";
  // Comma-separated list in a secret is supported, e.g.
  // ALLOWED_ORIGINS="https://a.com,https://b.com"
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ALLOWED;
}

export function allowOrigin(req: Request): string {
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
