import type { ListStatus } from "./anilist";
import { ADDON_ID, ADDON_NAME, ADDON_VERSION, PAGE_SIZE } from "./config";
import {
  buildGenreOptions,
  buildSplitOptions,
  SPLIT_EXTRA_SEASON,
  SPLIT_EXTRA_YEAR,
  type OptionsConfig,
  type SortKind,
} from "./filters";
import { OWN_PREFIX } from "./meta";

export const CATALOG_TYPE = "anime";

export const SEASON_CATALOGS: ReadonlyArray<{ id: string; name: string; sort: SortKind }> = [
  { id: "al_popular", name: "Anime: Nejpopulárnější", sort: "popular" },
  { id: "al_top", name: "Anime: Nejlépe hodnocené", sort: "top" },
];

export const SPLIT_CATALOG = {
  id: "al_popular_split",
  name: "Anime: Nejpopulárnější (rok + sezóna)",
  sort: "popular" as SortKind,
};

export const LIST_CATALOGS: ReadonlyArray<{ id: string; name: string; statuses: ListStatus[] }> = [
  { id: "al_list_current", name: "AniList: Sleduji", statuses: ["CURRENT", "REPEATING"] },
  { id: "al_list_planning", name: "AniList: V plánu", statuses: ["PLANNING"] },
  { id: "al_list_completed", name: "AniList: Dokončeno", statuses: ["COMPLETED"] },
  { id: "al_list_paused", name: "AniList: Pozastaveno", statuses: ["PAUSED"] },
  { id: "al_list_dropped", name: "AniList: Zahozeno", statuses: ["DROPPED"] },
];

export interface ManifestInput {
  now: Date;
  /** AniList user for the list catalogs; no lists when empty. */
  username?: string;
  /** true when the user name came from the URL (gives the addon its own id). */
  usernameFromUrl?: boolean;
  splitEnabled?: boolean;
  options?: OptionsConfig;
  /** The user's custom AniList lists (e.g. "Duo"); each becomes a catalog. */
  customLists?: string[];
}

const CUSTOM_PREFIX = "al_custom_";

/** Catalog id for a custom list: the name in base64url, so any characters are safe in a URL. */
export function customListCatalogId(name: string): string {
  const bytes = new TextEncoder().encode(name);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return CUSTOM_PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function customListFromCatalogId(id: string): string | null {
  if (!id.startsWith(CUSTOM_PREFIX)) return null;
  try {
    const b64 = id.slice(CUSTOM_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

interface ExtraProp {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

interface CatalogDef {
  type: string;
  id: string;
  name: string;
  pageSize: number;
  extra: ExtraProp[];
  extraSupported: string[];
}

function catalog(id: string, name: string, extra: ExtraProp[]): CatalogDef {
  return {
    type: CATALOG_TYPE,
    id,
    name,
    // NuvioTV pages by 100 unless the catalog says otherwise.
    pageSize: PAGE_SIZE,
    extra: [...extra, { name: "skip" }],
    extraSupported: [...extra.map((e) => e.name), "skip"],
  };
}

export function buildManifest(input: ManifestInput) {
  const genreOptions = buildGenreOptions(input.now, input.options);
  const catalogs: CatalogDef[] = SEASON_CATALOGS.map((c) =>
    catalog(c.id, c.name, [{ name: "genre", isRequired: false, options: genreOptions }]),
  );

  if (input.splitEnabled) {
    const split = buildSplitOptions(input.now, input.options?.minYear);
    catalogs.push(
      catalog(SPLIT_CATALOG.id, SPLIT_CATALOG.name, [
        { name: SPLIT_EXTRA_YEAR, isRequired: false, options: split.years },
        { name: SPLIT_EXTRA_SEASON, isRequired: false, options: split.seasons },
      ]),
    );
  }

  const username = input.username?.trim();
  if (username) {
    for (const c of LIST_CATALOGS) catalogs.push(catalog(c.id, c.name, []));
    for (const name of input.customLists ?? []) {
      catalogs.push(catalog(customListCatalogId(name), `AniList: ${name}`, []));
    }
  }

  const fromUrl = Boolean(username && input.usernameFromUrl);
  return {
    id: fromUrl ? `${ADDON_ID}.${username!.toLowerCase()}` : ADDON_ID,
    version: ADDON_VERSION,
    name: fromUrl ? `${ADDON_NAME} (${username})` : ADDON_NAME,
    description:
      "Anime z AniListu podle roku a sezóny, plus seznamy uživatele" +
      (username ? ` ${username}` : "") +
      ". Ikonky na plakátech ukazují, co už máš v seznamu. Epizody mají Kitsu ID, takže streamy najde Torrentio.",
    resources: [
      "catalog",
      // Series use our own prefix, so this addon always serves their detail page.
      // kitsu: is for movies (Nuvio streams movies by the item id) and works as a
      // fallback when another metadata addon has nothing for a kitsu id.
      { name: "meta", types: ["series", "movie", CATALOG_TYPE], idPrefixes: [OWN_PREFIX, "kitsu:"] },
    ],
    types: [CATALOG_TYPE, "movie", "series"],
    idPrefixes: [OWN_PREFIX, "kitsu:"],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}
