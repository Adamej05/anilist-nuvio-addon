import { handleCatalog, parseExtra } from "./catalog";
import { TTL } from "./config";
import { configurePage } from "./configure";
import { buildManifest } from "./manifest";
import { getMapping } from "./mapping";

export interface Env {
  /** Default AniList user for the list catalogs (empty = no lists). */
  ANILIST_USER?: string;
  /** "true" adds the test catalog with two separate filters (rok + sezona). */
  ENABLE_SPLIT_FILTERS?: string;
  /** Compact mapping built by the GitHub Action. */
  MAPPING_URL: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;

function json(body: unknown, cacheSeconds: number, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
    },
  });
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method not allowed" }, 0, 405);
    }

    const url = new URL(request.url);
    let segments = url.pathname.split("/").filter(Boolean);

    // Optional per-user prefix: /u/<AniList user>/...
    let username = env.ANILIST_USER?.trim() || undefined;
    let usernameFromUrl = false;
    let base = url.origin;
    if (segments[0] === "u" && segments[1]) {
      const candidate = decodeSegment(segments[1]);
      if (!USERNAME_RE.test(candidate)) return json({ error: "invalid AniList user name" }, 0, 400);
      username = candidate;
      usernameFromUrl = true;
      base = `${url.origin}/u/${encodeURIComponent(candidate)}`;
      segments = segments.slice(2);
    }

    const splitEnabled = env.ENABLE_SPLIT_FILTERS === "true";

    try {
      if (segments.length === 0) return Response.redirect(`${base}/configure`, 302);

      if (segments.length === 1 && segments[0] === "configure") {
        return new Response(configurePage(url.origin, username), {
          headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (segments.length === 1 && segments[0] === "manifest.json") {
        // Built on every request, so a new year shows up without a deploy.
        return json(buildManifest({ now: new Date(), username, usernameFromUrl, splitEnabled }), TTL.manifest);
      }

      if (segments[0] === "catalog" && (segments.length === 3 || segments.length === 4)) {
        const type = decodeSegment(segments[1]!);
        const last = segments[segments.length - 1]!;
        if (!last.endsWith(".json")) return json({ error: "not found" }, 0, 404);
        const id = segments.length === 3 ? decodeSegment(last.slice(0, -5)) : decodeSegment(segments[2]!);
        const extra = segments.length === 4 ? parseExtra(last.slice(0, -5)) : {};

        const result = await handleCatalog(type, id, extra, {
          origin: url.origin,
          exec: ctx,
          username,
          splitEnabled,
          getMapping: () => getMapping(env.MAPPING_URL, ctx),
        });
        return json({ metas: result.metas }, result.cacheSeconds);
      }

      return json({ error: "not found" }, 0, 404);
    } catch (err) {
      console.error("request failed", url.pathname, err);
      // Stremio clients cope better with an empty catalog than with a 5xx.
      if (segments[0] === "catalog") return json({ metas: [] }, 60);
      return json({ error: "internal error" }, 0, 500);
    }
  },
} satisfies ExportedHandler<Env>;
