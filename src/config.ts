/**
 * Central settings. Everything you might want to tweak lives here.
 * Values that differ per deployment (user name, feature flag, mapping URL)
 * come from environment variables, see wrangler.toml.
 */

/** AniList media formats included in the season catalogs. */
export const FORMATS = ["TV", "TV_SHORT", "MOVIE", "ONA", "OVA", "SPECIAL"] as const;
export type MediaFormat = (typeof FORMATS)[number];

/** How many of the newest years get "season + year" options in the filter. */
export const SEASON_YEARS_COUNT = 10;

/** Oldest year offered in the filter. */
export const MIN_YEAR = 1960;

/** Items per catalog page. AniList allows at most 50 per page. */
export const PAGE_SIZE = 50;

/** Cache lifetimes in seconds. */
export const TTL = {
  seasonal: 6 * 60 * 60,
  userList: 15 * 60,
  mapping: 24 * 60 * 60,
  manifest: 60 * 60,
} as const;

/** Which title to show: English when AniList has one, otherwise romaji. */
export const TITLE_LANGUAGE: "english" | "romaji" = "english";

/** Behaviour on HTTP 429 from AniList. */
export const RETRY = {
  maxRetries: 2,
  /** Never wait longer than this per retry (Nuvio would time out). */
  maxWaitSeconds: 15,
  /** Wait used when AniList sends no Retry-After header. */
  defaultWaitSeconds: 5,
} as const;

export const ANILIST_URL = "https://graphql.anilist.co";

/** Full Fribb dataset, used only as a fallback when the compact mapping is unavailable. */
export const FRIBB_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

export const ADDON_VERSION = "1.0.0";
export const ADDON_ID = "community.anilist-seasons";
export const ADDON_NAME = "AniList Sezóny";
