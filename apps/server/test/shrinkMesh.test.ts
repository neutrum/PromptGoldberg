import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { shrinkGlb } from '../src/shrinkMesh';

/** A GLB with one buffer view (a JPEG) and some geometry bytes after it. */
function glbWith(image: Uint8Array, geometry = new Uint8Array(40).fill(7)) {
  const pad = (n: number) => (n + 3) & ~3;
  const json = { asset: { version: '2.0' }, images: [{ bufferView: 0, mimeType: 'image/jpeg' }], buffers: [{ byteLength: 0 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: image.length }, { buffer: 0, byteOffset: pad(image.length), byteLength: geometry.length }] };
  const body = Buffer.concat([Buffer.from(image), Buffer.alloc(pad(image.length) - image.length), Buffer.from(geometry)]);
  json.buffers[0].byteLength = body.length;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc(pad(text.length) - text.length, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + text.length + body.length, 8);
  head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const bin = Buffer.alloc(8); bin.writeUInt32LE(body.length, 0); bin.writeUInt32LE(0x004e4942, 4);
  return new Uint8Array(Buffer.concat([head, text, bin, body]));
}
const read = (glb: Uint8Array) => {
  const b = Buffer.from(glb), n = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + n).toString());
  const bin = b.subarray(28 + n), view = (i: number) => bin.subarray(json.bufferViews[i].byteOffset, json.bufferViews[i].byteOffset + json.bufferViews[i].byteLength);
  return { length: b.readUInt32LE(8), image: jpeg.decode(view(0)), geometry: view(1) };
};

describe('shrinkGlb', () => {
  const noisy = (size: number) => ({ width: size, height: size, data: Buffer.from(Array.from({ length: size * size * 4 }, (_, i) => (i * 7919) % 256)) });

  it('scales a big texture down to 512 px and keeps the geometry byte for byte', () => {
    const glb = glbWith(jpeg.encode(noisy(1024), 90).data);
    const out = shrinkGlb(glb);
    const r = read(out);
    expect(out.length).toBeLessThan(glb.length / 2);
    expect(r.length).toBe(out.length);
    expect([r.image.width, r.image.height]).toEqual([512, 512]);
    expect([...r.geometry]).toEqual(new Array(40).fill(7));
  });

  it('leaves small textures and anything that is not a GLB alone', () => {
    const small = glbWith(jpeg.encode(noisy(256), 90).data);
    expect(shrinkGlb(small)).toBe(small);
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(shrinkGlb(junk)).toBe(junk);
  });
});
