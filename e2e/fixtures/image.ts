import zlib from "node:zlib";

// Builds a real PNG of the given size with a smooth gradient — big enough that the
// ImageReader renders it at a draggable size in the e2e (a 1x1 fixture renders at
// 1px, below the rubber-band's min-size threshold). Pure, deps-free (node zlib).
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

export function makeGradientPng(width = 200, height = 150): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const off = y * (width * 3 + 1);
    raw[off] = 0; // filter byte (none)
    for (let x = 0; x < width; x += 1) {
      const p = off + 1 + x * 3;
      raw[p] = Math.floor((x * 255) / width);
      raw[p + 1] = Math.floor((y * 255) / height);
      raw[p + 2] = 128;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
