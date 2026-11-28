// Watching every server's backups, whether the page shows or not: each
// backup task (vzdump) that ends failed, a toast saying which server and
// why. Proxmox has no events to follow: its tasks are asked every few
// minutes, and what each server last ended is kept (storage), so a
// failure is told once, and none from before Swarm started is.
import { storage, ui } from "swarm";
import * as api from "./pve";
import { connOf, servers } from "./servers";

/** How often the tasks are asked: a test shortens it. */
export const WATCH = { every: 3 * 60_000 };

/** When each server's last task ended that's been looked at, by server: kept, else for this run. */
const seenHere = new Map<string, number>();

function seen(id: string): number | undefined {
	try {
		return storage.get<Record<string, number>>("backupsSeen")?.[id] ?? seenHere.get(id);
	} catch {
		return seenHere.get(id);
	}
}

function setSeen(id: string, at: number) {
	seenHere.set(id, at);
	try {
		storage.set("backupsSeen", { ...(storage.get<Record<string, number>>("backupsSeen") ?? {}), [id]: at });
	} catch {
		// Without storage, for this run only.
	}
}

/** Looks at each server's tasks once: a toast for each backup that failed since last time. */
export async function checkBackups() {
	for (const s of servers()) {
		const c = connOf(s);
		if (!c) continue;
		let tasks: api.Task[];
		try {
			tasks = await api.tasks(c);
		} catch {
			continue; // Unreachable for now: the page says why, as it shows it.
		}
		const ended = tasks.filter((t) => t.endtime);
		const latest = Math.max(0, ...ended.map((t) => t.endtime!));
		const since = seen(s.id);
		if (since !== undefined) {
			const failed = ended.filter((t) => t.type === "vzdump" && t.endtime! > since && api.taskOk(t) === false);
			for (const t of failed) {
				const what = t.id ? `of ${t.id} ` : "";
				ui.toast(`A backup ${what}on ${s.name} failed: ${(t.status ?? "").replace(/^TASK ERROR:\s*/, "") || "see its log"}.`, { action: "Open Proxmox", href: "swarm://plugin/proxmox" });
			}
		}
		if (since === undefined || latest > since) setSeen(s.id, Math.max(latest, since ?? 0));
	}
}

let timer: number | undefined;
let stopped = false;

export function watchBackups() {
	if (stopped || timer !== undefined) return;
	timer = setTimeout(() => {
		timer = undefined;
		void checkBackups().finally(watchBackups);
	}, WATCH.every);
}

export function stopWatchingBackups() {
	stopped = true;
	if (timer !== undefined) clearTimeout(timer);
	timer = undefined;
}
