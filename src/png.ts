import { inflateSync } from "node:zlib";

/**
 * Minimal PNG decoder for AniList covers: 8-bit, non-interlaced,
 * greyscale / RGB / palette / grey+alpha / RGBA. Returns RGBA pixels
 * (alpha is flattened onto white later, the output is a JPEG).
 * Throws on anything else; the caller then serves the plain cover.
 */
export function decodePng(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error("not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette: Uint8Array | undefined;
  let paletteAlpha: Uint8Array | undefined;
  const idat: Uint8Array[] = [];

  for (let pos = 8; pos + 8 <= bytes.length; ) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") paletteAlpha = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }

  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (depth ${bitDepth}, interlace ${interlace})`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || width <= 0 || height <= 0 || width * height > 20_000_000) throw new Error("unsupported PNG");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let v = line[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0, o = 0; p < width * height; p++, o += 4) {
    const s = p * channels;
    let r: number, g: number, b: number, alpha = 255;
    if (colorType === 0) r = g = b = pixels[s]!;
    else if (colorType === 4) { r = g = b = pixels[s]!; alpha = pixels[s + 1]!; }
    else if (colorType === 3) {
      const idx = pixels[s]!;
      if (!palette) throw new Error("PNG palette missing");
      r = palette[idx * 3]!; g = palette[idx * 3 + 1]!; b = palette[idx * 3 + 2]!;
      alpha = paletteAlpha?.[idx] ?? 255;
    } else { r = pixels[s]!; g = pixels[s + 1]!; b = pixels[s + 2]!; if (colorType === 6) alpha = pixels[s + 3]!; }
    // Flatten transparency onto white.
    const k = alpha / 255;
    rgba[o] = r * k + 255 * (1 - k);
    rgba[o + 1] = g * k + 255 * (1 - k);
    rgba[o + 2] = b * k + 255 * (1 - k);
    rgba[o + 3] = 255;
  }
  return { width, height, data: rgba };
}
