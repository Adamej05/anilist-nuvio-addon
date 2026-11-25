import type { AniListMedia } from "./anilist";
import { TITLE_LANGUAGE } from "./config";
import { stremioIdFor, type CompactMapping } from "./mappingFormat";

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

export function toMetaPreview(m: AniListMedia, mapping: CompactMapping): MetaPreview {
  const year = m.seasonYear ?? m.startDate?.year ?? undefined;
  const meta: MetaPreview = {
    id: stremioIdFor(mapping, m.id),
    type: stremioType(m.format),
    name: displayTitle(m),
    posterShape: "poster",
  };
  const poster = m.coverImage?.extraLarge ?? m.coverImage?.large;
  if (poster) meta.poster = poster;
  if (m.bannerImage) meta.background = m.bannerImage;
  const description = stripHtml(m.description);
  if (description) meta.description = description;
  if (m.genres?.length) meta.genres = m.genres;
  if (year) meta.releaseInfo = String(year);
  // AniList score is 0-100; Stremio clients show imdbRating as 0-10.
  if (m.averageScore) meta.imdbRating = (m.averageScore / 10).toFixed(1);
  return meta;
}
