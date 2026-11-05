// Pictures the window can't load itself, read by the plugin and drawn
// from their bytes: Flux's uploads, which it shows its members only, with
// the API token, and avatars elsewhere on the web. Bytes are kept once
// and named in a recording by their hash, not carried in each.
import { ui } from "swarm";
import { fluxAssetId } from "./assets";
import type { FluxClient } from "./client";
import { hub } from "./hub";

/** Where a Flux's uploads are read from: a connection, or a client of one that isn't kept yet. */
export interface PictureSource {
	readonly baseUrl: string;
	requireClient(): FluxClient;
}

// Tracked: a render that drew a picture still coming draws it once it's here.
const got = ui.store(new Map<string, Uint8Array | "loading" | "failed">());

/**
 * A picture's bytes, read once; null while they come, or when they can't.
 * Flux's uploads are read through from, the active Flux unless it's said:
 * each Flux's client reads its own workspace's.
 */
export function pictureBytes(src: string | null | undefined, from: PictureSource = hub.active): Uint8Array | null {
	if (!src) return null;
	const flux = from;
	const id = fluxAssetId(src, flux.baseUrl);
	const key = id ? `asset:${flux.baseUrl}#${id}` : src;
	const have = got.get(key);
	if (have instanceof Uint8Array) return have;
	if (have) return null;
	if (!id && !/^https?:\/\//i.test(src)) return null;
	let client: FluxClient | null = null;
	if (id) {
		try {
			client = flux.requireClient();
		} catch {
			// Not connected yet: read once it is.
			return null;
		}
	}
	got.set(key, "loading");
	const read = client
		? client.asset(id!).then((a) => new Uint8Array(a.bytes))
		: fetch(src).then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return new Uint8Array(await res.arrayBuffer());
			});
	read.then(
		(bytes) => void got.set(key, bytes),
		() => void got.set(key, "failed"),
	);
	return null;
}

/** An image's src for Markdown: Flux's uploads as bytes once read, others as they are. The active Flux's. */
export function imageOf(src: string): string | Uint8Array | null {
	return imageIn(hub.active, src);
}

const imageOfs = new WeakMap<PictureSource, (src: string) => string | Uint8Array | null>();

/** imageOf for one Flux's uploads: an issue's, shown in a thread while another is active. */
export function imageFrom(from: PictureSource): (src: string) => string | Uint8Array | null {
	if (from === hub.active) return imageOf;
	let of = imageOfs.get(from);
	if (!of) imageOfs.set(from, (of = (src) => imageIn(from, src)));
	return of;
}

function imageIn(from: PictureSource, src: string): string | Uint8Array | null {
	const id = fluxAssetId(src, from.baseUrl);
	if (!id) return src;
	const bytes = pictureBytes(src, from);
	if (bytes) return bytes;
	return got.get(`asset:${from.baseUrl}#${id}`) === "failed" ? src : null;
}
