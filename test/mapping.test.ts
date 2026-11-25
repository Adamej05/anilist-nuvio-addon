import { describe, expect, it } from "vitest";
import { buildManifest } from "../src/manifest";
import { anilistIdForKitsu, convertFribb, lookupIds } from "../src/mappingFormat";
import { episodeCount, episodeDates, episodeVideoId, itemId, listLine, stripHtml, stremioType, toMetaPreview } from "../src/meta";

const sample = [
  { anilist_id: 290, kitsu_id: 265, imdb_id: ["tt0286390"] },
  { anilist_id: 300, kitsu_id: 7749 },
  { anilist_id: 400, imdb_id: "tt1234567" },
  { anilist_id: 500 },
  { kitsu_id: 1 },
  { anilist_id: 290, kitsu_id: 999 },
];

describe("mapping", () => {
  const m = convertFribb(sample);

  it("keeps only entries with a Kitsu or IMDb id, compactly", () => {
    expect(m).toEqual({ "290": [265, "tt0286390"], "300": 7749, "400": [0, "tt1234567"] });
  });

  it("looks up ids both ways", () => {
    expect(lookupIds(m, 400)).toEqual({ kitsu: undefined, imdb: "tt1234567" });
    expect(anilistIdForKitsu(m, 265)).toBe(290);
    expect(anilistIdForKitsu(m, 7749)).toBe(300);
    expect(anilistIdForKitsu(m, 999)).toBeUndefined();
  });

  it("series get our own id, movies kitsu / IMDb", () => {
    expect(itemId({ id: 290, format: "TV" }, m)).toBe("alsz:290");
    expect(itemId({ id: 300, format: "MOVIE" }, m)).toBe("kitsu:7749");
    expect(itemId({ id: 400, format: "MOVIE" }, m)).toBe("tt1234567");
    expect(itemId({ id: 500, format: "SPECIAL" }, m)).toBe("alsz:500");
  });

  it("episodes use kitsu ids for Torrentio when mapped", () => {
    expect(episodeVideoId(290, 3, m)).toBe("kitsu:265:3");
    expect(episodeVideoId(500, 1, m)).toBe("alsz:500:1");
  });
});

describe("meta preview", () => {
  it("strips HTML and decodes entities", () => {
    expect(stripHtml("A<br>B <i>c</i> &amp; d&#039;s<br><br><br>end")).toBe("A\nB c & d's\n\nend");
  });

  it("uses the AIOMetadata type rule", () => {
    expect(stremioType("MOVIE")).toBe("movie");
    expect(stremioType("SPECIAL")).toBe("movie");
    expect(stremioType("TV")).toBe("series");
    expect(stremioType("ONA")).toBe("series");
    expect(stremioType(null)).toBe("series");
  });

  it("builds a full preview", () => {
    const meta = toMetaPreview(
      {
        id: 290,
        idMal: 290,
        title: { romaji: "Seikai no Monshou", english: "Crest of the Stars", native: null },
        format: "TV",
        status: "FINISHED",
        description: "Story<br>here",
        season: "WINTER",
        seasonYear: 1999,
        startDate: { year: 1999, month: 1, day: 2 },
        episodes: 13,
        duration: 25,
        genres: ["Sci-Fi"],
        averageScore: 71,
        isAdult: false,
        coverImage: { extraLarge: "https://img/xl.jpg", large: "https://img/l.jpg" },
        bannerImage: "https://img/banner.jpg",
      },
      convertFribb(sample),
    );
    expect(meta).toEqual({
      id: "alsz:290",
      type: "series",
      name: "Crest of the Stars",
      posterShape: "poster",
      poster: "https://img/xl.jpg",
      background: "https://img/banner.jpg",
      description: "Story\nhere",
      genres: ["Sci-Fi"],
      releaseInfo: "1999",
      imdbRating: "7.1",
    });
  });
});

describe("badged previews", () => {
  const media = {
    id: 290, idMal: null, title: { romaji: "R", english: null, native: null }, format: "TV", status: "FINISHED",
    description: "Story", season: null, seasonYear: 2020, startDate: null, episodes: 12, duration: 24, genres: [],
    averageScore: null, isAdult: false, bannerImage: null,
    coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx290-abc.jpg", large: null },
  };

  it("points the poster at our badge renderer and adds a list line", () => {
    const meta = toMetaPreview(media, {}, {
      origin: "https://addon.example",
      entry: { status: "COMPLETED", customLists: ["Duo"] },
    });
    expect(meta.poster).toBe("https://addon.example/poster/cu/media/anime/cover/large/bx290-abc.jpg");
    expect(meta.description).toBe("Na tvém AniListu: Dokončeno · Duo 👥\n\nStory");
  });

  it("keeps the plain poster for anime not in any list", () => {
    const meta = toMetaPreview(media, {}, { origin: "https://addon.example" });
    expect(meta.poster).toBe(media.coverImage.extraLarge);
    expect(meta.description).toBe("Story");
    expect(listLine(undefined)).toBe("");
  });
});

describe("manifest", () => {
  const now = new Date("2026-11-25T00:00:00Z");

  it("has two season catalogs with the genre dropdown and the five lists", () => {
    const m = buildManifest({ now, username: "Achnatos" });
    expect(m.resources[0]).toBe("catalog");
    expect(m.resources[1]).toEqual({ name: "meta", types: ["series", "movie", "anime"], idPrefixes: ["alsz:", "kitsu:"] });
    expect(m.catalogs.map((c) => c.id)).toEqual([
      "al_popular",
      "al_top",
      "al_list_current",
      "al_list_planning",
      "al_list_completed",
      "al_list_paused",
      "al_list_dropped",
    ]);
    const genre = m.catalogs[0]!.extra.find((e) => e.name === "genre")!;
    expect(genre.isRequired).toBe(false);
    expect(genre.options![0]).toBe("Vše");
    expect(genre.options![5]).toBe("Rok 2027");
    expect(m.catalogs[0]!.extra.map((e) => e.name)).toEqual(["genre", "skip"]);
  });

  it("drops lists without a user and adds the split catalog behind the flag", () => {
    const m = buildManifest({ now, splitEnabled: true });
    expect(m.catalogs.map((c) => c.id)).toEqual(["al_popular", "al_top", "al_popular_split"]);
    expect(m.catalogs[2]!.extra.map((e) => e.name)).toEqual(["rok", "sezona", "skip"]);
  });

  it("gives a URL-configured user its own addon id", () => {
    const m = buildManifest({ now, username: "SomeOne", usernameFromUrl: true });
    expect(m.id).toBe("community.anilist-seasons.someone");
    expect(m.name).toBe("AniList Sezóny (SomeOne)");
  });
});

describe("episode dates", () => {
  const base = {
    id: 1, idMal: null, title: { romaji: "x", english: null, native: null }, format: "TV", description: null,
    season: null, seasonYear: null, duration: 24, genres: [], averageScore: null, isAdult: false,
    coverImage: null, bannerImage: null, streamingEpisodes: [], trailer: null, studios: null,
  };
  const day = 86400;

  it("uses the schedule and spreads the gap from the start date evenly", () => {
    const m = {
      ...base, status: "RELEASING", episodes: null,
      startDate: { year: 2000, month: 1, day: 1 }, endDate: null,
      nextAiringEpisode: { episode: 12, airingAt: Date.UTC(2000, 3, 1) / 1000 },
      aired: { nodes: [{ episode: 10, airingAt: Date.UTC(2000, 2, 18) / 1000 }, { episode: 11, airingAt: Date.UTC(2000, 2, 25) / 1000 }] },
      upcoming: { nodes: [] },
    };
    expect(episodeCount(m as never)).toBe(11);
    const dates = episodeDates(m as never, 11);
    expect(dates[0]).toBe(Date.UTC(2000, 0, 1) / 1000);
    expect(dates[9]).toBe(Date.UTC(2000, 2, 18) / 1000);
    for (let i = 1; i < dates.length; i++) expect(dates[i]!).toBeGreaterThan(dates[i - 1]!);
  });

  it("counts weekly from the start without a schedule and stops at the end date", () => {
    const m = {
      ...base, status: "FINISHED", episodes: 4,
      startDate: { year: 2010, month: 1, day: 1 }, endDate: { year: 2010, month: 1, day: 10 },
      nextAiringEpisode: null, aired: { nodes: [] }, upcoming: { nodes: [] },
    };
    const start = Date.UTC(2010, 0, 1) / 1000;
    expect(episodeDates(m as never, 4)).toEqual([start, start + 7 * day, Date.UTC(2010, 0, 10) / 1000, Date.UTC(2010, 0, 10) / 1000]);
  });
});
