import { ADDON_ID, ADDON_NAME, ADDON_VERSION, PAGE_SIZE } from "./config";
import {
  buildGenreOptions,
  buildSplitOptions,
  SPLIT_EXTRA_SEASON,
  SPLIT_EXTRA_YEAR,
  type OptionsConfig,
  type SortKind,
} from "./filters";

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

export const LIST_CATALOGS: ReadonlyArray<{ id: string; name: string; statuses: string[] }> = [
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
  }

  const fromUrl = Boolean(username && input.usernameFromUrl);
  return {
    id: fromUrl ? `${ADDON_ID}.${username!.toLowerCase()}` : ADDON_ID,
    version: ADDON_VERSION,
    name: fromUrl ? `${ADDON_NAME} (${username})` : ADDON_NAME,
    description:
      "Anime z AniListu podle roku a sezóny, plus seznamy uživatele" +
      (username ? ` ${username}` : "") +
      ". Položky mají Kitsu/IMDb ID, takže detail dodá AIOMetadata a streamy Torrentio.",
    resources: ["catalog"],
    // No meta resource and no idPrefixes on purpose: Nuvio then asks AIOMetadata
    // for the detail page and Torrentio for streams.
    types: [CATALOG_TYPE, "movie", "series"],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}
