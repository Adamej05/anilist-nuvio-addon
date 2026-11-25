import { describe, expect, it } from "vitest";
import { buildManifest } from "../src/manifest";
import { convertFribb, lookupIds, stremioIdFor } from "../src/mappingFormat";
import { stripHtml, stremioType, toMetaPreview } from "../src/meta";

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

  it("prefers kitsu, then IMDb, then anilist", () => {
    expect(stremioIdFor(m, 290)).toBe("kitsu:265");
    expect(stremioIdFor(m, 300)).toBe("kitsu:7749");
    expect(stremioIdFor(m, 400)).toBe("tt1234567");
    expect(stremioIdFor(m, 500)).toBe("anilist:500");
    expect(lookupIds(m, 400)).toEqual({ kitsu: undefined, imdb: "tt1234567" });
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
      id: "kitsu:265",
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

describe("manifest", () => {
  const now = new Date("2026-11-25T00:00:00Z");

  it("has two season catalogs with the genre dropdown and the five lists", () => {
    const m = buildManifest({ now, username: "Achnatos" });
    expect(m.resources).toEqual(["catalog"]);
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
