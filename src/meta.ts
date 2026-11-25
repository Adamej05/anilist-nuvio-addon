import type { AniListMedia, ListEntry, MediaDetail } from "./anilist";
import { badgeCodes, badgedPosterUrl, isDuoList, STATUS_LABEL } from "./badges";
import { TITLE_LANGUAGE } from "./config";
import { lookupIds, type CompactMapping } from "./mappingFormat";

/**
 * IDs:
 * - series  -> "alsz:<anilistId>". Only this addon serves meta for that prefix, so the
 *   detail page always works; its episodes are "kitsu:<id>:<ep>", which Torrentio knows.
 * - movies  -> "kitsu:<id>" (or IMDb), because Nuvio asks for movie streams with the
 *   item id itself. This addon also serves meta for kitsu: ids.
 */
export const OWN_PREFIX = "alsz:";

export interface MetaPreview {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  posterShape: "poster";
  background?: string;
  description?: string;
  genres?: string[];
  releaseInfo?: string;
  imdbRating?: string;
}

/** Same rule as AIOMetadata: MOVIE and SPECIAL are movies, the rest are series. */
export function stremioType(format: string | null): "movie" | "series" {
  return format === "MOVIE" || format === "SPECIAL" ? "movie" : "series";
}

export function itemId(m: Pick<AniListMedia, "id" | "format">, mapping: CompactMapping): string {
  if (stremioType(m.format) === "movie") {
    const ids = lookupIds(mapping, m.id);
    if (ids.kitsu) return `kitsu:${ids.kitsu}`;
    if (ids.imdb) return ids.imdb;
  }
  return `${OWN_PREFIX}${m.id}`;
}

/** Video id of one episode: kitsu when mapped (Torrentio), otherwise our own. */
export function episodeVideoId(anilistId: number, episode: number, mapping: CompactMapping): string {
  const kitsu = lookupIds(mapping, anilistId).kitsu;
  return kitsu ? `kitsu:${kitsu}:${episode}` : `${OWN_PREFIX}${anilistId}:${episode}`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function displayTitle(m: AniListMedia): string {
  const t = m.title;
  const preferred = TITLE_LANGUAGE === "english" ? t.english ?? t.romaji : t.romaji ?? t.english;
  return preferred ?? t.native ?? `AniList ${m.id}`;
}

export interface PreviewOptions {
  /** Origin of this addon, for badged poster URLs. */
  origin?: string;
  /** The user's list entry for this anime, if any. */
  entry?: Pick<ListEntry, "status" | "customLists">;
}

export function toMetaPreview(m: AniListMedia, mapping: CompactMapping, opts: PreviewOptions = {}): MetaPreview {
  const year = m.seasonYear ?? m.startDate?.year ?? undefined;
  const meta: MetaPreview = {
    id: itemId(m, mapping),
    type: stremioType(m.format),
    name: displayTitle(m),
    posterShape: "poster",
  };
  const cover = m.coverImage?.extraLarge ?? m.coverImage?.large ?? undefined;
  const codes = opts.entry ? badgeCodes(opts.entry.status, opts.entry.customLists) : "";
  const poster = opts.origin ? badgedPosterUrl(opts.origin, cover, codes) : cover;
  if (poster) meta.poster = poster;
  if (m.bannerImage) meta.background = m.bannerImage;
  const description = withListLine(stripHtml(m.description), opts.entry);
  if (description) meta.description = description;
  if (m.genres?.length) meta.genres = m.genres;
  if (year) meta.releaseInfo = String(year);
  // AniList score is 0-100; Stremio clients show imdbRating as 0-10.
  if (m.averageScore) meta.imdbRating = (m.averageScore / 10).toFixed(1);
  return meta;
}

/** "Na tvém AniListu: Dokončeno · Duo" as the first line of the description. */
export function listLine(entry: Pick<ListEntry, "status" | "customLists"> | undefined): string {
  if (!entry) return "";
  const parts = [STATUS_LABEL[entry.status]];
  for (const name of entry.customLists) parts.push(isDuoList(name) ? `${name} 👥` : name);
  return `Na tvém AniListu: ${parts.join(" · ")}`;
}

function withListLine(description: string, entry: PreviewOptions["entry"]): string {
  const line = listLine(entry);
  if (!line) return description;
  return description ? `${line}\n\n${description}` : line;
}

// ---------- Full meta with episodes ----------

export interface MetaVideo {
  id: string;
  title: string;
  season: number;
  episode: number;
  released: string;
  thumbnail?: string;
}

export interface MetaDetailResponse extends MetaPreview {
  runtime?: string;
  releaseInfo?: string;
  links?: Array<{ name: string; category: string; url: string }>;
  trailers?: Array<{ source: string; type: string }>;
  videos?: MetaVideo[];
  behaviorHints?: { defaultVideoId?: string; hasScheduledVideos?: boolean };
}

const DAY = 24 * 60 * 60;

function fuzzyToUnix(d: { year: number | null; month: number | null; day: number | null } | null | undefined): number | undefined {
  if (!d?.year) return undefined;
  return Date.UTC(d.year, (d.month ?? 1) - 1, d.day ?? 1) / 1000;
}

/** How many episodes to list: the known total, else what has aired (+ known upcoming). */
export function episodeCount(m: MediaDetail): number {
  if (m.episodes) return m.episodes;
  const upcoming = (m.upcoming?.nodes ?? []).filter(Boolean).map((n) => n!.episode);
  const aired = (m.aired?.nodes ?? []).filter(Boolean).map((n) => n!.episode);
  const next = m.nextAiringEpisode?.episode;
  return Math.max(0, ...upcoming, ...aired, next ? next - 1 : 0);
}

/**
 * Air date per episode: the AniList schedule where known; between two known
 * dates (the start date counts as episode 1) spread evenly; after the last known
 * date one per week. Never before the start and, for finished shows, never after the end.
 */
export function episodeDates(m: MediaDetail, count: number): number[] {
  const known = new Map<number, number>();
  for (const n of [...(m.aired?.nodes ?? []), ...(m.upcoming?.nodes ?? [])]) {
    if (n) known.set(n.episode, n.airingAt);
  }
  if (m.nextAiringEpisode) known.set(m.nextAiringEpisode.episode, m.nextAiringEpisode.airingAt);
  const start = fuzzyToUnix(m.startDate);
  const end = m.status === "FINISHED" ? fuzzyToUnix(m.endDate) : undefined;
  // The start date counts as the date of episode 1 when the schedule does not know it.
  if (start !== undefined && !known.has(1) && [...known.values()].every((t) => t >= start)) known.set(1, start);
  const anchors = [...known.entries()].sort((a, b) => a[0] - b[0]);

  const dates: number[] = [];
  for (let ep = 1; ep <= count; ep++) {
    let t = known.get(ep);
    if (t === undefined) {
      const after = anchors.find(([e]) => e > ep);
      const before = [...anchors].reverse().find(([e]) => e < ep);
      if (before && after) t = before[1] + ((after[1] - before[1]) * (ep - before[0])) / (after[0] - before[0]);
      else if (after) t = after[1] - (after[0] - ep) * 7 * DAY;
      else if (before) t = before[1] + (ep - before[0]) * 7 * DAY;
      else t = 0;
      if (start !== undefined) t = Math.max(t, start);
      if (end !== undefined) t = Math.min(t, end);
    }
    dates.push(t);
  }
  return dates;
}

/** Crunchyroll episode titles/thumbnails from AniList: "Episode 3 - Title". */
export function streamingEpisodeInfo(m: MediaDetail): Map<number, { title?: string; thumbnail?: string }> {
  const out = new Map<number, { title?: string; thumbnail?: string }>();
  for (const s of m.streamingEpisodes ?? []) {
    const match = s?.title ? /^Episode\s+(\d+)\s*(?:[-–:]\s*(.*))?$/i.exec(s.title.trim()) : null;
    if (!match) continue;
    const ep = Number(match[1]);
    if (!out.has(ep)) out.set(ep, { title: match[2]?.trim() || undefined, thumbnail: s?.thumbnail ?? undefined });
  }
  return out;
}

function releaseRange(m: MediaDetail): string | undefined {
  const from = m.startDate?.year ?? m.seasonYear ?? undefined;
  if (!from) return undefined;
  if (m.status === "RELEASING") return `${from}–`;
  const to = m.endDate?.year;
  return to && to !== from ? `${from}–${to}` : String(from);
}

export function toMetaDetail(
  m: MediaDetail,
  mapping: CompactMapping,
  opts: { id: string; type: "movie" | "series"; entry?: Pick<ListEntry, "status" | "customLists"> },
): MetaDetailResponse {
  const base = toMetaPreview(m, mapping, { entry: opts.entry });
  const studio = m.studios?.nodes?.find(Boolean)?.name;
  const extra = [m.format?.replace("_", " "), studio, m.episodes ? `${m.episodes} ep.` : undefined].filter(Boolean).join(" · ");
  const meta: MetaDetailResponse = {
    ...base,
    id: opts.id,
    type: opts.type,
    background: m.bannerImage ?? m.coverImage?.extraLarge ?? undefined,
    description: [base.description, extra].filter(Boolean).join("\n\n") || undefined,
    links: [{ name: "AniList", category: "AniList", url: `https://anilist.co/anime/${m.id}` }],
  };
  const range = releaseRange(m);
  if (range) meta.releaseInfo = range;
  if (m.duration) meta.runtime = `${m.duration} min`;
  if (m.trailer?.site === "youtube" && m.trailer.id) meta.trailers = [{ source: m.trailer.id, type: "Trailer" }];

  if (opts.type === "movie") {
    meta.behaviorHints = { defaultVideoId: opts.id, hasScheduledVideos: false };
    return meta;
  }

  const count = episodeCount(m);
  const dates = episodeDates(m, count);
  const info = streamingEpisodeInfo(m);
  const fallbackThumb = m.bannerImage ?? m.coverImage?.extraLarge ?? undefined;
  meta.videos = Array.from({ length: count }, (_, i) => {
    const ep = i + 1;
    const extraInfo = info.get(ep);
    const video: MetaVideo = {
      id: episodeVideoId(m.id, ep, mapping),
      title: extraInfo?.title ? `${ep}. ${extraInfo.title}` : `Epizoda ${ep}`,
      season: 1,
      episode: ep,
      released: new Date((dates[i] ?? 0) * 1000).toISOString(),
    };
    const thumb = extraInfo?.thumbnail ?? fallbackThumb;
    if (thumb) video.thumbnail = thumb;
    return video;
  });
  meta.behaviorHints = { hasScheduledVideos: m.status === "RELEASING" || m.status === "NOT_YET_RELEASED" };
  return meta;
}
