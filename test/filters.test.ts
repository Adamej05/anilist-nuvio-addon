import { describe, expect, it } from "vitest";
import {
  buildGenreOptions,
  buildSplitOptions,
  catalogVariables,
  filterToLabel,
  filterToVariables,
  GENRES,
  parseGenreOption,
  parseSplitFilter,
  skipToPages,
} from "../src/filters";

const NOV_2026 = new Date("2026-11-25T12:00:00Z");

describe("buildGenreOptions", () => {
  const options = buildGenreOptions(NOV_2026);

  it("starts with Vše and the four all-years seasons", () => {
    expect(options.slice(0, 5)).toEqual([
      "Vše",
      "Zima (všechny roky)",
      "Jaro (všechny roky)",
      "Léto (všechny roky)",
      "Podzim (všechny roky)",
    ]);
  });

  it("puts the newest year (current + 1) first, whole year before its seasons", () => {
    expect(options.slice(5, 15)).toEqual([
      "Rok 2027",
      "Zima 2027",
      "Jaro 2027",
      "Léto 2027",
      "Podzim 2027",
      "Rok 2026",
      "Zima 2026",
      "Jaro 2026",
      "Léto 2026",
      "Podzim 2026",
    ]);
  });

  it("gives seasons only to the newest 10 years (2027..2018)", () => {
    expect(options).toContain("Podzim 2018");
    expect(options).not.toContain("Zima 2017");
    expect(options).toContain("Rok 2017");
    const iRok2018 = options.indexOf("Rok 2018");
    expect(options.slice(iRok2018, iRok2018 + 6)).toEqual([
      "Rok 2018",
      "Zima 2018",
      "Jaro 2018",
      "Léto 2018",
      "Podzim 2018",
      "Rok 2017",
    ]);
  });

  it("puts the genres after Rok 1960 and has the expected count", () => {
    const iLastYear = options.indexOf("Rok 1960");
    expect(options.slice(iLastYear + 1)).toEqual(GENRES.map((g) => g.label));
    expect(options).toContain("Seinen");
    expect(options).toContain("Sport");
    expect(options).toContain("Romantika");
    expect(options.at(-1)).toBe("Pro děti");
    expect(options).not.toContain("Rok 1959");
    // 1 + 4 + 68 years (2027..1960) + 10 years * 4 seasons + genres
    expect(options).toHaveLength(1 + 4 + 68 + 40 + GENRES.length);
    expect(new Set(options).size).toBe(options.length);
  });

  it("adds a new year automatically at the turn of the year", () => {
    const lastDay = buildGenreOptions(new Date("2026-12-31T23:59:59Z"));
    const newYear = buildGenreOptions(new Date("2027-01-01T00:00:00Z"));
    expect(lastDay[5]).toBe("Rok 2027");
    expect(lastDay).not.toContain("Rok 2028");
    expect(newYear.slice(5, 10)).toEqual(["Rok 2028", "Zima 2028", "Jaro 2028", "Léto 2028", "Podzim 2028"]);
    // The season window moves too: 2028..2019
    expect(newYear).toContain("Podzim 2019");
    expect(newYear).not.toContain("Zima 2018");
    expect(newYear).toContain("Rok 2018");
    expect(newYear).toHaveLength(lastDay.length + 1);
  });

  it("respects a different N", () => {
    const opts = buildGenreOptions(NOV_2026, { seasonYearsCount: 2 });
    expect(opts).toContain("Podzim 2026");
    expect(opts).not.toContain("Zima 2025");
    expect(opts).toHaveLength(1 + 4 + 68 + 8 + GENRES.length);
  });

  it("every option parses back to itself", () => {
    for (const option of options) {
      const filter = parseGenreOption(option);
      expect(filter, option).not.toBeNull();
      expect(filterToLabel(filter!)).toBe(option);
    }
  });
});

describe("parseGenreOption", () => {
  it("treats a missing or empty value as Vše", () => {
    expect(parseGenreOption(undefined)).toEqual({ kind: "all" });
    expect(parseGenreOption("")).toEqual({ kind: "all" });
    expect(parseGenreOption("Vše")).toEqual({ kind: "all" });
  });

  it("parses the three filter shapes", () => {
    expect(parseGenreOption("Rok 2027")).toEqual({ kind: "year", year: 2027 });
    expect(parseGenreOption("Léto (všechny roky)")).toEqual({ kind: "season", season: "SUMMER" });
    expect(parseGenreOption("Podzim 2025")).toEqual({ kind: "seasonYear", season: "FALL", year: 2025 });
  });

  it("accepts decomposed Unicode (NFD) and extra spaces", () => {
    const nfd = "Léto  2024".normalize("NFD");
    expect(nfd).not.toBe("Léto  2024");
    expect(parseGenreOption(nfd)).toEqual({ kind: "seasonYear", season: "SUMMER", year: 2024 });
  });

  it("parses genres and demographics, case-insensitive", () => {
    expect(parseGenreOption("Romantika")).toEqual({ kind: "genre", label: "Romantika" });
    expect(parseGenreOption("seinen")).toEqual({ kind: "genre", label: "Seinen" });
    expect(parseGenreOption("Dobrodružné".normalize("NFD"))).toEqual({ kind: "genre", label: "Dobrodružné" });
  });

  it("rejects unknown values", () => {
    expect(parseGenreOption("Action")).toBeNull();
    expect(parseGenreOption("Monzun 2024")).toBeNull();
    expect(parseGenreOption("Rok 24")).toBeNull();
  });
});

describe("split filters", () => {
  it("builds years and seasons", () => {
    const { years, seasons } = buildSplitOptions(NOV_2026);
    expect(years[0]).toBe("2027");
    expect(years.at(-1)).toBe("1960");
    expect(seasons).toEqual(["Zima", "Jaro", "Léto", "Podzim"]);
  });

  it("combines the two optional values", () => {
    expect(parseSplitFilter(undefined, undefined)).toEqual({ kind: "all" });
    expect(parseSplitFilter("2024", undefined)).toEqual({ kind: "year", year: 2024 });
    expect(parseSplitFilter(undefined, "Zima")).toEqual({ kind: "season", season: "WINTER" });
    expect(parseSplitFilter("2024", "Jaro")).toEqual({ kind: "seasonYear", season: "SPRING", year: 2024 });
    expect(parseSplitFilter("abc", undefined)).toBeNull();
    expect(parseSplitFilter(undefined, "Monzun")).toBeNull();
  });
});

describe("filter -> AniList variables", () => {
  it("Vše has no date or season limits", () => {
    expect(filterToVariables({ kind: "all" })).toEqual({});
  });

  it("a whole year uses startDate, including dates with unknown month (YYYY0000)", () => {
    const v = filterToVariables({ kind: "year", year: 2027 });
    expect(v).toEqual({ startDate_greater: 20269999, startDate_lesser: 20280000 });
    const inYear = (d: number) => d > v.startDate_greater! && d < v.startDate_lesser!;
    expect(inYear(20270000)).toBe(true); // year only
    expect(inYear(20270100)).toBe(true); // year + month
    expect(inYear(20271231)).toBe(true);
    expect(inYear(20261231)).toBe(false);
    expect(inYear(20280000)).toBe(false);
  });

  it("genres use genre_in, demographics use tag_in", () => {
    expect(filterToVariables({ kind: "genre", label: "Sport" })).toEqual({ genre_in: ["Sports"] });
    expect(filterToVariables({ kind: "genre", label: "Romantika" })).toEqual({ genre_in: ["Romance"] });
    expect(filterToVariables({ kind: "genre", label: "Shounen" })).toEqual({ tag_in: ["Shounen"] });
    expect(filterToVariables({ kind: "genre", label: "Seinen" })).toEqual({ tag_in: ["Seinen"] });
    const top = catalogVariables({ kind: "genre", label: "Seinen" }, "top");
    expect(top).toMatchObject({ tag_in: ["Seinen"], averageScore_greater: 0, sort: ["SCORE_DESC", "POPULARITY_DESC", "ID_DESC"] });
  });

  it("a season in all years sets only the season", () => {
    expect(filterToVariables({ kind: "season", season: "WINTER" })).toEqual({ season: "WINTER" });
  });

  it("a season in a year sets season + seasonYear", () => {
    expect(filterToVariables({ kind: "seasonYear", season: "FALL", year: 2025 })).toEqual({
      season: "FALL",
      seasonYear: 2025,
    });
  });

  it("popular sorts by popularity, with formats", () => {
    const v = catalogVariables({ kind: "seasonYear", season: "FALL", year: 2025 }, "popular");
    expect(v.sort[0]).toBe("POPULARITY_DESC");
    expect(v.format_in).toEqual(["TV", "TV_SHORT", "MOVIE", "ONA", "OVA", "SPECIAL"]);
    expect(v.averageScore_greater).toBeUndefined();
    expect(v.season).toBe("FALL");
    expect(v.seasonYear).toBe(2025);
  });

  it("top sorts by score and drops titles without a score", () => {
    const v = catalogVariables({ kind: "all" }, "top", ["TV"]);
    expect(v.sort[0]).toBe("SCORE_DESC");
    expect(v.averageScore_greater).toBe(0);
    expect(v.format_in).toEqual(["TV"]);
  });
});

describe("skipToPages", () => {
  it("maps aligned skips to one page", () => {
    expect(skipToPages(0, 50)).toEqual({ pages: [1], offset: 0 });
    expect(skipToPages(50, 50)).toEqual({ pages: [2], offset: 0 });
    expect(skipToPages(100, 50)).toEqual({ pages: [3], offset: 0 });
  });

  it("needs two pages for unaligned skips", () => {
    expect(skipToPages(20, 50)).toEqual({ pages: [1, 2], offset: 20 });
    expect(skipToPages(75, 50)).toEqual({ pages: [2, 3], offset: 25 });
  });

  it("treats bad input as 0", () => {
    expect(skipToPages(-5, 50)).toEqual({ pages: [1], offset: 0 });
    expect(skipToPages(Number.NaN, 50)).toEqual({ pages: [1], offset: 0 });
  });
});
