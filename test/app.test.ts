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
    coverImage: { extraLarge: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${id}-x.jpg`, large: null },
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
      let data: unknown;
      if (body.query.includes("MediaListCollection")) {
        data = {
          MediaListCollection: {
            hasNextChunk: false,
            user: { mediaListOptions: { animeList: { customLists: ["Duo", "Solo"] } } },
            lists: [
              {
                isCustomList: false,
                entries: [
                  { status: "COMPLETED", updatedAt: 30, customLists: [{ name: "Duo", enabled: true }], media: media(1) },
                  { status: "PLANNING", updatedAt: 20, customLists: [], media: media(2) },
                  { status: "CURRENT", updatedAt: 10, customLists: [], media: media(3) },
                ],
              },
            ],
          },
        };
      } else if (body.query.includes("Media(id:")) {
        data = {
          Media: {
            ...media(body.variables.id),
            episodes: 3,
            endDate: null,
            nextAiringEpisode: null,
            aired: { nodes: [] },
            upcoming: { nodes: [] },
            streamingEpisodes: [{ title: "Episode 2 - Second", thumbnail: "https://t/2.jpg" }],
            trailer: { id: "yt1", site: "youtube" },
            studios: { nodes: [{ name: "Studio" }] },
          },
        };
      } else {
        data = { Page: { pageInfo: { hasNextPage: false }, media: list } };
      }
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
    expect(res.headers.get("cdn-cache-control")).toContain("max-age=900");
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["alsz:1", "alsz:2", "alsz:3"]);
    // Badges from the user's list (default user): 1 completed + Duo, 2 planned, 3 watching.
    const codes = body.metas.map((m: { poster: string }) => m.poster.split("/poster/")[1]?.split("/")[0]);
    expect(codes).toEqual(["cu", "p", "w"]);
    expect(body.metas[0].poster.startsWith(`${BASE}/poster/cu/media/anime/cover/large/`)).toBe(true);
    expect(body.metas[2].type).toBe("movie");
    expect(body.metas[0].name).toBe("English 1");
    expect(body.metas[1].name).toBe("Romaji 2");
    const gql = net.calls.find((c) => c.url.includes("anilist") && !c.body!.query.includes("MediaListCollection"))!.body!;
    expect(gql.variables).toMatchObject({ season: "FALL", seasonYear: 2026, sort: ["SCORE_DESC", "POPULARITY_DESC", "ID_DESC"], averageScore_greater: 0, page: 1, perPage: 50 });
  });

  it("caches AniList pages in memory", async () => {
    const net = fakeFetch();
    const deps = { cache: new MemoryCache(), now: NOW, fetchImpl: net.impl as never, anilist: { fetchImpl: net.impl as never } };
    await get("/catalog/anime/al_popular.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    await get("/catalog/anime/al_popular.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    // One browse request + one collection request; the second call is served from memory.
    expect(net.calls.filter((c) => c.url.includes("anilist")).length).toBe(2);
  });

  it("serves a user list for a user from the URL with the 15 min cache", async () => {
    const net = fakeFetch();
    const deps = { cache: new MemoryCache(), now: NOW, fetchImpl: net.impl as never, anilist: { fetchImpl: net.impl as never } };
    const { res, body } = await get("/u/SomeUser/catalog/anime/al_list_current/skip=0.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["alsz:3"]);
    expect(res.headers.get("cdn-cache-control")).toContain("max-age=900");
    const gql = net.calls.find((c) => c.url.includes("anilist"))!.body!;
    expect(gql.variables).toMatchObject({ userName: "SomeUser", chunk: 1, perChunk: 500 });
  });

  it("lists custom lists in the manifest and serves them", async () => {
    const net = fakeFetch();
    const deps = { cache: new MemoryCache(), now: NOW, fetchImpl: net.impl as never, anilist: { fetchImpl: net.impl as never } };
    const { body: manifest } = await get("/manifest.json", deps, { MAPPING_URL: "https://m/mapping.json" });
    const duo = manifest.catalogs.find((c: { name: string }) => c.name === "AniList: Duo");
    expect(duo).toBeDefined();
    expect(manifest.catalogs.some((c: { name: string }) => c.name === "AniList: Solo")).toBe(true);
    const { body } = await get(`/catalog/anime/${duo.id}.json`, deps, { MAPPING_URL: "https://m/mapping.json" });
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["alsz:1"]);
  });

  it("serves meta with kitsu episode ids, for alsz: and kitsu: ids", async () => {
    const net = fakeFetch();
    const deps = { cache: new MemoryCache(), now: NOW, fetchImpl: net.impl as never, anilist: { fetchImpl: net.impl as never } };
    const env = { MAPPING_URL: "https://m/mapping.json" };
    const { res, body } = await get("/meta/series/alsz:1.json", deps, env);
    expect(res.status).toBe(200);
    expect(body.meta.id).toBe("alsz:1");
    expect(body.meta.videos.map((v: { id: string }) => v.id)).toEqual(["kitsu:100:1", "kitsu:100:2", "kitsu:100:3"]);
    expect(body.meta.videos[1].title).toBe("2. Second");
    expect(body.meta.videos[1].thumbnail).toBe("https://t/2.jpg");
    expect(body.meta.description.startsWith("Na tvém AniListu: Dokončeno · Duo")).toBe(true);
    expect(body.meta.trailers).toEqual([{ source: "yt1", type: "Trailer" }]);

    const byKitsu = await get("/meta/series/kitsu:100.json", deps, env);
    expect(byKitsu.body.meta.id).toBe("kitsu:100");
    expect(byKitsu.body.meta.name).toBe("English 1");

    const unknown = await get("/meta/series/kitsu:999999.json", deps, env);
    expect(unknown.res.status).toBe(404);
  });

  it("renders a badged poster and refuses other paths", async () => {
    const jpeg = (await import("jpeg-js")).default;
    const raw = jpeg.encode({ data: new Uint8Array(100 * 140 * 4).fill(128), width: 100, height: 140 }, 90).data;
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(raw)));
    const deps = { cache: new MemoryCache(), fetchImpl: fetchImpl as never };
    const ok = await handleRequest(new Request(`${BASE}/poster/cu/media/anime/cover/large/bx1-x.jpg`), {}, deps);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchImpl).toHaveBeenCalledWith("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-x.jpg");
    const img = jpeg.decode(new Uint8Array(await ok.arrayBuffer()), { useTArray: true });
    expect(img.width).toBe(100);
    const bad = await handleRequest(new Request(`${BASE}/poster/cu/media/other/evil.jpg`), {}, deps);
    expect(bad.status).toBe(404);
    const badCode = await handleRequest(new Request(`${BASE}/poster/zz/media/anime/cover/large/bx1-x.jpg`), {}, deps);
    expect(badCode.status).toBe(404);
  });

  it("returns an empty catalog (not a 5xx) when AniList blocks us", async () => {
    const blocked = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "blocked", status: 403 }] }), { status: 403 }));
    const { res, body } = await get("/catalog/anime/al_list_current.json", {
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
