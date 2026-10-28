// What someone is typing, kept here so a recording of the page does not
// put the server's copy back over it. A picture still uploading stays
// until its URL arrives.
import { ui } from "swarm";

const drafts = new Map<string, string>();
const timers = new Map<string, number>();

export function drafted(key: string, server: string): string {
	return drafts.has(key) ? drafts.get(key)! : server;
}

export function setDraft(key: string, markdown: string) {
	drafts.set(key, markdown);
}

export function editDraft(key: string, markdown: string, save: (markdown: string) => Promise<void>) {
	drafts.set(key, markdown);
	if (markdown.includes("flux-local:")) return;
	const pending = timers.get(key);
	if (pending) clearTimeout(pending);
	timers.set(key, setTimeout(() => {
		timers.delete(key);
		const current = drafts.get(key);
		if (current === undefined || current.includes("flux-local:")) return;
		void save(current).then(() => {
			if (drafts.get(key) === current) drafts.delete(key);
		}, (error: unknown) => {
			ui.toast(error instanceof Error ? error.message : String(error));
		});
	}, 400));
}

/** Puts an uploaded picture's URL where its placeholder was, and saves. keep leaves the draft, as a comment still being written. */
export async function finishUpload(key: string, fileId: string, url: string, save: (markdown: string) => Promise<void>, keep = false) {
	const current = drafts.get(key);
	if (current === undefined || !current.includes("flux-local:" + fileId)) return;
	const next = current.replaceAll("flux-local:" + fileId, url);
	drafts.set(key, next);
	ui.update();
	if (next.includes("flux-local:")) return;
	await save(next);
	if (!keep && drafts.get(key) === next) drafts.delete(key);
	ui.update();
}

export function clearDraft(key: string) {
	drafts.delete(key);
	const pending = timers.get(key);
	if (pending) clearTimeout(pending);
	timers.delete(key);
}
