import type { RequestDeps } from "./anilist";
import type { JsonCache } from "./cache";
import { handleCatalog, parseExtra } from "./catalog";
import { DEFAULT_ANILIST_USER, DEFAULT_ENABLE_SPLIT_FILTERS, DEFAULT_MAPPING_URL, TTL } from "./config";
import { configurePage } from "./configure";
import { buildManifest } from "./manifest";
import { getMapping } from "./mapping";

/** Platform-independent request handler (Web Request -> Response). */

export interface AppEnv {
  ANILIST_USER?: string;
  ENABLE_SPLIT_FILTERS?: string;
  MAPPING_URL?: string;
}

export interface AppDeps {
  cache: JsonCache;
  now?: () => Date;
  anilist?: RequestDeps;
  fetchImpl?: typeof fetch;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;

/**
 * Cache-Control for the client plus CDN-Cache-Control for Vercel's CDN,
 * which then serves repeated catalog requests without running the function.
 */
function json(body: unknown, cacheSeconds: number, status = 200): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  };
  if (cacheSeconds > 0) {
    headers["Cache-Control"] = `public, max-age=${Math.min(cacheSeconds, 3600)}`;
    headers["CDN-Cache-Control"] = `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}`;
  } else {
    headers["Cache-Control"] = "no-store";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function envUser(env: AppEnv): string | undefined {
  const value = env.ANILIST_USER?.trim();
  if (value === "-") return undefined;
  return value || DEFAULT_ANILIST_USER || undefined;
}

export async function handleRequest(request: Request, env: AppEnv, deps: AppDeps): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method not allowed" }, 0, 405);
  }

  const url = new URL(request.url);
  let segments = url.pathname.split("/").filter(Boolean);

  // Optional per-user prefix: /u/<AniList user>/...
  let username = envUser(env);
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

  const splitEnabled = env.ENABLE_SPLIT_FILTERS
    ? env.ENABLE_SPLIT_FILTERS === "true"
    : DEFAULT_ENABLE_SPLIT_FILTERS;
  const mappingUrl = env.MAPPING_URL?.trim() || DEFAULT_MAPPING_URL;
  const now = deps.now ?? (() => new Date());

  try {
    if (segments.length === 0) {
      return new Response(null, { status: 302, headers: { ...CORS_HEADERS, Location: `${base}/configure` } });
    }

    if (segments.length === 1 && segments[0] === "configure") {
      return new Response(configurePage(url.origin, username), {
        headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      });
    }

    if (segments.length === 1 && segments[0] === "manifest.json") {
      // Built on every request, so a new year shows up without a deploy.
      return json(buildManifest({ now: now(), username, usernameFromUrl, splitEnabled }), TTL.manifest);
    }

    if (segments[0] === "catalog" && (segments.length === 3 || segments.length === 4)) {
      const type = decodeSegment(segments[1]!);
      const last = segments[segments.length - 1]!;
      if (!last.endsWith(".json")) return json({ error: "not found" }, 0, 404);
      const id = segments.length === 3 ? decodeSegment(last.slice(0, -5)) : decodeSegment(segments[2]!);
      const extra = segments.length === 4 ? parseExtra(last.slice(0, -5)) : {};

      const result = await handleCatalog(type, id, extra, {
        cache: deps.cache,
        username,
        splitEnabled,
        getMapping: () => getMapping(mappingUrl, deps.fetchImpl),
        deps: deps.anilist,
      });
      return json({ metas: result.metas }, result.cacheSeconds);
    }

    return json({ error: "not found" }, 0, 404);
  } catch (err) {
    console.error("request failed", url.pathname, err);
    // Stremio clients cope better with an empty catalog than with a 5xx;
    // a short CDN cache keeps a failing AniList from being hammered.
    if (segments[0] === "catalog") return json({ metas: [] }, 60);
    return json({ error: "internal error" }, 0, 500);
  }
}
