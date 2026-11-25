import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/app";
import { cachedJson, MemoryCache } from "../src/cache";
import { resetMappingCache } from "../src/mapping";

const NOW = () => new Date("2026-11-25T12:00:00Z");
const BASE = "https://addon.example";

function media(id: number) {
  return {
    id,
    idMal: null,
    title: { romaji: `Romaji ${id}`, english: id % 2 ? `English ${id}` : null, native: null },
    format: id === 3 ? "MOVIE" : "TV",
    status: "FINISHED",
    description: "Text<br>more",
    season: "FALL",
    seasonYear: 2026,
    startDate: { year: 2026, month: 10, day: 1 },
    episodes: 12,
    duration: 24,
    genres: ["Action"],
    averageScore: 80,
    isAdult: false,
    coverImage: { extraLarge: `https://img/${id}.jpg`, large: null },
    bannerImage: null,
  };
}

/** Fake network: AniList answers with three items, the mapping URL with a compact mapping. */
function fakeFetch() {
  const calls: Array<{ url: string; body?: { query: string; variables: Record<string, unknown> } }> = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("graphql.anilist.co")) {
      const list = [media(1), media(2), media(3)];
      const data = body.query.includes("mediaList")
        ? { Page: { pageInfo: { hasNextPage: false }, mediaList: list.map((m) => ({ media: m })) } }
        : { Page: { pageInfo: { hasNextPage: false }, media: list } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (url.includes("mapping.json")) {
      return new Response(JSON.stringify({ "1": 100, "2": [0, "tt0000002"] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  return { impl, calls };
}

async function get(path: string, deps: Parameters<typeof handleRequest>[2], env = {}) {
  const res = await handleRequest(new Request(BASE + path), env, deps);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  return { res, body };
}

describe("handleRequest", () => {
  beforeEach(() => resetMappingCache());

  it("serves the manifest with CORS and cache headers", async () => {
    const { res, body } = await get("/manifest.json", { cache: new MemoryCache(), now: NOW });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cdn-cache-control")).toContain("max-age=3600");
    expect(body.catalogs[0].extra[0].options[5]).toBe("Rok 2027");
    expect(body.catalogs.map((c: { id: string }) => c.id)).toContain("al_list_current");
  });

  it("turns the lists off with ANILIST_USER=-", async () => {
    const { body } = await get("/manifest.json", { cache: new MemoryCache(), now: NOW }, { ANILIST_USER: "-" });
    expect(body.catalogs.map((c: { id: string }) => c.id)).toEqual(["al_popular", "al_top"]);
  });

  it("answers OPTIONS and redirects / to /configure", async () => {
    const opt = await handleRequest(new Request(BASE + "/manifest.json", { method: "OPTIONS" }), {}, { cache: new MemoryCache() });
    expect(opt.status).toBe(204);
    const root = await handleRequest(new Request(BASE + "/"), {}, { cache: new MemoryCache() });
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe(`${BASE}/configure`);
  });

  it("serves a season catalog with mapped ids and the right AniList variables", async () => {
    const net = fakeFetch();
    const deps = { cache: new MemoryCache(), now: NOW, fetchImpl: net.impl as never, anilist: { fetchImpl: net.impl as never } };
    const { res, body } = await get("/catalog/anime/al_top/genre=Podzim%202026.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cdn-cache-control")).toContain(`max-age=${6 * 3600}`);
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["kitsu:100", "tt0000002", "anilist:3"]);
    expect(body.metas[2].type).toBe("movie");
    expect(body.metas[0].name).toBe("English 1");
    expect(body.metas[1].name).toBe("Romaji 2");
    const gql = net.calls.find((c) => c.url.includes("anilist"))!.body!;
    expect(gql.variables).toMatchObject({ season: "FALL", seasonYear: 2026, sort: ["SCORE_DESC", "POPULARITY_DESC", "ID_DESC"], averageScore_greater: 0, page: 1, perPage: 50 });
  });

  it("caches AniList pages in memory", async () => {
    const net = fakeFetch();
    const deps = { cache: new MemoryCache(), now: NOW, fetchImpl: net.impl as never, anilist: { fetchImpl: net.impl as never } };
    await get("/catalog/anime/al_popular.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    await get("/catalog/anime/al_popular.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    expect(net.calls.filter((c) => c.url.includes("anilist")).length).toBe(1);
  });

  it("serves a user list for a user from the URL with the 15 min cache", async () => {
    const net = fakeFetch();
    const deps = { cache: new MemoryCache(), now: NOW, fetchImpl: net.impl as never, anilist: { fetchImpl: net.impl as never } };
    const { res, body } = await get("/u/SomeUser/catalog/anime/al_list_current/skip=0.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    expect(body.metas).toHaveLength(3);
    expect(res.headers.get("cdn-cache-control")).toContain("max-age=900");
    const gql = net.calls.find((c) => c.url.includes("anilist"))!.body!;
    expect(gql.variables).toMatchObject({ userName: "SomeUser", status_in: ["CURRENT", "REPEATING"] });
  });

  it("returns an empty catalog (not a 5xx) when AniList blocks us", async () => {
    const blocked = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "blocked", status: 403 }] }), { status: 403 }));
    const { res, body } = await get("/catalog/anime/al_popular.json", {
      cache: new MemoryCache(),
      fetchImpl: blocked as never,
      anilist: { fetchImpl: blocked as never },
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ metas: [] });
    expect(res.headers.get("cdn-cache-control")).toContain("max-age=60");
  });

  it("rejects bad user names and unknown paths", async () => {
    expect((await get("/u/a%3Cb/manifest.json", { cache: new MemoryCache() })).res.status).toBe(400);
    expect((await get("/nope", { cache: new MemoryCache() })).res.status).toBe(404);
  });
});

describe("MemoryCache", () => {
  it("expires entries and evicts the least recently used", () => {
    let t = 0;
    const c = new MemoryCache(2, () => t);
    c.set("a", 1, 10);
    c.set("b", 2, 10);
    expect(c.get("a")).toBe(1); // a is now most recent
    c.set("c", 3, 10); // evicts b
    expect(c.get("b")).toBeUndefined();
    t = 11_000;
    expect(c.get("a")).toBeUndefined();
  });

  it("shares one producer call between concurrent callers", async () => {
    const c = new MemoryCache();
    const producer = vi.fn(async () => 42);
    const [a, b] = await Promise.all([cachedJson(c, "k", 10, producer), cachedJson(c, "k", 10, producer)]);
    expect([a, b]).toEqual([42, 42]);
    expect(producer).toHaveBeenCalledTimes(1);
  });
});
