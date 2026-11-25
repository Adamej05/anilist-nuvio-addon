import { FORMATS, MIN_YEAR, SEASON_YEARS_COUNT, type MediaFormat } from "./config";

export type Season = "WINTER" | "SPRING" | "SUMMER" | "FALL";

export const SEASONS: ReadonlyArray<{ value: Season; label: string }> = [
  { value: "WINTER", label: "Zima" },
  { value: "SPRING", label: "Jaro" },
  { value: "SUMMER", label: "Léto" },
  { value: "FALL", label: "Podzim" },
];

export const LABEL_ALL = "Vše";
export const LABEL_YEAR = "Rok";
export const ALL_YEARS_SUFFIX = "(všechny roky)";

/**
 * Genres offered after the years. AniList genres use genre_in, the
 * demographics (Shounen, Seinen, ...) are AniList tags and use tag_in.
 */
export const GENRES: ReadonlyArray<{ label: string; genre?: string; tag?: string }> = [
  { label: "Akce", genre: "Action" },
  { label: "Dobrodružné", genre: "Adventure" },
  { label: "Komedie", genre: "Comedy" },
  { label: "Drama", genre: "Drama" },
  { label: "Ecchi", genre: "Ecchi" },
  { label: "Fantasy", genre: "Fantasy" },
  { label: "Horor", genre: "Horror" },
  { label: "Mahou shoujo", genre: "Mahou Shoujo" },
  { label: "Mecha", genre: "Mecha" },
  { label: "Hudba", genre: "Music" },
  { label: "Mysteriózní", genre: "Mystery" },
  { label: "Psychologické", genre: "Psychological" },
  { label: "Romantika", genre: "Romance" },
  { label: "Sci-fi", genre: "Sci-Fi" },
  { label: "Slice of life", genre: "Slice of Life" },
  { label: "Sport", genre: "Sports" },
  { label: "Nadpřirozené", genre: "Supernatural" },
  { label: "Thriller", genre: "Thriller" },
  { label: "Shounen", tag: "Shounen" },
  { label: "Shoujo", tag: "Shoujo" },
  { label: "Seinen", tag: "Seinen" },
  { label: "Josei", tag: "Josei" },
  { label: "Pro děti", tag: "Kids" },
];

export type Filter =
  | { kind: "all" }
  | { kind: "year"; year: number }
  | { kind: "season"; season: Season }
  | { kind: "seasonYear"; season: Season; year: number }
  | { kind: "genre"; label: string };

export interface OptionsConfig {
  /** Number of newest years that get season + year options. */
  seasonYearsCount?: number;
  minYear?: number;
}

/** Newest year in the filter: the current year + 1 (UTC). */
export function maxYearFor(now: Date): number {
  return now.getUTCFullYear() + 1;
}

/** Years from newest to oldest. */
export function yearRange(now: Date, minYear = MIN_YEAR): number[] {
  const years: number[] = [];
  for (let y = maxYearFor(now); y >= minYear; y--) years.push(y);
  return years;
}

/**
 * Options of the single "genre" dropdown, in this order:
 * Vše, the four "all years" seasons, then every year from the newest,
 * each year first as "Rok XXXX" and, for the newest N years, its four seasons,
 * and at the end the genres (Nuvio shows one dropdown, so a period and a genre
 * cannot be combined).
 */
export function buildGenreOptions(now: Date, cfg: OptionsConfig = {}): string[] {
  const n = cfg.seasonYearsCount ?? SEASON_YEARS_COUNT;
  const max = maxYearFor(now);
  const options = [LABEL_ALL, ...SEASONS.map((s) => `${s.label} ${ALL_YEARS_SUFFIX}`)];
  for (const year of yearRange(now, cfg.minYear ?? MIN_YEAR)) {
    options.push(`${LABEL_YEAR} ${year}`);
    if (year > max - n) {
      for (const s of SEASONS) options.push(`${s.label} ${year}`);
    }
  }
  for (const g of GENRES) options.push(g.label);
  return options;
}

export function filterToLabel(filter: Filter): string {
  switch (filter.kind) {
    case "all":
      return LABEL_ALL;
    case "year":
      return `${LABEL_YEAR} ${filter.year}`;
    case "season":
      return `${seasonLabel(filter.season)} ${ALL_YEARS_SUFFIX}`;
    case "seasonYear":
      return `${seasonLabel(filter.season)} ${filter.year}`;
    case "genre":
      return filter.label;
  }
}

function seasonLabel(season: Season): string {
  return SEASONS.find((s) => s.value === season)!.label;
}

function seasonFromLabel(label: string): Season | undefined {
  const wanted = label.normalize("NFC").toLocaleLowerCase("cs");
  return SEASONS.find((s) => s.label.toLocaleLowerCase("cs") === wanted)?.value;
}

function parseYear(text: string): number | undefined {
  if (!/^\d{4}$/.test(text)) return undefined;
  return Number(text);
}

/**
 * Turns a dropdown value back into a filter.
 * Empty or missing value = "Vše". Unknown value = null (the catalog returns nothing).
 */
export function parseGenreOption(value: string | undefined): Filter | null {
  if (value === undefined) return { kind: "all" };
  const v = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (v === "" || v === LABEL_ALL) return { kind: "all" };

  const genre = GENRES.find((g) => g.label.toLocaleLowerCase("cs") === v.toLocaleLowerCase("cs"));
  if (genre) return { kind: "genre", label: genre.label };

  const yearMatch = new RegExp(`^${LABEL_YEAR} (\\d{4})$`).exec(v);
  if (yearMatch) return { kind: "year", year: Number(yearMatch[1]) };

  if (v.endsWith(` ${ALL_YEARS_SUFFIX}`)) {
    const season = seasonFromLabel(v.slice(0, -ALL_YEARS_SUFFIX.length - 1));
    return season ? { kind: "season", season } : null;
  }

  const seasonYear = /^(\S+) (\d{4})$/.exec(v);
  if (seasonYear) {
    const season = seasonFromLabel(seasonYear[1]!);
    const year = parseYear(seasonYear[2]!);
    if (season && year) return { kind: "seasonYear", season, year };
  }
  return null;
}

// ---------- Optional variant with two separate filters ("rok" + "sezona") ----------

export const SPLIT_EXTRA_YEAR = "rok";
export const SPLIT_EXTRA_SEASON = "sezona";

export function buildSplitOptions(now: Date, minYear = MIN_YEAR): { years: string[]; seasons: string[] } {
  return {
    years: yearRange(now, minYear).map(String),
    seasons: SEASONS.map((s) => s.label),
  };
}

/** Both values are optional. Returns null when a value is not recognised. */
export function parseSplitFilter(year: string | undefined, season: string | undefined): Filter | null {
  const y = year?.trim() ? parseYear(year.trim()) : undefined;
  const s = season?.trim() ? seasonFromLabel(season.trim()) : undefined;
  if (year?.trim() && y === undefined) return null;
  if (season?.trim() && s === undefined) return null;
  if (y !== undefined && s !== undefined) return { kind: "seasonYear", season: s, year: y };
  if (y !== undefined) return { kind: "year", year: y };
  if (s !== undefined) return { kind: "season", season: s };
  return { kind: "all" };
}

// ---------- Filter -> AniList query variables ----------

export type SortKind = "popular" | "top";

export interface MediaVariables {
  sort: string[];
  format_in: MediaFormat[];
  season?: Season;
  seasonYear?: number;
  genre_in?: string[];
  tag_in?: string[];
  startDate_greater?: number;
  startDate_lesser?: number;
  averageScore_greater?: number;
}

/**
 * AniList stores dates as FuzzyDateInt YYYYMMDD and unknown parts as 00
 * (e.g. 20270000 = "sometime in 2027"), so "whole year" means
 * startDate > (Y-1)9999 and startDate < (Y+1)0000.
 */
export function filterToVariables(filter: Filter): Partial<MediaVariables> {
  switch (filter.kind) {
    case "all":
      return {};
    case "year":
      return {
        startDate_greater: (filter.year - 1) * 10000 + 9999,
        startDate_lesser: (filter.year + 1) * 10000,
      };
    case "season":
      return { season: filter.season };
    case "seasonYear":
      return { season: filter.season, seasonYear: filter.year };
    case "genre": {
      const g = GENRES.find((x) => x.label === filter.label);
      if (g?.genre) return { genre_in: [g.genre] };
      if (g?.tag) return { tag_in: [g.tag] };
      return {};
    }
  }
}

export function catalogVariables(
  filter: Filter,
  sort: SortKind,
  formats: readonly MediaFormat[] = FORMATS,
): MediaVariables {
  const vars: MediaVariables = {
    // ID_DESC as a tie-breaker keeps paging stable.
    sort: sort === "popular" ? ["POPULARITY_DESC", "ID_DESC"] : ["SCORE_DESC", "POPULARITY_DESC", "ID_DESC"],
    format_in: [...formats],
    ...filterToVariables(filter),
  };
  if (sort === "top") vars.averageScore_greater = 0; // leave out titles without a score
  return vars;
}

// ---------- skip -> AniList page ----------

/**
 * Stremio "skip" is an item offset; AniList pages are 1-based.
 * A skip that is not a multiple of the page size needs two pages.
 */
export function skipToPages(skip: number, pageSize: number): { pages: number[]; offset: number } {
  const safeSkip = Number.isFinite(skip) && skip > 0 ? Math.floor(skip) : 0;
  const first = Math.floor(safeSkip / pageSize) + 1;
  const offset = safeSkip % pageSize;
  return { pages: offset === 0 ? [first] : [first, first + 1], offset };
}
