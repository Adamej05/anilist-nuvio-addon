import jpeg from "jpeg-js";
import type { ListStatus } from "./anilist";
import { BOOKMARK_LIST_NAMES, DUO_LIST_NAMES } from "./config";
import { decodePng } from "./png";

/**
 * Status badges drawn into the poster, because the Stremio catalog format
 * has no field for them. One letter per badge, right to left on the poster:
 *   c = Dokončeno (green check)      w = Sleduji (blue play)
 *   p = V plánu (amber clock)        h = Pozastaveno (grey pause)
 *   d = Zahozeno (red cross)         u = Duo list (pink two people)
 *   l = custom list from BOOKMARK_LIST_NAMES (purple bookmark, none by default)
 */
export type BadgeCode = "c" | "w" | "p" | "h" | "d" | "u" | "l";

const STATUS_CODE: Record<ListStatus, BadgeCode> = {
  COMPLETED: "c",
  CURRENT: "w",
  REPEATING: "w",
  PLANNING: "p",
  PAUSED: "h",
  DROPPED: "d",
};

export const STATUS_LABEL: Record<ListStatus, string> = {
  CURRENT: "Sleduji",
  REPEATING: "Sleduji znovu",
  PLANNING: "V plánu",
  COMPLETED: "Dokončeno",
  PAUSED: "Pozastaveno",
  DROPPED: "Zahozeno",
};

export function isDuoList(name: string): boolean {
  return DUO_LIST_NAMES.includes(name.trim().toLocaleLowerCase("cs"));
}

/** "c", "cu", "pl", ... or "" when the anime is not in any list. */
export function badgeCodes(status: ListStatus | undefined, customLists: string[] = []): string {
  let out = status ? STATUS_CODE[status] : "";
  if (customLists.some(isDuoList)) out += "u";
  const bookmarked = (n: string) => BOOKMARK_LIST_NAMES.includes(n.trim().toLocaleLowerCase("cs"));
  if (customLists.some((n) => !isDuoList(n) && bookmarked(n))) out += "l";
  return out;
}

export const BADGE_CODES_RE = /^[cwphdul]{1,3}$/;

// ---------- AniList cover path <-> our poster URL ----------

const COVER_PREFIX = "https://s4.anilist.co/file/anilistcdn/";
const COVER_PATH_RE = /^media\/anime\/cover\/(?:large|medium|small)\/[A-Za-z0-9_.-]+\.(?:jpe?g|png)$/;

/** Our badged poster URL, or the original when there is nothing to draw. */
export function badgedPosterUrl(origin: string, coverUrl: string | undefined, codes: string): string | undefined {
  if (!coverUrl || !codes) return coverUrl;
  if (!coverUrl.startsWith(COVER_PREFIX)) return coverUrl;
  const path = coverUrl.slice(COVER_PREFIX.length);
  if (!COVER_PATH_RE.test(path)) return coverUrl;
  return `${origin}/poster/${codes}/${path}`;
}

/** Validates the path part of /poster/<codes>/<cover path> and returns the AniList URL. */
export function coverUrlFromPath(path: string): string | null {
  return COVER_PATH_RE.test(path) ? COVER_PREFIX + path : null;
}

// ---------- Drawing (signed distance fields, anti-aliased) ----------

type Sdf = (x: number, y: number) => number; // < 0 inside, in badge-radius units

const len = (x: number, y: number) => Math.hypot(x, y);

function segment(ax: number, ay: number, bx: number, by: number): Sdf {
  return (x, y) => {
    const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
    const h = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
    return len(px - dx * h, py - dy * h);
  };
}

const circle = (cx: number, cy: number, r: number): Sdf => (x, y) => len(x - cx, y - cy) - r;

function box(cx: number, cy: number, hw: number, hh: number, round = 0): Sdf {
  return (x, y) => {
    const qx = Math.abs(x - cx) - hw + round, qy = Math.abs(y - cy) - hh + round;
    return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - round;
  };
}

function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Sdf {
  const edges = [segment(ax, ay, bx, by), segment(bx, by, cx, cy), segment(cx, cy, ax, ay)];
  const sign = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  return (x, y) => {
    const d = Math.min(...edges.map((e) => e(x, y)));
    const d1 = sign(x, y, ax, ay, bx, by), d2 = sign(x, y, bx, by, cx, cy), d3 = sign(x, y, cx, cy, ax, ay);
    const inside = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    return inside ? -d : d;
  };
}

const stroke = (f: Sdf, width: number): Sdf => (x, y) => Math.abs(f(x, y)) - width / 2;
const union = (...fs: Sdf[]): Sdf => (x, y) => Math.min(...fs.map((f) => f(x, y)));
const intersect = (a: Sdf, b: Sdf): Sdf => (x, y) => Math.max(a(x, y), b(x, y));
const subtract = (a: Sdf, b: Sdf): Sdf => (x, y) => Math.max(a(x, y), -b(x, y));

const W = 0.17; // stroke width

function person(cx: number, cy: number, scale: number): Sdf {
  const head = circle(cx, cy - 0.3 * scale, 0.2 * scale);
  const body = intersect(circle(cx, cy + 0.42 * scale, 0.42 * scale), box(cx, cy + 0.21 * scale, 1, 0.21 * scale));
  return union(head, body);
}

/** Icon layers: [shape, opacity]. Coordinates are in units of the badge radius, centre = 0,0. */
const ICONS: Record<BadgeCode, Array<[Sdf, number]>> = {
  c: [[stroke(union(segment(-0.42, 0.02, -0.12, 0.32), segment(-0.12, 0.32, 0.44, -0.3)), W), 1]],
  w: [[triangle(-0.22, -0.4, 0.46, 0, -0.22, 0.4), 1]],
  p: [
    [stroke(circle(0, 0, 0.5), W * 0.8), 1],
    [stroke(union(segment(0, 0, 0, -0.3), segment(0, 0, 0.22, 0.12)), W * 0.8), 1],
  ],
  h: [[union(box(-0.19, 0, 0.1, 0.38, 0.04), box(0.19, 0, 0.1, 0.38, 0.04)), 1]],
  d: [[stroke(union(segment(-0.32, -0.32, 0.32, 0.32), segment(-0.32, 0.32, 0.32, -0.32)), W), 1]],
  u: [
    [subtract(person(0.22, -0.02, 0.85), person(-0.14, 0.08, 1.12)), 0.75],
    [person(-0.14, 0.08, 0.95), 1],
  ],
  l: [[subtract(box(0, 0, 0.27, 0.42), triangle(-0.3, 0.46, 0, 0.16, 0.3, 0.46)), 1]],
};

const COLORS: Record<BadgeCode, [number, number, number]> = {
  c: [22, 163, 74],
  w: [37, 99, 235],
  p: [217, 119, 6],
  h: [100, 116, 139],
  d: [220, 38, 38],
  u: [219, 39, 119],
  l: [124, 58, 237],
};

interface Rgba {
  width: number;
  height: number;
  data: Uint8Array | Buffer;
}

function blend(img: Rgba, x: number, y: number, rgb: [number, number, number], alpha: number) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const a = Math.min(1, alpha);
  img.data[i] = img.data[i]! * (1 - a) + rgb[0] * a;
  img.data[i + 1] = img.data[i + 1]! * (1 - a) + rgb[1] * a;
  img.data[i + 2] = img.data[i + 2]! * (1 - a) + rgb[2] * a;
}

/** Coverage of a pixel from a distance in pixels (1 px anti-aliasing). */
const cover = (dPx: number) => Math.max(0, Math.min(1, 0.5 - dPx));

function drawBadge(img: Rgba, cx: number, cy: number, r: number, code: BadgeCode) {
  const color = COLORS[code];
  const pad = Math.ceil(r * 1.25);
  for (let py = Math.floor(cy - pad); py <= cy + pad; py++) {
    for (let px = Math.floor(cx - pad); px <= cx + pad; px++) {
      const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
      const dist = len(dx, dy);
      // Soft shadow, white ring, coloured disc.
      blend(img, px, py, [0, 0, 0], 0.35 * Math.max(0, Math.min(1, (r * 1.18 - len(dx - r * 0.06, dy - r * 0.1)) / (r * 0.18))));
      blend(img, px, py, [255, 255, 255], cover(dist - r));
      blend(img, px, py, color, cover(dist - r * 0.88));
      const u = dx / r, v = dy / r;
      for (const [shape, opacity] of ICONS[code]) {
        blend(img, px, py, [255, 255, 255], cover(shape(u, v) * r) * opacity);
      }
    }
  }
}

/** Draws the badges into the top-right corner, first code right-most. */
export function drawBadges(img: Rgba, codes: string): void {
  const r = Math.max(10, Math.round(img.width * 0.085));
  const margin = Math.round(img.width * 0.035);
  let cx = img.width - margin - r;
  const cy = margin + r;
  for (const code of codes) {
    if (!(code in ICONS)) continue;
    drawBadge(img, cx, cy, r, code as BadgeCode);
    cx -= r * 2 + Math.round(r * 0.3);
  }
}

/** JPEG or PNG in, JPEG with badges out. */
export function renderBadgedPoster(bytes: Uint8Array, codes: string): Buffer {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const img = isPng ? decodePng(bytes) : jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
  drawBadges(img, codes);
  return jpeg.encode({ data: img.data, width: img.width, height: img.height }, 88).data;
}
