import { describe, expect, it, vi } from "vitest";
import { anilistRequest, BROWSE_QUERY, COLLECTION_QUERY, fetchUserCollection, retryDelaySeconds } from "../src/anilist";
import { loadSlice, parseExtra, resolveCatalog } from "../src/catalog";

describe("GraphQL queries", () => {
  it("browse query excludes adult titles and uses the filter variables", () => {
    expect(BROWSE_QUERY).toContain("isAdult: $isAdult");
    expect(BROWSE_QUERY).toContain("$isAdult: Boolean = false");
    for (const v of ["$sort", "$format_in", "$season", "$seasonYear", "$startDate_greater", "$startDate_lesser", "$averageScore_greater", "$genre_in", "$tag_in"]) {
      expect(BROWSE_QUERY).toContain(v);
    }
    expect(BROWSE_QUERY).toContain("coverImage { extraLarge large }");
    expect(BROWSE_QUERY).toContain("bannerImage");
  });

  it("collection query loads all lists with custom list membership", () => {
    expect(COLLECTION_QUERY).toContain("MediaListCollection");
    expect(COLLECTION_QUERY).toContain("customLists(asArray: true)");
    expect(COLLECTION_QUERY).toContain("hasNextChunk");
  });
});

describe("parseExtra", () => {
  it("decodes Stremio extra segments", () => {
    expect(parseExtra("genre=L%C3%A9to%202027&skip=50")).toEqual({ genre: "Léto 2027", skip: "50" });
    expect(parseExtra("genre=Rok+2024")).toEqual({ genre: "Rok 2024" });
    expect(parseExtra("skip=100")).toEqual({ skip: "100" });
    expect(parseExtra(undefined)).toEqual({});
    expect(parseExtra("genre=%E0%A4")).toEqual({});
  });
});

describe("resolveCatalog", () => {
  const opts = { username: "Achnatos", splitEnabled: false };

  it("maps catalog ids and the genre value to a request", () => {
    expect(resolveCatalog("anime", "al_popular", { genre: "Zima 2026" }, opts)).toEqual({
      kind: "season",
      sort: "popular",
      filter: { kind: "seasonYear", season: "WINTER", year: 2026 },
    });
    expect(resolveCatalog("anime", "al_top", {}, opts)).toEqual({ kind: "season", sort: "top", filter: { kind: "all" } });
    expect(resolveCatalog("anime", "al_list_current", {}, opts)).toEqual({
      kind: "list",
      statuses: ["CURRENT", "REPEATING"],
    });
  });

  it("returns nothing for unknown values, wrong type, disabled features", () => {
    expect(resolveCatalog("anime", "al_popular", { genre: "Action" }, opts)).toBeNull();
    expect(resolveCatalog("movie", "al_popular", {}, opts)).toBeNull();
    expect(resolveCatalog("anime", "al_popular_split", { rok: "2024" }, opts)).toBeNull();
    expect(resolveCatalog("anime", "al_list_current", {}, { splitEnabled: false })).toBeNull();
  });

  it("handles the split catalog when enabled", () => {
    expect(resolveCatalog("anime", "al_popular_split", { rok: "2024", sezona: "Léto" }, { splitEnabled: true })).toEqual({
      kind: "season",
      sort: "popular",
      filter: { kind: "seasonYear", season: "SUMMER", year: 2024 },
    });
  });
});

describe("loadSlice", () => {
  const loader = vi.fn(async (page: number) => ({
    hasNextPage: page < 3,
    media: Array.from({ length: 50 }, (_, i) => ({ id: (page - 1) * 50 + i }) as never),
  }));

  it("returns items from skip onward across two pages", async () => {
    const items = (await loadSlice(loader, 75)) as unknown as Array<{ id: number }>;
    expect(items).toHaveLength(50);
    expect(items[0]!.id).toBe(75);
    expect(items[49]!.id).toBe(124);
    expect(loader).toHaveBeenCalledWith(2);
    expect(loader).toHaveBeenCalledWith(3);
  });
});

describe("rate limit handling", () => {
  it("prefers Retry-After, caps the wait", () => {
    expect(retryDelaySeconds(new Headers({ "retry-after": "3" }), 0)).toBe(3);
    expect(retryDelaySeconds(new Headers({ "retry-after": "120" }), 0)).toBe(15);
    expect(retryDelaySeconds(new Headers({ "x-ratelimit-reset": "1010" }), 1_000_000)).toBe(10);
    expect(retryDelaySeconds(new Headers(), 0)).toBe(5);
  });

  it("waits and retries after a 429", async () => {
    const responses = [
      new Response(JSON.stringify({ errors: [{ message: "Too Many Requests", status: 429 }] }), {
        status: 429,
        headers: { "retry-after": "2" },
      }),
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async (_ms: number) => undefined);
    const data = await anilistRequest<{ ok: boolean }>("{ x }", {}, { fetchImpl: fetchImpl as never, sleep });
    expect(data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after the retry limit", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: "Too Many Requests", status: 429 }] }), { status: 429 }),
    );
    await expect(
      anilistRequest("{ x }", {}, { fetchImpl: fetchImpl as never, sleep: async () => undefined }),
    ).rejects.toThrow("Too Many Requests");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns an empty collection for an unknown user", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: null, errors: [{ message: "Not Found.", status: 404 }] }), { status: 404 }),
    );
    expect(await fetchUserCollection("nobody_here", { fetchImpl: fetchImpl as never })).toEqual({
      customListNames: [],
      entries: [],
    });
  });

  it("merges chunks, de-duplicates entries and keeps custom lists", async () => {
    const m = (id: number) => ({ id });
    const chunks = [
      {
        hasNextChunk: true,
        user: { mediaListOptions: { animeList: { customLists: ["Solo", "Duo"] } } },
        lists: [
          {
            isCustomList: false,
            entries: [
              {
                status: "COMPLETED",
                updatedAt: 10,
                customLists: [
                  { name: "Duo", enabled: true },
                  { name: "Solo", enabled: false },
                ],
                media: m(1),
              },
            ],
          },
          {
            isCustomList: true,
            entries: [{ status: "COMPLETED", updatedAt: 10, customLists: [{ name: "Duo", enabled: true }], media: m(1) }],
          },
        ],
      },
      {
        hasNextChunk: false,
        user: null,
        lists: [{ isCustomList: false, entries: [{ status: "PLANNING", updatedAt: 20, customLists: null, media: m(2) }] }],
      },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { MediaListCollection: chunks.shift() } })));
    const col = await fetchUserCollection("x", { fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(col.customListNames).toEqual(["Solo", "Duo"]);
    expect(col.entries.map((e) => [e.media.id, e.status, e.customLists])).toEqual([
      [2, "PLANNING", []],
      [1, "COMPLETED", ["Duo"]],
    ]);
  });
});
