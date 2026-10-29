// Pictures the window can't load itself, read by the plugin and drawn
// from their bytes: Flux's uploads, which it shows its members only, with
// the API token, and avatars elsewhere on the web. Bytes are kept once
// and named in a recording by their hash, not carried in each.
import { ui } from "swarm";
import { fluxAssetId } from "./assets";
import { hub } from "./hub";

const got = new Map<string, Uint8Array | "loading" | "failed">();

/** A picture's bytes, read once; null while they come, or when they can't. */
export function pictureBytes(src: string | null | undefined): Uint8Array | null {
	if (!src) return null;
	const flux = hub.active;
	const id = fluxAssetId(src, flux.baseUrl);
	const key = id ? `asset:${flux.baseUrl}#${id}` : src;
	const have = got.get(key);
	if (have instanceof Uint8Array) return have;
	if (have) return null;
	if (!id && !/^https?:\/\//i.test(src)) return null;
	got.set(key, "loading");
	const read = id
		? flux.requireClient().asset(id).then((a) => new Uint8Array(a.bytes))
		: fetch(src).then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return new Uint8Array(await res.arrayBuffer());
			});
	read
		.then(
			(bytes) => void got.set(key, bytes),
			() => void got.set(key, "failed"),
		)
		.finally(() => ui.update());
	return null;
}

/** An image's src for Markdown: Flux's uploads as bytes once read, others as they are. */
export function imageOf(src: string): string | Uint8Array | null {
	if (!fluxAssetId(src, hub.active.baseUrl)) return src;
	const bytes = pictureBytes(src);
	if (bytes) return bytes;
	return got.get(`asset:${hub.active.baseUrl}#${fluxAssetId(src, hub.active.baseUrl)}`) === "failed" ? src : null;
}
