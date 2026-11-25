import type { RequestDeps } from "./anilist";
import type { JsonCache } from "./cache";
import { coverUrlFromPath, BADGE_CODES_RE, renderBadgedPoster } from "./badges";
import { getCollection, handleCatalog, parseExtra } from "./catalog";
import { DEFAULT_ANILIST_USER, DEFAULT_ENABLE_SPLIT_FILTERS, DEFAULT_MAPPING_URL, TTL } from "./config";
import { configurePage } from "./configure";
import { buildManifest } from "./manifest";
import { getMapping } from "./mapping";
import { handleMeta } from "./metaHandler";

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
      // Built on every request, so a new year (and a new custom list) shows up without a deploy.
      let customLists: string[] = [];
      if (username) {
        try {
          customLists = (await getCollection(deps.cache, username, deps.anilist)).customListNames;
        } catch (err) {
          console.warn("custom lists unavailable for manifest", err);
        }
      }
      return json(buildManifest({ now: now(), username, usernameFromUrl, splitEnabled, customLists }), TTL.manifest);
    }

    if (segments[0] === "meta" && segments.length === 3 && segments[2]!.endsWith(".json")) {
      const type = decodeSegment(segments[1]!);
      const id = decodeSegment(segments[2]!.slice(0, -5));
      const result = await handleMeta(type, id, {
        cache: deps.cache,
        username,
        getMapping: () => getMapping(mappingUrl, deps.fetchImpl),
        deps: deps.anilist,
      });
      // 404 lets Nuvio try the next metadata addon for ids we do not know.
      if (!result.meta) return json({ meta: null }, 600, 404);
      return json({ meta: result.meta }, result.cacheSeconds);
    }

    if (segments[0] === "poster" && segments.length >= 3) {
      return await posterResponse(segments[1]!, segments.slice(2).join("/"), deps.fetchImpl ?? fetch);
    }

    if (segments[0] === "catalog" && (segments.length === 3 || segments.length === 4)) {
      const type = decodeSegment(segments[1]!);
      const last = segments[segments.length - 1]!;
      if (!last.endsWith(".json")) return json({ error: "not found" }, 0, 404);
      const id = segments.length === 3 ? decodeSegment(last.slice(0, -5)) : decodeSegment(segments[2]!);
      const extra = segments.length === 4 ? parseExtra(last.slice(0, -5)) : {};

      const result = await handleCatalog(type, id, extra, {
        cache: deps.cache,
        origin: url.origin,
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

/** /poster/<codes>/<AniList cover path>: the AniList cover with status badges drawn in. */
async function posterResponse(codes: string, coverPath: string, fetchImpl: typeof fetch): Promise<Response> {
  const source = coverUrlFromPath(coverPath);
  if (!BADGE_CODES_RE.test(codes) || !source) return json({ error: "not found" }, 0, 404);
  const res = await fetchImpl(source);
  if (!res.ok) return new Response(null, { status: 302, headers: { ...CORS_HEADERS, Location: source } });
  let body: Buffer;
  try {
    body = renderBadgedPoster(new Uint8Array(await res.arrayBuffer()), codes);
  } catch (err) {
    console.warn("poster render failed", source, err);
    return new Response(null, { status: 302, headers: { ...CORS_HEADERS, Location: source } });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "image/jpeg",
      "Cache-Control": `public, max-age=${TTL.poster}, immutable`,
      "CDN-Cache-Control": `public, max-age=${TTL.poster}, immutable`,
    },
  });
}
