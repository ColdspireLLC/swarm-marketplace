// A PNG of RGB pixels, made in JavaScript (zlib's stored blocks, no
// compression): the demo machine's screen, which needs no hardware.

const crcTable = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(parts: Uint8Array[]): number {
	let c = 0xffffffff;
	for (const p of parts) for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function chunk(type: string, data: Uint8Array): Uint8Array[] {
	const t = ascii(type);
	return [be32(data.length), t, data, be32(crc32([t, data]))];
}

/** A screen: width × height RGB pixels. */
export class Screen {
	readonly px: Uint8Array;
	constructor(
		readonly width: number,
		readonly height: number,
	) {
		this.px = new Uint8Array(width * height * 3);
	}

	fill(x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
		for (let j = Math.max(0, y); j < Math.min(this.height, y + h); j++) {
			for (let i = Math.max(0, x); i < Math.min(this.width, x + w); i++) {
				const o = (j * this.width + i) * 3;
				this.px[o] = rgb[0];
				this.px[o + 1] = rgb[1];
				this.px[o + 2] = rgb[2];
			}
		}
	}

	/** The screen as a PNG. */
	png(): Uint8Array {
		const row = this.width * 3 + 1;
		const raw = new Uint8Array(row * this.height);
		for (let y = 0; y < this.height; y++) raw.set(this.px.subarray(y * this.width * 3, (y + 1) * this.width * 3), y * row + 1);
		// zlib: a header, stored blocks of 65535 at most, Adler-32.
		const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
		for (let i = 0; i < raw.length || i === 0; i += 65535) {
			const part = raw.subarray(i, Math.min(raw.length, i + 65535));
			const last = i + 65535 >= raw.length ? 1 : 0;
			blocks.push(new Uint8Array([last, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255]), part);
		}
		let a = 1, b = 0;
		for (let i = 0; i < raw.length; i++) {
			a = (a + raw[i]!) % 65521;
			b = (b + a) % 65521;
		}
		blocks.push(be32(((b << 16) | a) >>> 0));
		const idat = concat(blocks);
		const ihdr = concat([be32(this.width), be32(this.height), new Uint8Array([8, 2, 0, 0, 0])]);
		return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunk("IHDR", ihdr), ...chunk("IDAT", idat), ...chunk("IEND", new Uint8Array(0))]);
	}
}

export function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes as base64. */
export function base64(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
		s += b64[(n >> 18) & 63]! + b64[(n >> 12) & 63]! + (i + 1 < bytes.length ? b64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? b64[n & 63] : "=");
	}
	return s;
}

/** A PNG's or a JPEG's size, from its header: for keeping its place while the next one loads. */
export function imageSize(d: Uint8Array): { width: number; height: number } | null {
	const u32 = (o: number) => ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;
	const u16 = (o: number) => (d[o]! << 8) | d[o + 1]!;
	// PNG: the signature, then IHDR's width and height.
	if (d.length >= 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return { width: u32(16), height: u32(20) };
	// JPEG: the segments to the first start of frame (SOF0–SOF15 but DHT, JPG and DAC).
	if (d.length >= 4 && d[0] === 0xff && d[1] === 0xd8) {
		let o = 2;
		while (o + 9 < d.length) {
			if (d[o] !== 0xff) return null;
			const marker = d[o + 1]!;
			if (marker === 0xff) {
				o++;
				continue;
			}
			const len = u16(o + 2);
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16(o + 7), height: u16(o + 5) };
			o += 2 + len;
		}
	}
	return null;
}
