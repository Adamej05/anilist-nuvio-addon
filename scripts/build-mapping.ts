/**
 * Downloads Fribb/anime-lists and writes the compact AniList -> Kitsu/IMDb mapping.
 * Run with Node >= 22.18 (runs TypeScript directly):
 *   node scripts/build-mapping.ts out/mapping.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { convertFribb, type FribbEntry } from "../src/mappingFormat.ts";

const FRIBB_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const out = process.argv[2] ?? "out/mapping.json";

const res = await fetch(FRIBB_URL);
if (!res.ok) throw new Error(`Fribb HTTP ${res.status}`);
const list = (await res.json()) as FribbEntry[];
const mapping = convertFribb(list);
const count = Object.keys(mapping).length;
// A sudden drop means the source broke; do not publish that.
if (count < 10000) throw new Error(`only ${count} mapped entries, refusing to publish`);

await mkdir(dirname(out), { recursive: true });
const text = JSON.stringify(mapping);
await writeFile(out, text);
console.log(`wrote ${out}: ${count} entries, ${text.length} bytes (from ${list.length} Fribb entries)`);
