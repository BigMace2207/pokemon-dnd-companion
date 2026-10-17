// A small ZIP reader (EPUB and DOCX files are ZIP archives). It reads the central directory and
// inflates entries with the browser's built-in DecompressionStream("deflate-raw"); no library.

const dec = new TextDecoder("utf-8");

export class Zip {
  constructor(buffer) {
    this.buf = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.entries = new Map();
    this.#readDirectory();
  }

  #readDirectory() {
    const v = this.view;
    let eocd = -1;
    for (let i = this.bytes.length - 22; i >= Math.max(0, this.bytes.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("That file isn't a valid ZIP-based book.");
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const flags = v.getUint16(p + 8, true);
      const method = v.getUint16(p + 10, true);
      const csize = v.getUint32(p + 20, true);
      const usize = v.getUint32(p + 24, true);
      const nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      const offset = v.getUint32(p + 42, true);
      const name = dec.decode(this.bytes.subarray(p + 46, p + 46 + nlen));
      this.entries.set(name, { name, method, csize, usize, offset, utf8: !!(flags & 0x800) });
      p += 46 + nlen + elen + clen;
    }
  }

  has(name) { return this.entries.has(name); }
  names() { return [...this.entries.keys()]; }

  // case-insensitive, and tolerant of ./ and %20 in hrefs
  find(name) {
    if (this.entries.has(name)) return name;
    const clean = decodeURIComponent(name).replace(/^\.\//, "");
    if (this.entries.has(clean)) return clean;
    const low = clean.toLowerCase();
    for (const k of this.entries.keys()) if (k.toLowerCase() === low) return k;
    return null;
  }

  async bytesOf(name) {
    const key = this.find(name);
    if (!key) return null;
    const e = this.entries.get(key);
    const v = this.view;
    const lh = e.offset;
    const nlen = v.getUint16(lh + 26, true), elen = v.getUint16(lh + 28, true);
    const start = lh + 30 + nlen + elen;
    const raw = this.bytes.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new Error("Unsupported compression in this book.");
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async text(name) {
    const b = await this.bytesOf(name);
    return b ? dec.decode(b) : null;
  }
}
