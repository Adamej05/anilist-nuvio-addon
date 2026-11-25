import {
  fetchBrowsePage,
  fetchUserCollection,
  type AniListMedia,
  type ListEntry,
  type ListStatus,
  type MediaPage,
  type RequestDeps,
  type UserCollection,
} from "./anilist";
import { cachedJson, sha256Hex, type JsonCache } from "./cache";
import { PAGE_SIZE, TTL } from "./config";
import { catalogVariables, parseGenreOption, parseSplitFilter, skipToPages, SPLIT_EXTRA_SEASON, SPLIT_EXTRA_YEAR, type Filter, type SortKind } from "./filters";
import { CATALOG_TYPE, customListFromCatalogId, LIST_CATALOGS, SEASON_CATALOGS, SPLIT_CATALOG } from "./manifest";
import { kitsuIdForMedia } from "./kitsu";
import { lookupIds, type CompactMapping } from "./mappingFormat";
import { itemType, toMetaPreview, type MetaPreview } from "./meta";

export interface CatalogContext {
  cache: JsonCache;
  /** Origin of this addon, for badged poster URLs. */
  origin: string;
  username?: string;
  splitEnabled: boolean;
  getMapping: () => Promise<CompactMapping>;
  deps?: RequestDeps;
  /** For the Kitsu API fallback. */
  fetchImpl?: typeof fetch;
}

/** Parses the Stremio extra path segment, e.g. "genre=L%C3%A9to%202027&skip=50". */
export function parseExtra(segment: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!segment) return out;
  for (const part of segment.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    try {
      out[decodeURIComponent(rawKey.replace(/\+/g, " "))] = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      // Malformed escape: ignore this pair.
    }
  }
  return out;
}

type PageLoader = (page: number) => Promise<MediaPage>;

export type CatalogKind =
  | { kind: "season"; sort: SortKind; filter: Filter }
  | { kind: "list"; statuses: ListStatus[] }
  | { kind: "custom"; name: string };

/** Decides what a catalog request means; null = nothing to return. */
export function resolveCatalog(
  type: string,
  id: string,
  extra: Record<string, string>,
  opts: { username?: string; splitEnabled: boolean },
): CatalogKind | null {
  if (type !== CATALOG_TYPE) return null;

  const season = SEASON_CATALOGS.find((c) => c.id === id);
  if (season) {
    const filter = parseGenreOption(extra.genre);
    return filter ? { kind: "season", sort: season.sort, filter } : null;
  }
  if (id === SPLIT_CATALOG.id && opts.splitEnabled) {
    const filter = parseSplitFilter(extra[SPLIT_EXTRA_YEAR], extra[SPLIT_EXTRA_SEASON]);
    return filter ? { kind: "season", sort: SPLIT_CATALOG.sort, filter } : null;
  }
  if (!opts.username) return null;
  const list = LIST_CATALOGS.find((c) => c.id === id);
  if (list) return { kind: "list", statuses: list.statuses };
  const custom = customListFromCatalogId(id);
  if (custom) return { kind: "custom", name: custom };
  return null;
}

/** The user's whole AniList anime list, cached for 15 minutes. */
export function getCollection(cache: JsonCache, user: string, deps?: RequestDeps): Promise<UserCollection> {
  return cachedJson(cache, `collection:${user.toLowerCase()}`, TTL.userList, () => fetchUserCollection(user, deps));
}

const indexCache = new WeakMap<UserCollection, Map<number, ListEntry>>();

/** AniList id -> the user's entry. */
export function entryIndex(collection: UserCollection): Map<number, ListEntry> {
  let index = indexCache.get(collection);
  if (!index) {
    index = new Map(collection.entries.map((e) => [e.media.id, e]));
    indexCache.set(collection, index);
  }
  return index;
}

/** Entries of a status list or custom list, newest update first. */
export function listEntries(collection: UserCollection, kind: Extract<CatalogKind, { kind: "list" | "custom" }>): ListEntry[] {
  if (kind.kind === "list") return collection.entries.filter((e) => kind.statuses.includes(e.status));
  const wanted = kind.name.toLocaleLowerCase("cs");
  return collection.entries.filter((e) => e.customLists.some((n) => n.toLocaleLowerCase("cs") === wanted));
}

export async function handleCatalog(
  type: string,
  id: string,
  extra: Record<string, string>,
  ctx: CatalogContext,
): Promise<{ metas: MetaPreview[]; cacheSeconds: number }> {
  const resolved = resolveCatalog(type, id, extra, ctx);
  if (!resolved) return { metas: [], cacheSeconds: TTL.seasonal };

  const skipRaw = Number.parseInt(extra.skip ?? "0", 10);
  const skip = Number.isNaN(skipRaw) || skipRaw < 0 ? 0 : skipRaw;

  // The user's list drives both the list catalogs and the badges on every poster.
  let collection: UserCollection | undefined;
  if (ctx.username) {
    try {
      collection = await getCollection(ctx.cache, ctx.username, ctx.deps);
    } catch (err) {
      if (resolved.kind !== "season") throw err;
      console.warn("user list unavailable, catalog without badges", err);
    }
  }

  let media: AniListMedia[];
  if (resolved.kind === "season") {
    const variables = catalogVariables(resolved.filter, resolved.sort);
    const loader: PageLoader = async (page) => {
      const key = await sha256Hex(JSON.stringify(["browse", variables, page, PAGE_SIZE]));
      return cachedJson(ctx.cache, `anilist:${key}`, TTL.seasonal, () =>
        fetchBrowsePage({ ...variables }, page, PAGE_SIZE, ctx.deps),
      );
    };
    media = await loadSlice(loader, skip);
  } else {
    media = listEntries(collection!, resolved)
      .slice(skip, skip + PAGE_SIZE)
      .map((e) => e.media);
  }

  const mapping = await ctx.getMapping();
  const index = collection ? entryIndex(collection) : undefined;
  // Movies are streamed by their item id, so an unmapped movie needs its Kitsu id now
  // (series get theirs in the detail page). Fribb leaves out adult titles entirely.
  const kitsuIds = new Map<number, number>();
  await Promise.all(
    media
      .filter((m) => itemType(m) === "movie")
      .filter((m) => {
        const ids = lookupIds(mapping, m.id);
        return !ids.kitsu && !ids.imdb;
      })
      .map(async (m) => {
        const k = await kitsuIdForMedia(m.id, m.idMal, { cache: ctx.cache, fetchImpl: ctx.fetchImpl });
        if (k) kitsuIds.set(m.id, k);
      }),
  );
  const metas = media.map((m) =>
    toMetaPreview(m, mapping, { origin: ctx.origin, entry: index?.get(m.id), kitsuId: kitsuIds.get(m.id) }),
  );
  // With badges the response depends on the user's list, so it is cached like the list.
  const cacheSeconds = resolved.kind === "season" && !collection ? TTL.seasonal : TTL.userList;
  return { metas, cacheSeconds };
}

/** Returns up to PAGE_SIZE items starting at `skip`, whatever its alignment. */
export async function loadSlice(loader: PageLoader, skip: number): Promise<AniListMedia[]> {
  const { pages, offset } = skipToPages(skip, PAGE_SIZE);
  const first = await loader(pages[0]!);
  let items = first.media;
  if (pages.length > 1 && first.hasNextPage) {
    const second = await loader(pages[1]!);
    items = items.concat(second.media);
  }
  return items.slice(offset, offset + PAGE_SIZE);
}
