/**
 * Smaller 3D looks: a generated model's JPEG textures come at 2048 px and are most of the file.
 * Each one larger than `size` is scaled down (area average) and saved again as JPEG; the geometry
 * and any other image stay as they are. A file that is not a GLB, or fails to read, comes back unchanged.
 */
import jpeg from 'jpeg-js';

const pad4 = (n: number) => (n + 3) & ~3;

/** RGBA pixels scaled down to fit `size`, each target pixel the average of the source pixels it covers. */
function scaleDown(src: { width: number; height: number; data: Uint8Array }, size: number) {
  const k = size / Math.max(src.width, src.height);
  const width = Math.max(1, Math.round(src.width * k)), height = Math.max(1, Math.round(src.height * k));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * src.height) / height), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * src.width) / width), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / width));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * src.width + sx) * 4;
        r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
      }
      const o = (y * width + x) * 4;
      data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

// shortcut: decoding a 2048 px JPEG in plain JavaScript holds the server for a few hundred ms, once per model.
export function shrinkGlb(glb: Uint8Array, size = 512): Uint8Array {
  try {
    const buf = Buffer.from(glb.buffer, glb.byteOffset, glb.byteLength);
    if (buf.readUInt32LE(0) !== 0x46546c67) return glb;
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
      images?: { bufferView?: number; mimeType?: string }[];
      bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
      buffers: { byteLength: number }[];
    };
    const binAt = 20 + jsonLen;
    if (json.buffers.length !== 1 || binAt + 8 > buf.length) return glb;
    const bin = buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt));
    const views = json.bufferViews.map((v) => bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
    let changed = false;
    for (const img of json.images ?? []) {
      if (img.bufferView === undefined || img.mimeType !== 'image/jpeg') continue;
      const pic = jpeg.decode(views[img.bufferView], { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 17, maxMemoryUsageInMB: 256 });
      if (Math.max(pic.width, pic.height) <= size) continue;
      views[img.bufferView] = jpeg.encode(scaleDown(pic, size), 85).data;
      changed = true;
    }
    if (!changed) return glb;
    // The binary chunk again: the views in order, each on a 4-byte boundary.
    let offset = 0;
    const parts: Buffer[] = [];
    json.bufferViews.forEach((v, i) => {
      v.byteOffset = offset;
      v.byteLength = views[i].length;
      parts.push(Buffer.from(views[i]), Buffer.alloc(pad4(views[i].length) - views[i].length));
      offset = pad4(offset + views[i].length);
    });
    json.buffers[0].byteLength = offset;
    let text = Buffer.from(JSON.stringify(json));
    text = Buffer.concat([text, Buffer.alloc(pad4(text.length) - text.length, 0x20)]);
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(20);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
    head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(body.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
    return new Uint8Array(Buffer.concat([head, text, binHead, body]));
  } catch {
    return glb;
  }
}
