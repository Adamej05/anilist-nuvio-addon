import { fetchBrowsePage, fetchUserListPage, type AniListMedia, type MediaPage, type RequestDeps } from "./anilist";
import { cachedJson, sha256Hex } from "./cache";
import { PAGE_SIZE, TTL } from "./config";
import { catalogVariables, parseGenreOption, parseSplitFilter, skipToPages, SPLIT_EXTRA_SEASON, SPLIT_EXTRA_YEAR, type Filter, type SortKind } from "./filters";
import { CATALOG_TYPE, LIST_CATALOGS, SEASON_CATALOGS, SPLIT_CATALOG } from "./manifest";
import type { CompactMapping } from "./mappingFormat";
import { toMetaPreview, type MetaPreview } from "./meta";

export interface CatalogContext {
  origin: string;
  exec: ExecutionContext;
  username?: string;
  splitEnabled: boolean;
  getMapping: () => Promise<CompactMapping>;
  deps?: RequestDeps;
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
  | { kind: "list"; statuses: string[] };

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
  const list = LIST_CATALOGS.find((c) => c.id === id);
  if (list && opts.username) return { kind: "list", statuses: list.statuses };
  return null;
}

export async function handleCatalog(
  type: string,
  id: string,
  extra: Record<string, string>,
  ctx: CatalogContext,
): Promise<{ metas: MetaPreview[]; cacheSeconds: number }> {
  const resolved = resolveCatalog(type, id, extra, ctx);
  if (!resolved) return { metas: [], cacheSeconds: TTL.seasonal };

  let loader: PageLoader;
  let ttl: number;
  if (resolved.kind === "season") {
    const variables = catalogVariables(resolved.filter, resolved.sort);
    ttl = TTL.seasonal;
    loader = async (page) => {
      const key = await sha256Hex(JSON.stringify(["browse", variables, page, PAGE_SIZE]));
      return cachedJson(`${ctx.origin}/__cache/anilist/${key}`, ttl, ctx.exec, () =>
        fetchBrowsePage({ ...variables }, page, PAGE_SIZE, ctx.deps),
      );
    };
  } else {
    const user = ctx.username!;
    ttl = TTL.userList;
    loader = async (page) => {
      const key = await sha256Hex(JSON.stringify(["list", user.toLowerCase(), resolved.statuses, page, PAGE_SIZE]));
      return cachedJson(`${ctx.origin}/__cache/anilist/${key}`, ttl, ctx.exec, () =>
        fetchUserListPage(user, resolved.statuses, page, PAGE_SIZE, ctx.deps),
      );
    };
  }

  const skip = Number.parseInt(extra.skip ?? "0", 10);
  const media = await loadSlice(loader, Number.isNaN(skip) ? 0 : skip);
  const mapping = await ctx.getMapping();
  return { metas: media.map((m) => toMetaPreview(m, mapping)), cacheSeconds: ttl };
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
