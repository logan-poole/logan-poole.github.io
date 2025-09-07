// supabase/functions/_shared/cors.ts

/**
 * Build permissive CORS headers, echoing the browser's request headers.
 * For production you can restrict "origin" to your domain.
 */
export function corsHeaders(req?: Request, originFallback = "*"): Headers {
  const h = new Headers();

  const origin = req?.headers.get("Origin") ?? originFallback;
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");

  // Echo back whatever headers the browser said it wants to send
  const requested = req?.headers.get("Access-Control-Request-Headers")
    ?? "authorization, x-client-info, apikey, content-type";
  h.set("Access-Control-Allow-Headers", requested);

  h.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  h.set("Access-Control-Max-Age", "86400"); // cache preflight for a day
  return h;
}

/** Return a simple 200 OK preflight with CORS headers */
export function ok(req?: Request): Response {
  return new Response("ok", { status: 200, headers: corsHeaders(req) });
}

/** Merge CORS headers into any response */
export function withCors(res: Response, req?: Request): Response {
  const headers = corsHeaders(req);
  // preserve existing headers from the response
  for (const [k, v] of res.headers) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
