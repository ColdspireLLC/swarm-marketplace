// A Flux workspace, as the plugin keeps a copy of it: pulled from Flux's
// sync API into the plugin's storage, then kept live on Flux's event
// stream (GET /sync/events), and changed by pushes of whole items,
// retried when another change won. Ported from bb's service.ts and
// replica.ts, which kept it in SQLite.
import swarm, { storage } from "swarm";
import { z } from "zod";
import type { CommentAgent } from "./agent";
import { parseCommentAgent } from "./agent";
import { FluxClient, FluxHttpError, describe, isUnauthorized, isUnreachable, type Account, type SyncItem, type SyncOp } from "./client";
import { htmlToMarkdown, markdownToHtml } from "./content";
import type { Comment, Issue, IssueDetail, IssuePatch, Label, Member, Project } from "./contract";
import { parseDescription, descriptionState, writeLiveDescription } from "./description";
import { ItemStore } from "./store";
import { aliasesAfter, keyOwner, keyProblem as formatProblem, normalizeProjectKey, uniqueProjectKey, type Keyed } from "./keys";
import { COLORS, CLOSED_STATUSES, PRIORITIES, STATUSES, parseIssueKey, type ColorName, type Priority, type Status } from "./flux";

export class FluxNotReadyError extends Error {
	name = "FluxNotReadyError";
}
export class FluxNotFoundError extends Error {
	name = "FluxNotFoundError";
}

export type State = "unconfigured" | "connecting" | "ready" | "offline" | "unauthorized" | "error";

type Write = { itemId: string; baseVersion: number; body: Record<string, unknown> | null };

/**
 * A change that can wait for Flux, as bb's: as data, so it outlives a
 * restart; its writes are built again from the copy when it's sent.
 */
type PendingChange =
	| { type: "issue"; id: string; patch: IssuePatch }
	| { type: "description"; id: string; markdown: string }
	| { type: "comment"; id: string; body: Record<string, unknown> }
	| { type: "commentEdit"; id: string; html: string }
	| { type: "commentDelete"; id: string }
	| { type: "label"; id: string; body: Record<string, unknown> }
	| { type: "project"; id: string; body: Record<string, unknown> }
	| { type: "projectEdit"; id: string; patch: ProjectPatch }
	| { type: "projectOrder"; ids: string[] }
	| { type: "projectDelete"; id: string };

/** A project's mark as Flux keeps it: an icon of its gallery in one of its colors, or an emoji. */
export type ProjectMarkValue = { type: "icon"; value: string; color: ColorName } | { type: "emoji"; value: string };

/** What a project's settings change: its name, its key (the old one kept as an alias) and its mark. */
export interface ProjectPatch {
	name?: string;
	key?: string;
	mark?: ProjectMarkValue;
}

interface Queued {
	seq: number;
	/** What it is, if it can't be sent: "Comment on ABC-12". */
	label: string;
	change: PendingChange;
}

/** A change made offline that Flux didn't take, or that no longer applied, kept to say so. */
export interface Dropped {
	id: string;
	label: string;
	reason: string;
	at: string;
}

const MAX_DROPPED = 20;

/** The longest name Flux gives a project. */
export const PROJECT_NAME_MAX = 60;

interface Item {
	id: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	body: Record<string, unknown>;
}

interface Replica {
	scope: string;
	version: number;
	items: Record<string, Item>;
}

const FALLBACK_MS = 30_000;
const SAFETY_MS = 5 * 60_000;
const PULL_DEBOUNCE_MS = 150;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asString = (v: unknown) => (typeof v === "string" ? v : "");
const asNumber = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const asStringList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const asStatus = (v: unknown): Status => ((STATUSES as readonly string[]).includes(v as string) ? (v as Status) : "todo");
const asPriority = (v: unknown): Priority => ((PRIORITIES as readonly string[]).includes(v as string) ? (v as Priority) : "none");
const asColor = (v: unknown): ColorName => ((COLORS as readonly string[]).includes(v as string) ? (v as ColorName) : "gray");
const asDueDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const unique = <T>(xs: T[]) => [...new Set(xs)];

/** A Flux workspace, as one URL and token reach it. */
export class Flux {
	state: State = "unconfigured";
	message = "";
	client: FluxClient | null = null;
	me: Account | null = null;
	workspace: { id: string; name: string; slug: string; color?: string; imageUrl?: string | null } | null = null;
	members: Member[] = [];
	private replica: Replica;
	/** The copy on disk, and what of it changed since it was last written. */
	private readonly disk: ItemStore;
	private dirty = new Set<string>();
	private cleared = false;
	private loaded: Promise<void>;
	/** The changes made while Flux couldn't be reached, oldest first, and those it didn't take. */
	private queue: Queued[] = [];
	private dropped: Dropped[] = [];
	/** The synced items the queue's changes show over, by id; undefined where the item is new. */
	private shadow = new Map<string, Item | undefined>();
	private sending = false;
	/** When the copy last caught up with Flux. */
	private syncedAt: string | null = null;
	private stopFollow: AbortController | null = null;
	private pullSoon: number | null = null;
	private ready: Promise<void> = Promise.resolve();
	private generation = 0;
	private configured = "";
	private device = "";
	/** Told after what the copy has changes. */
	onChange: () => void = () => {};

	/** id names the connection. storePrefix keeps its copy apart from the first one's. */
	constructor(readonly id = "default", private readonly storePrefix = "") {
		this.replica = { scope: "", version: -1, items: {} };
		this.disk = new ItemStore(storePrefix || "default");
		// The copy was one value once, which ran out of memory on a big
		// workspace: it's the database's now, and the old one is dropped.
		if (storage.keys().includes(this.storeKey("replica"))) storage.delete(this.storeKey("replica"));
		const meta = storage.get<{ scope: string; version: number }>(this.storeKey("copy"));
		this.loaded = meta
			? this.disk.load().then(
					(items) => {
						this.replica = { scope: meta.scope, version: meta.version, items };
						this.replayQueue();
						this.onChange();
					},
					() => {},
				)
			: Promise.resolve();
		this.queue = storage.get<Queued[]>(this.storeKey("queue")) ?? [];
		this.dropped = storage.get<Dropped[]>(this.storeKey("dropped")) ?? [];
		this.syncedAt = storage.get<string>(this.storeKey("syncedAt")) ?? null;
		this.members = storage.get<Member[]>(this.storeKey("members")) ?? [];
		this.me = storage.get<Account>(this.storeKey("me")) ?? null;
	}

	private storeKey(name: "replica" | "copy" | "members" | "me" | "queue" | "dropped" | "syncedAt") {
		return this.storePrefix ? `${this.storePrefix}:${name}` : name;
	}

	get baseUrl() {
		return this.client?.baseUrl ?? "";
	}

	/** Connects with url and token, or none. The same pair leaves the stream up. */
	configure(url: string, token: string) {
		url = url.trim();
		token = token.trim();
		const next = `${url}\n${token}`;
		if (next === this.configured && (this.client || this.state === "unconfigured")) return;
		this.configured = next;
		this.generation++;
		this.stopFollow?.abort();
		this.stopFollow = new AbortController();
		if (this.pullSoon !== null) clearTimeout(this.pullSoon);
		this.pullSoon = null;
		if (!url || !token) {
			this.client = null;
			this.state = "unconfigured";
			this.message = !url ? "Set Flux's URL in Settings, Plugins, Flux." : "Set an API token (Flux: Settings, API tokens).";
			this.onChange();
			return;
		}
		let deviceId = storage.get<string>("deviceId");
		if (!deviceId) storage.set("deviceId", (deviceId = crypto.randomUUID()));
		this.device = deviceId;
		try {
			this.client = new FluxClient({ baseUrl: url, token, deviceId });
		} catch (e) {
			this.client = null;
			this.state = "error";
			this.message = describe(e);
			this.onChange();
			return;
		}
		this.state = "connecting";
		this.message = "";
		this.onChange();
		const gen = this.generation;
		this.ready = this.connect(gen);
	}

	/** The URL as set, which may not be one Flux takes. */
	get url() {
		return this.configured.split("\n")[0] ?? "";
	}

	/** Connects again from nothing: the account, the workspace, every item. Its threads' links stay. */
	resync(): Promise<void> {
		const [url = "", token = ""] = this.configured.split("\n");
		this.reset(this.replica.scope);
		this.configured = "";
		this.configure(url, token);
		return this.ready;
	}

	/** Stops, and drops the copy of the workspace, the account and the members. */
	forget() {
		this.stop();
		this.client = null;
		this.state = "unconfigured";
		this.message = "";
		this.workspace = null;
		this.me = null;
		this.members = [];
		this.reset("");
		this.cleared = false;
		void this.disk.write([], [], true).catch(() => {});
		for (const name of ["copy", "members", "me"] as const) storage.delete(this.storeKey(name));
		this.onChange();
	}

	stop() {
		this.generation++;
		this.configured = "";
		this.stopFollow?.abort();
		this.stopFollow = null;
		if (this.pullSoon !== null) clearTimeout(this.pullSoon);
		this.pullSoon = null;
	}

	private async connect(gen: number): Promise<void> {
		const client = this.client!;
		try {
			await this.loaded;
			client.workspaceId = null;
			this.me = await client.me();
			const ws = await client.workspace();
			if (!ws.id) throw new Error("Finish setting up your Flux workspace in Flux first.");
			client.workspaceId = ws.id;
			this.workspace = ws;
			const scope = `${client.baseUrl}#${ws.id}`;
			if (this.replica.scope !== scope) {
				this.reset(scope);
				if (!this.storePrefix) storage.set("links", {});
			}
			this.members = (await client.members()).members.map(member);
			storage.set(this.storeKey("members"), this.members);
			storage.set(this.storeKey("me"), this.me);
			await this.pull();
			if (gen !== this.generation) return;
			this.state = "ready";
			this.message = "";
			void this.flush();
		} catch (e) {
			if (gen !== this.generation) return;
			this.fail(e);
		}
		this.onChange();
		if (gen === this.generation && this.client && this.state !== "unauthorized") void this.follow(gen);
	}

	private fail(e: unknown) {
		// In the plugin's log too, with the URL, as the page says it in a line.
		console.warn(`Flux at ${this.baseUrl || this.url || "(no URL)"}: ${describe(e)}`);
		if (isUnauthorized(e)) {
			this.state = "unauthorized";
			this.message = (e as Error).message;
		} else if (isUnreachable(e)) {
			this.state = "offline";
			this.message = describe(e);
		} else {
			this.state = "error";
			this.message = describe(e);
		}
	}

	/** Follows Flux's event stream, pulling when something changed. A server without one is polled. */
	private async follow(gen: number): Promise<void> {
		const signal = this.stopFollow?.signal;
		let delay = 1000;
		while (gen === this.generation && !signal?.aborted) {
			const client = this.client;
			if (!client || !signal) return;
			try {
				const body = await client.events(signal);
				if (gen !== this.generation || signal.aborted) return;
				if (!body) {
					await wait(FALLBACK_MS, signal);
					if (gen !== this.generation || signal.aborted) return;
					try {
						await this.pull();
					} catch (e) {
						if (isUnauthorized(e)) {
							this.fail(e);
							this.onChange();
							return;
						}
					}
					continue;
				}
				delay = 1000;
				await this.consumeEvents(body, gen, signal);
				// The server closed the stream. Catch up, then wait before
				// opening it again: a stream that ends at once must not
				// reconnect in a loop.
				delay = FALLBACK_MS;
			} catch (e) {
				if (gen !== this.generation || signal.aborted) return;
				if (isUnauthorized(e)) {
					this.fail(e);
					this.onChange();
					return;
				}
				if (this.state === "ready") {
					this.state = "offline";
					this.message = describe(e);
					this.onChange();
				}
			}
			await wait(delay, signal);
			delay = Math.min(delay * 2, FALLBACK_MS);
			if (gen !== this.generation || signal.aborted) return;
			if (!this.workspace || !this.me) {
				// Flux was out of reach from the start: the account, the
				// workspace and its members are still to load, then the
				// stream is followed afresh.
				await this.connect(gen);
				return;
			}
			try {
				await this.pull();
				if (gen === this.generation && this.state !== "unauthorized") {
					this.state = "ready";
					this.message = "";
					this.onChange();
					void this.flush();
				}
			} catch (e) {
				if (isUnauthorized(e)) {
					this.fail(e);
					this.onChange();
					return;
				}
			}
		}
	}

	private async consumeEvents(body: ReadableStream<Uint8Array>, gen: number, signal: AbortSignal) {
		const reader = body.getReader();
		const dec = new TextDecoder();
		let buf = "";
		const safety = setInterval(() => {
			void this.pull().catch(() => {});
		}, SAFETY_MS);
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done || gen !== this.generation || signal.aborted) return;
				buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
				let boundary = buf.indexOf("\n\n");
				while (boundary !== -1) {
					const frame = buf.slice(0, boundary);
					buf = buf.slice(boundary + 2);
					this.onFluxEvent(parseSSE(frame), gen);
					boundary = buf.indexOf("\n\n");
				}
			}
		} finally {
			clearInterval(safety);
			reader.releaseLock();
		}
	}

	private onFluxEvent(frame: { event: string; data: string } | null, gen: number) {
		if (!frame) return;
		let data: Record<string, unknown> = {};
		try {
			const parsed = JSON.parse(frame.data);
			if (isObject(parsed)) data = parsed;
		} catch {
			return;
		}
		if (data.workspaceId !== this.workspace?.id) return;
		if (frame.event === "changed") {
			if (data.originDeviceId === this.device) return;
			this.schedulePull(gen);
		} else if (frame.event === "meta") {
			void this.refreshMembers().catch(() => {});
		} else if (frame.event === "reset") {
			this.reset(this.replica.scope);
			this.save();
			this.schedulePull(gen);
		}
	}

	private schedulePull(gen: number) {
		if (this.pullSoon !== null) clearTimeout(this.pullSoon);
		this.pullSoon = setTimeout(() => {
			this.pullSoon = null;
			if (gen !== this.generation) return;
			void this.pull().catch((e) => {
				if (isUnauthorized(e)) {
					this.fail(e);
					this.onChange();
				}
			});
		}, PULL_DEBOUNCE_MS);
	}

	private async refreshMembers() {
		const client = this.requireClient();
		this.members = (await client.members()).members.map(member);
		storage.set(this.storeKey("members"), this.members);
		this.onChange();
	}

	/** Waits for the first sync, ten seconds at most. */
	async whenReady(): Promise<void> {
		if (this.state === "unconfigured") throw new FluxNotReadyError(this.message || "Flux isn't set up: set its URL and an API token in Settings, Plugins, Flux.");
		await Promise.race([this.ready, new Promise((r) => setTimeout(r, 10_000))]);
		if (this.state === "unauthorized") throw new FluxNotReadyError(this.message);
		if (this.state !== "ready" && this.replica.version < 0) throw new FluxNotReadyError(`Flux is ${this.state}: ${this.message}`);
	}

	/** Pulls what changed since the copy's version. */
	async pull(): Promise<void> {
		const client = this.requireClient();
		let changed = false;
		for (;;) {
			let page;
			try {
				page = await client.pull(this.replica.version);
			} catch (e) {
				if (e instanceof FluxHttpError && e.code === "history_compacted") {
					this.reset(this.replica.scope);
					continue;
				}
				throw e;
			}
			for (const it of page.items) changed = this.apply(it) || changed;
			this.replica.version = page.nextVersion;
			if (!page.hasMore) break;
		}
		const shown = changed || this.cleared;
		this.syncedAt = new Date().toISOString();
		storage.set(this.storeKey("syncedAt"), this.syncedAt);
		if (changed) this.replayQueue();
		this.save();
		if (shown) this.onChange();
	}

	/** Drops the copy, to be pulled again from the start. */
	private reset(scope: string) {
		this.replica = { scope, version: -1, items: {} };
		this.dirty.clear();
		this.cleared = true;
	}

	/** Writes what changed in the copy to disk, then the version it's at. */
	private save() {
		const ids = [...this.dirty];
		const clear = this.cleared;
		const meta = { scope: this.replica.scope, version: this.replica.version };
		this.dirty.clear();
		this.cleared = false;
		// The synced items, not the changes waiting over them.
		const synced = (id: string) => (this.shadow.has(id) ? this.shadow.get(id) : this.replica.items[id]);
		const items = ids.map(synced).filter((it): it is Item => !!it);
		const gone = ids.filter((id) => !synced(id));
		void this.disk.write(items, gone, clear).then(
			() => storage.set(this.storeKey("copy"), meta),
			() => {},
		);
	}

	private apply(it: SyncItem): boolean {
		const shadowed = this.shadow.has(it.id);
		const had = shadowed ? this.shadow.get(it.id) : this.replica.items[it.id];
		if (had && had.version >= it.version) return false;
		const next = it.deleted || !isObject(it.body) ? undefined : { id: it.id, version: it.version, createdAt: it.createdAt, updatedAt: it.updatedAt, body: it.body };
		// Under a change waiting to be sent, the synced item changes; the
		// change shows over it again once the pull is in (replayQueue).
		if (shadowed) this.shadow.set(it.id, next);
		else if (next) this.replica.items[it.id] = next;
		else delete this.replica.items[it.id];
		this.dirty.add(it.id);
		return true;
	}

	// ---- Changes made offline ----

	/**
	 * Sends a change that can wait for Flux; while Flux can't be reached
	 * it's queued, shown at once, and sent when Flux is back, in order, as
	 * bb's. label says what it is if it can't be.
	 */
	private async change(label: string, change: PendingChange): Promise<void> {
		if (this.state === "ready" && this.queue.length === 0) {
			try {
				await this.send(change);
				return;
			} catch (e) {
				if (!isUnreachable(e)) throw e;
				this.state = "offline";
				this.message = describe(e);
			}
		} else if (this.state === "unconfigured" || this.state === "unauthorized" || this.replica.version < 0) {
			throw new FluxNotReadyError(this.message || "Flux isn't connected.");
		}
		// Built now too, so a change that can't apply fails now.
		this.overlay(this.build(change));
		const seq = (this.queue[this.queue.length - 1]?.seq ?? 0) + 1;
		this.queue.push({ seq, label, change });
		storage.set(this.storeKey("queue"), this.queue);
		this.onChange();
	}

	/** A change's writes, from the copy as it is now: what others changed meanwhile in other fields stays. */
	private build(change: PendingChange): Write[] {
		switch (change.type) {
			case "issue":
				return this.issueWrites(change.id, change.patch);
			case "description": {
				const it = this.item(change.id, "issue");
				const html = markdownToHtml(change.markdown, { baseUrl: this.baseUrl, members: this.mentionTargets() });
				return [{ itemId: it.id, baseVersion: it.version, body: { ...it.body, description: html } }];
			}
			case "comment": {
				// Sent once, even if it landed before a reconnect.
				if (this.replica.items[change.id] && !this.shadow.has(change.id)) return [];
				this.item(asString(change.body.issueId), "issue");
				return [{ itemId: change.id, baseVersion: -1, body: change.body }];
			}
			case "commentEdit": {
				const it = this.item(change.id, "comment");
				return [{ itemId: it.id, baseVersion: it.version, body: { ...it.body, body: change.html } }];
			}
			case "commentDelete": {
				const it = this.replica.items[change.id];
				return it ? [{ itemId: it.id, baseVersion: it.version, body: null }] : [];
			}
			case "label":
				if (this.replica.items[change.id] && !this.shadow.has(change.id)) return [];
				return [{ itemId: change.id, baseVersion: -1, body: change.body }];
			case "project": {
				if (this.replica.items[change.id] && !this.shadow.has(change.id)) return [];
				// Its key, if another took it meanwhile, the next free, as Flux's.
				const key = uniqueProjectKey(this.keyed(), asString(change.body.key), change.id);
				return [{ itemId: change.id, baseVersion: -1, body: { ...change.body, key } }];
			}
			case "projectEdit":
				return this.projectWrites(change.id, change.patch);
			case "projectOrder": {
				// The order asked, then any project it didn't know of, each at its place.
				const ids = [...change.ids.filter((id) => this.replica.items[id]?.body.type === "project"), ...this.projects().map((p) => p.id).filter((id) => !change.ids.includes(id))];
				return ids.flatMap((id, position) => {
					const it = this.replica.items[id]!;
					return asNumber(it.body.position) === position ? [] : [{ itemId: id, baseVersion: it.version, body: { ...it.body, position } }];
				});
			}
			case "projectDelete": {
				const it = this.replica.items[change.id];
				return it ? [{ itemId: it.id, baseVersion: it.version, body: null }] : [];
			}
		}
	}

	/** Sends a change now. */
	private async send(change: PendingChange): Promise<void> {
		if (change.type === "description") await this.writeDescription(change.id, change.markdown);
		else await this.transact(() => this.build(change));
	}

	/** Shows writes over the synced copy, keeping what they cover. */
	private overlay(writes: Write[]) {
		const now = new Date().toISOString();
		for (const w of writes) {
			const had = this.replica.items[w.itemId];
			if (!this.shadow.has(w.itemId)) this.shadow.set(w.itemId, had);
			if (w.body === null) delete this.replica.items[w.itemId];
			else this.replica.items[w.itemId] = { id: w.itemId, version: had?.version ?? -1, createdAt: had?.createdAt ?? now, updatedAt: now, body: w.body };
		}
	}

	/** Puts the synced items back where changes showed over them. */
	private restoreSynced() {
		for (const [id, it] of this.shadow) {
			if (it) this.replica.items[id] = it;
			else delete this.replica.items[id];
		}
		this.shadow.clear();
	}

	/** Shows the queued changes over the copy as it is now; one that no longer applies is dropped. */
	private replayQueue() {
		this.restoreSynced();
		for (const q of [...this.queue]) {
			try {
				this.overlay(this.build(q.change));
			} catch (e) {
				// Nothing synced yet to judge by: decide once there is.
				if (this.replica.version < 0) continue;
				this.drop(q, e);
			}
		}
	}

	/** Sends the changes made while Flux couldn't be reached, oldest first. */
	async flush(): Promise<void> {
		if (this.sending || this.queue.length === 0) return;
		this.sending = true;
		try {
			while (this.queue.length > 0 && this.state === "ready") {
				const q = this.queue[0]!;
				this.restoreSynced();
				try {
					await this.send(q.change);
					this.queue = this.queue.filter((x) => x !== q);
				} catch (e) {
					// Still away, or the token's gone: kept for the next connection.
					if (isUnreachable(e) || isUnauthorized(e)) {
						this.replayQueue();
						this.onChange();
						return;
					}
					this.drop(q, e);
				}
				storage.set(this.storeKey("queue"), this.queue);
				this.replayQueue();
				this.onChange();
			}
		} finally {
			this.sending = false;
		}
	}

	/** Gives up on a queued change, keeping why to show. */
	private drop(q: Queued, e: unknown) {
		if (!this.queue.includes(q)) return;
		this.queue = this.queue.filter((x) => x !== q);
		storage.set(this.storeKey("queue"), this.queue);
		const reason = e instanceof FluxNotFoundError ? "it was deleted in Flux meanwhile" : describe(e);
		console.warn(`Flux: couldn't send a change made offline (${q.label}): ${reason}`);
		// Following an issue isn't worth telling anyone of.
		if (q.change.type === "issue" && q.change.patch.subscribe && Object.keys(q.change.patch).length === 1) return;
		this.dropped = [...this.dropped, { id: crypto.randomUUID(), label: q.label, reason, at: new Date().toISOString() }].slice(-MAX_DROPPED);
		storage.set(this.storeKey("dropped"), this.dropped);
	}

	/** Clears what couldn't be sent from the list, once seen. */
	dismissDropped() {
		this.dropped = [];
		storage.set(this.storeKey("dropped"), this.dropped);
		this.onChange();
	}

	/** Tries Flux again now, rather than at the next retry. */
	reconnect() {
		const [url = "", token = ""] = this.configured.split("\n");
		this.configured = "";
		this.configure(url, token);
	}

	/** Refuses a change that needs Flux now (it numbers issues, say), while it can't be reached. */
	private online() {
		if (this.state === "offline" || this.state === "connecting") {
			throw new FluxNotReadyError(`Flux can't be reached right now, so this has to wait until it's back${this.message ? ` (${this.message})` : ""}.`);
		}
	}

	requireClient(): FluxClient {
		if (!this.client) throw new FluxNotReadyError(this.message || "Flux isn't set up.");
		return this.client;
	}

	private ofType(type: string): Item[] {
		return Object.values(this.replica.items).filter((i) => i.body.type === type);
	}

	// ---- Reading ----

	projects(): Project[] {
		const links = storage.get<Record<string, string>>("projectLinks") ?? {};
		return this.ofType("project")
			.map((it) => {
				const mark = isObject(it.body.mark) ? it.body.mark : {};
				return {
					id: it.id,
					key: asString(it.body.key) || "PRJ",
					name: asString(it.body.name) || "Untitled",
					emoji: mark.type === "emoji" ? asString(mark.value) || null : null,
					icon: mark.type === "icon" ? asString(mark.value) || null : null,
					color: asColor(mark.color),
					position: asNumber(it.body.position),
					swarmProjectId: links[it.id] ?? null,
				};
			})
			.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
	}

	labels(): Label[] {
		return this.ofType("label")
			.map((it) => ({ id: it.id, name: asString(it.body.name), color: asColor(it.body.color) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	memberList(): Member[] {
		return this.members;
	}

	issues(): Issue[] {
		const keys = new Map(this.projects().map((p) => [p.id, p.key]));
		const items = this.ofType("issue");
		const children = new Map<string, { total: number; done: number }>();
		for (const it of items) {
			const parent = asString(it.body.parentId);
			if (!parent) continue;
			const c = children.get(parent) ?? { total: 0, done: 0 };
			c.total++;
			if (CLOSED_STATUSES.has(asStatus(it.body.status))) c.done++;
			children.set(parent, c);
		}
		const threads = this.threadsByIssue();
		return items.map((it) => {
			const number = asNumber(it.body.number);
			return {
				id: it.id,
				key: `${keys.get(asString(it.body.projectId)) ?? "PRJ"}-${number}`,
				number,
				projectId: asString(it.body.projectId),
				title: asString(it.body.title) || "Untitled",
				status: asStatus(it.body.status),
				priority: asPriority(it.body.priority),
				assigneeIds: asStringList(it.body.assigneeIds),
				labelIds: asStringList(it.body.labelIds),
				subscriberIds: asStringList(it.body.subscriberIds),
				creatorId: asString(it.body.creatorId) || null,
				parentId: asString(it.body.parentId) || null,
				dueDate: asDueDate(it.body.dueDate),
				position: asNumber(it.body.position),
				createdAt: it.createdAt,
				updatedAt: it.updatedAt,
				threadIds: threads.get(it.id) ?? [],
				subIssueCount: children.get(it.id)?.total ?? 0,
				subIssueDoneCount: children.get(it.id)?.done ?? 0,
			};
		});
	}

	issue(id: string): Issue | null {
		return this.issues().find((i) => i.id === id) ?? null;
	}

	/** An issue by its key (old project keys too) or ID. */
	findIssue(ref: string): Issue | null {
		const all = this.issues();
		const byId = all.find((i) => i.id === ref);
		if (byId) return byId;
		const key = parseIssueKey(ref);
		if (!key) return null;
		const project = this.findProject(key.projectKey);
		return project ? (all.find((i) => i.projectId === project.id && i.number === key.number) ?? null) : null;
	}

	requireIssue(ref: string): Issue {
		const i = this.findIssue(ref);
		if (!i) throw new FluxNotFoundError(`No Flux issue ${ref}.`);
		return i;
	}

	findProject(ref: string): Project | null {
		const r = ref.trim().toLowerCase();
		const aliases = (id: string) => asStringList(this.replica.items[id]?.body.aliases).map((a) => a.toLowerCase());
		return this.projects().find((p) => p.id === ref || p.key.toLowerCase() === r || p.name.toLowerCase() === r || aliases(p.id).includes(r)) ?? null;
	}

	findMember(ref: string): Member | null {
		const r = ref.trim().replace(/^@/, "").toLowerCase();
		if (r === "me") return this.members.find((m) => m.id === this.me?.id) ?? null;
		return this.members.find((m) => m.username.toLowerCase() === r || m.email.toLowerCase() === r || m.id === ref) ?? null;
	}

	findLabel(ref: string): Label | null {
		const r = ref.trim().toLowerCase();
		return this.labels().find((l) => l.name.toLowerCase() === r || l.id === ref) ?? null;
	}

	issueUrl(issue: Issue): string {
		return `${this.baseUrl}/issue/${issue.key}`;
	}

	projectUrl(project: Project): string {
		return `${this.baseUrl}/p/${project.key}`;
	}

	private mentionTargets() {
		return [...this.projects().map((p) => ({ id: `project:${p.id}`, username: p.key, name: p.name })), ...this.members];
	}

	comments(issueId: string): Comment[] {
		const opts = { baseUrl: this.baseUrl, members: this.mentionTargets() };
		return this.ofType("comment")
			.filter((c) => c.body.issueId === issueId)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
			.map((c) => ({
				id: c.id,
				authorId: asString(c.body.authorId) || null,
				html: asString(c.body.body),
				markdown: htmlToMarkdown(asString(c.body.body), opts),
				agent: parseCommentAgent(c.body.agent),
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
			}));
	}

	detail(id: string): IssueDetail {
		const issue = this.issue(id);
		if (!issue) throw new FluxNotFoundError(`No Flux issue with id ${id}.`);
		const html = asString(this.replica.items[id]!.body.description);
		const all = this.issues();
		return {
			issue,
			url: this.issueUrl(issue),
			descriptionHtml: html,
			descriptionMarkdown: htmlToMarkdown(html, { baseUrl: this.baseUrl, members: this.mentionTargets() }),
			comments: this.comments(id),
			parent: issue.parentId ? (all.find((i) => i.id === issue.parentId) ?? null) : null,
			subIssues: all.filter((i) => i.parentId === id).sort((a, b) => a.number - b.number),
		};
	}

	// ---- Writing ----

	/**
	 * Pushes one atomic batch built from the copy (a null body deletes the
	 * item), and keeps what Flux took; on a version conflict it pulls and
	 * builds the batch again from the winning copies.
	 */
	private async transact(build: () => { itemId: string; baseVersion: number; body: Record<string, unknown> | null }[]): Promise<void> {
		const client = this.requireClient();
		for (let attempt = 1; ; attempt++) {
			const writes = build();
			if (writes.length === 0) return;
			const before = new Map(writes.map((w) => [w.itemId, this.replica.items[w.itemId]]));
			const now = new Date().toISOString();
			for (const w of writes) {
				if (w.body === null) delete this.replica.items[w.itemId];
				else {
					const had = before.get(w.itemId);
					this.replica.items[w.itemId] = { id: w.itemId, version: (had?.version ?? -1) + 1, createdAt: had?.createdAt ?? now, updatedAt: now, body: w.body };
				}
			}
			// Shown at once, as the sidebar's order is: Flux answers in its own time.
			this.onChange();
			const ops: SyncOp[] = writes.map((w) =>
				w.body === null
					? { type: "delete", id: crypto.randomUUID(), itemId: w.itemId, baseVersion: w.baseVersion }
					: { type: "upsert", id: crypto.randomUUID(), itemId: w.itemId, baseVersion: w.baseVersion, body: w.body },
			);
			try {
				const res = await client.push(ops);
				for (const a of res.applied) {
					const w = writes.find((x) => x.itemId === a.itemId)!;
					const had = before.get(a.itemId);
					if (w.body === null) delete this.replica.items[a.itemId];
					else this.replica.items[a.itemId] = { id: a.itemId, version: a.version, createdAt: had?.createdAt ?? now, updatedAt: now, body: w.body };
					this.dirty.add(a.itemId);
				}
				this.save();
				this.onChange();
				return;
			} catch (e) {
				for (const [id, item] of before) {
					if (item) this.replica.items[id] = item;
					else delete this.replica.items[id];
				}
				this.onChange();
				if (attempt < 4 && e instanceof FluxHttpError && e.code === "sync_conflict") {
					await this.pull();
					continue;
				}
				throw e;
			}
		}
	}

	private item(id: string, type: string): Item {
		const it = this.replica.items[id];
		if (!it || it.body.type !== type) throw new FluxNotFoundError(`The ${type} was deleted in Flux.`);
		return it;
	}

	async createIssue(input: {
		projectId: string;
		title: string;
		descriptionMarkdown?: string;
		status?: Status;
		priority?: Priority;
		assigneeIds?: string[];
		labelIds?: string[];
		parentId?: string | null;
		dueDate?: string | null;
		/** HTML, as Flux keeps it, where the description is a copy's: it's kept as it is. */
		descriptionHtml?: string;
	}): Promise<Issue> {
		const me = this.me;
		if (!me) throw new FluxNotReadyError("Flux is not connected.");
		this.online();
		const description = input.descriptionHtml !== undefined ? input.descriptionHtml : input.descriptionMarkdown?.trim() ? markdownToHtml(await liftDataImages(input.descriptionMarkdown, (bytes, type, name) => this.uploadImage(bytes, type, name, "issue_image")), { baseUrl: this.baseUrl, members: this.mentionTargets() }) : "";
		const assignees = unique(input.assigneeIds ?? []);
		const issueId = crypto.randomUUID();
		await this.transact(() => {
			const project = this.item(input.projectId, "project");
			const number = this.freeNumber(project);
			return [
				{ itemId: project.id, baseVersion: project.version, body: { ...project.body, nextNumber: number + 1 } },
				{
					itemId: issueId,
					baseVersion: -1,
					body: {
						type: "issue",
						projectId: input.projectId,
						number,
						title: input.title.trim(),
						description,
						status: input.status ?? "todo",
						priority: input.priority ?? "none",
						assigneeIds: assignees,
						labelIds: unique(input.labelIds ?? []),
						subscriberIds: unique([me.id, ...assignees]),
						creatorId: me.id,
						dueDate: input.dueDate ?? null,
						parentId: input.parentId ?? null,
						position: 0,
					},
				},
			];
		});
		return this.issue(issueId)!;
	}

	async updateIssue(id: string, patch: IssuePatch): Promise<Issue> {
		const issue = this.issue(id);
		if (patch.projectId !== undefined && patch.projectId !== issue?.projectId) {
			// A move numbers the issue in its new project: Flux has to be here.
			this.online();
			await this.transact(() => this.issueWrites(id, patch));
		} else {
			await this.change(issue ? `Change to ${issue.key}` : "A change to an issue", { type: "issue", id, patch });
		}
		return this.issue(id)!;
	}

	/** An issue's writes for patch, from the copy as it is now. */
	private issueWrites(id: string, patch: IssuePatch): Write[] {
		{
			const it = this.item(id, "issue");
			const next = { ...it.body };
			if (patch.title !== undefined) next.title = patch.title;
			if (patch.priority !== undefined) next.priority = patch.priority;
			if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
			if (patch.parentId !== undefined) next.parentId = patch.parentId;
			if (patch.labelIds !== undefined) next.labelIds = unique(patch.labelIds);
			if (patch.status !== undefined && patch.status !== asStatus(it.body.status)) {
				next.status = patch.status;
				// Flux puts an issue at the top of the column it moves into,
				// unless the drop named where it sits.
				if (patch.position === undefined) next.position = 0;
			}
			if (patch.position !== undefined) next.position = patch.position;
			const writes: { itemId: string; baseVersion: number; body: Record<string, unknown> | null }[] = [];
			if (patch.projectId !== undefined && patch.projectId !== asString(it.body.projectId)) {
				// As Flux's move: the first free number there, which the
				// project's next number then passes.
				const project = this.item(patch.projectId, "project");
				const number = this.freeNumber(project);
				next.projectId = project.id;
				next.number = number;
				writes.push({ itemId: project.id, baseVersion: project.version, body: { ...project.body, nextNumber: Math.max(asNumber(project.body.nextNumber, 1), number + 1) } });
			}
			if (patch.subscribe) next.subscriberIds = unique([...asStringList(next.subscriberIds), patch.subscribe]);
			if (patch.assigneeIds !== undefined) {
				next.assigneeIds = unique(patch.assigneeIds);
				// Flux keeps the creator and every assignee subscribed.
				next.subscriberIds = unique([...asStringList(it.body.subscriberIds), asString(it.body.creatorId), ...patch.assigneeIds].filter(Boolean));
			}
			return [{ itemId: id, baseVersion: it.version, body: next }, ...writes];
		}
	}

	/**
	 * Replaces an issue's description with Markdown: into its live
	 * document, as an editor's edit, then its HTML, as Flux's editor
	 * saves it.
	 */
	async replaceDescription(id: string, markdown: string): Promise<void> {
		this.item(id, "issue");
		// Pictures pasted in go up now, or the change waits with them in it.
		if (this.state === "ready") markdown = await liftDataImages(markdown, (bytes, type, name) => this.uploadImage(bytes, type, name, "issue_image"));
		const issue = this.issue(id);
		await this.change(issue ? `Description of ${issue.key}` : "A description", { type: "description", id, markdown });
	}

	/** Writes a description into the issue's live document, then its HTML. */
	private async writeDescription(id: string, markdown: string): Promise<void> {
		const client = this.requireClient();
		this.item(id, "issue");
		markdown = await liftDataImages(markdown, (bytes, type, name) => this.uploadImage(bytes, type, name, "issue_image"));
		const parsed = parseDescription(markdownToHtml(markdown, { baseUrl: this.baseUrl, members: this.mentionTargets() }));
		const path = `/sync/docs/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(client.workspaceId ?? "")}`;
		let seeded: { created: boolean; update: string } | null = null;
		for (let attempt = 1; attempt <= 10; attempt++) {
			try {
				seeded = await client.request(
					z.object({ created: z.boolean(), update: z.string() }),
					path,
					{ method: "PUT", body: { update: base64(descriptionState(parsed.doc)) } },
				);
				break;
			} catch (e) {
				// Flux makes the document a moment after the issue.
				if (e instanceof FluxHttpError && e.status === 404 && attempt < 10) {
					await new Promise((r) => setTimeout(r, 200 * attempt));
					continue;
				}
				throw e;
			}
		}
		if (seeded && !seeded.created) {
			const url = new URL(client.baseUrl + path);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			const { accept: _, ...headers } = client.headers();
			await writeLiveDescription({ url: url.href, headers }, fromBase64(seeded.update), parsed.doc);
		}
		await this.transact(() => {
			const it = this.item(id, "issue");
			return [{ itemId: id, baseVersion: it.version, body: { ...it.body, description: parsed.html } }];
		});
	}

	/**
	 * Comments as the signed-in account; with an agent, Flux shows it as
	 * that agent's comment for the account. Commenters follow the issue.
	 */
	async addComment(issueId: string, markdown: string, agent?: CommentAgent | null): Promise<Comment> {
		const me = this.me;
		if (!me) throw new FluxNotReadyError("Flux is not connected.");
		const commentId = crypto.randomUUID();
		const lifted = this.state === "ready" ? await liftDataImages(markdown, (bytes, type, name) => this.uploadImage(bytes, type, name, "comment_image")) : markdown;
		const html = markdownToHtml(lifted, { baseUrl: this.baseUrl, members: this.mentionTargets() });
		const issue = this.item(issueId, "issue");
		await this.change(`Comment on ${this.issue(issueId)?.key ?? "an issue"}`, { type: "comment", id: commentId, body: { type: "comment", issueId, authorId: me.id, body: html, ...(agent ? { agent } : {}) } });
		// Commenters follow the issue, as Flux has it.
		if (!asStringList(issue.body.subscriberIds).includes(me.id)) {
			await this.change(`Following ${this.issue(issueId)?.key ?? "an issue"}`, { type: "issue", id: issueId, patch: { subscribe: me.id } }).catch(() => {});
		}
		return this.comments(issueId).find((c) => c.id === commentId)!;
	}

	/** Deletes an issue as Flux does: its comments with it; its sub-issues stay, without their parent; its threads' links go. */
	async deleteIssue(id: string): Promise<void> {
		this.online();
		const threads = this.issue(id)?.threadIds ?? [];
		await this.transact(() => {
			const it = this.item(id, "issue");
			return [
				...this.ofType("comment").filter((c) => c.body.issueId === id).map((c) => ({ itemId: c.id, baseVersion: c.version, body: null })),
				...this.ofType("issue").filter((i) => i.body.parentId === id).map((i) => ({ itemId: i.id, baseVersion: i.version, body: { ...i.body, parentId: null } })),
				{ itemId: id, baseVersion: it.version, body: null },
			];
		});
		for (const thread of threads) this.detach(id, thread);
	}

	/** The first number free in a project, from its next number on. */
	private freeNumber(project: Item): number {
		const taken = new Set<number>();
		for (const i of this.ofType("issue")) if (i.body.projectId === project.id) taken.add(asNumber(i.body.number));
		let number = Math.max(1, asNumber(project.body.nextNumber, 1));
		while (taken.has(number)) number++;
		return number;
	}

	async duplicateIssue(id: string): Promise<Issue> {
		const issue = this.issue(id);
		if (!issue) throw new FluxNotFoundError(`No Flux issue with id ${id}.`);
		// As Flux's Duplicate: every field, the description as it is.
		return this.createIssue({
			projectId: issue.projectId,
			title: issue.title.trim() ? `${issue.title} copy` : "",
			descriptionHtml: asString(this.replica.items[id]?.body.description),
			status: issue.status,
			priority: issue.priority,
			assigneeIds: issue.assigneeIds,
			labelIds: issue.labelIds,
			parentId: issue.parentId,
			dueDate: issue.dueDate,
		});
	}

	async updateComment(id: string, markdown: string): Promise<void> {
		const me = this.me;
		if (!me) throw new FluxNotReadyError("Flux is not connected.");
		const it = this.item(id, "comment");
		if (asString(it.body.authorId) !== me.id) throw new Error("You can edit your own comments.");
		const lifted = this.state === "ready" ? await liftDataImages(markdown, (bytes, type, name) => this.uploadImage(bytes, type, name, "comment_image")) : markdown;
		const html = markdownToHtml(lifted, { baseUrl: this.baseUrl, members: this.mentionTargets() });
		await this.change(`Edit to a comment on ${this.issue(asString(it.body.issueId))?.key ?? "an issue"}`, { type: "commentEdit", id, html });
	}

	async deleteComment(id: string): Promise<void> {
		const me = this.me;
		if (!me) throw new FluxNotReadyError("Flux is not connected.");
		const it = this.item(id, "comment");
		if (asString(it.body.authorId) !== me.id) throw new Error("You can delete your own comments.");
		await this.change(`Deleting a comment on ${this.issue(asString(it.body.issueId))?.key ?? "an issue"}`, { type: "commentDelete", id });
	}

	/** A label of name, in the color fewest labels use when none is given. */
	async createLabel(name: string, color?: ColorName): Promise<Label> {
		const existing = this.findLabel(name);
		if (existing) return existing;
		if (name.includes(",")) throw new Error("A label's name can't have a comma in it.");
		const used = new Map<ColorName, number>(COLORS.map((c) => [c, 0]));
		for (const l of this.labels()) used.set(l.color, (used.get(l.color) ?? 0) + 1);
		const pick = color ?? [...used.entries()].sort((a, b) => a[1] - b[1])[0]![0];
		const id = crypto.randomUUID();
		await this.change(`Label “${name.trim()}”`, { type: "label", id, body: { type: "label", name: name.trim(), color: pick } });
		return this.labels().find((l) => l.id === id)!;
	}

	// ---- Projects ----

	/** Each project's key and the keys it had, for a key's rules. */
	keyed(): Keyed[] {
		return this.projects().map((p) => ({ id: p.id, name: p.name, key: p.key, aliases: asStringList(this.replica.items[p.id]?.body.aliases) }));
	}

	/** Why key can't be the project ignore's, or a new one's: as Flux's dialog says, or whose it is; null for one it takes. */
	keyProblem(key: string, ignore?: string): string | null {
		const problem = formatProblem(key);
		if (problem) return problem;
		const owner = key ? keyOwner(this.keyed(), key, ignore) : null;
		if (!owner) return null;
		return owner.old ? `${key} was ${owner.project.name}'s key, and still finds its issues` : `${owner.project.name} has the key ${key}`;
	}

	/**
	 * A project as Flux's New project makes it: the key given, or its
	 * name's, the next free; Flux's folder, gray, for a mark; numbered from
	 * 1, and after the others. It shows at once, and waits for Flux.
	 */
	async createProject(input: { name: string; key?: string; keyFrom?: string; mark?: ProjectMarkValue }): Promise<Project> {
		const name = input.name.trim().slice(0, PROJECT_NAME_MAX);
		if (!name) throw new Error("Give the project a name.");
		const typed = normalizeProjectKey(input.key ?? "");
		const problem = typed ? this.keyProblem(typed) : null;
		if (problem) throw new Error(`${problem}.`);
		const key = uniqueProjectKey(this.keyed(), typed || input.keyFrom || name);
		const id = crypto.randomUUID();
		const body = { type: "project", key, aliases: [], name, mark: input.mark ?? { type: "icon", value: "folder", color: "gray" }, nextNumber: 1, position: this.projects().length };
		await this.change(`Project “${name}”`, { type: "project", id, body });
		return this.projects().find((p) => p.id === id)!;
	}

	/** Changes a project's name, key or mark; a key it leaves stays among its aliases, as Flux keeps it. */
	async updateProject(id: string, patch: ProjectPatch): Promise<Project> {
		const project = this.projects().find((p) => p.id === id);
		if (!project) throw new FluxNotFoundError("The project was deleted in Flux.");
		const next: ProjectPatch = {};
		if (patch.name !== undefined) {
			const name = patch.name.trim().slice(0, PROJECT_NAME_MAX);
			if (!name) throw new Error("A project needs a name.");
			if (name !== project.name) next.name = name;
		}
		if (patch.key !== undefined) {
			const key = normalizeProjectKey(patch.key);
			const problem = this.keyProblem(key, id) ?? (key ? null : "Project keys must be 2–5 letters");
			if (problem) throw new Error(`${problem}.`);
			if (key !== project.key) next.key = key;
		}
		if (patch.mark) next.mark = patch.mark;
		if (Object.keys(next).length === 0) return project;
		await this.change(`Change to ${next.name ?? project.name}`, { type: "projectEdit", id, patch: next });
		return this.projects().find((p) => p.id === id) ?? project;
	}

	/** A project's writes for patch, from the copy as it is now: never its counter, which only numbering an issue raises. */
	private projectWrites(id: string, patch: ProjectPatch): Write[] {
		const it = this.item(id, "project");
		const body: Record<string, unknown> = { ...it.body };
		if (patch.name !== undefined) body.name = patch.name;
		if (patch.mark) body.mark = patch.mark;
		if (patch.key !== undefined) {
			const was = asString(it.body.key);
			const key = uniqueProjectKey(this.keyed(), patch.key, id);
			body.key = key;
			body.aliases = aliasesAfter(asStringList(it.body.aliases), was, key);
		}
		return [{ itemId: id, baseVersion: it.version, body }];
	}

	/** Moves a project to place to among them, as Flux's sidebar's drag: each one's position its place. */
	async moveProject(id: string, to: number): Promise<void> {
		const ids = this.projects().map((p) => p.id);
		const from = ids.indexOf(id);
		if (from < 0) throw new FluxNotFoundError("The project was deleted in Flux.");
		const at = Math.max(0, Math.min(to, ids.length - 1));
		if (at === from) return;
		ids.splice(from, 1);
		ids.splice(at, 0, id);
		await this.change("The projects' order", { type: "projectOrder", ids });
	}

	/**
	 * Deletes a project as Flux does: the project alone. Its issues stay in
	 * Flux, without a project, so their keys go with it; Swarm forgets
	 * where its agents worked.
	 */
	async deleteProject(id: string): Promise<void> {
		const project = this.projects().find((p) => p.id === id);
		if (!project) return;
		await this.change(`Deleting ${project.name}`, { type: "projectDelete", id });
		this.link(id, null);
	}

	// ---- Threads ----

	/** The issues attached to each thread, by issue. */
	private threadsByIssue(): Map<string, string[]> {
		const links = storage.get<Record<string, string[]>>("links") ?? {};
		const out = new Map<string, string[]>();
		for (const [thread, issues] of Object.entries(links)) {
			for (const i of issues) out.set(i, [...(out.get(i) ?? []), thread]);
		}
		return out;
	}

	issuesOfThread(thread: string): Issue[] {
		const ids = (storage.get<Record<string, string[]>>("links") ?? {})[thread] ?? [];
		return ids.map((id) => this.issue(id)).filter((i): i is Issue => i !== null);
	}

	/** Attaches a thread to an issue; start moves a backlog or todo one to In Progress. */
	async attach(issueId: string, thread: string, start: boolean): Promise<Issue> {
		const links = storage.get<Record<string, string[]>>("links") ?? {};
		links[thread] = unique([...(links[thread] ?? []), issueId]);
		storage.set("links", links);
		let issue = this.issue(issueId)!;
		if (start && (issue.status === "backlog" || issue.status === "todo")) issue = await this.updateIssue(issueId, { status: "progress" });
		void swarm.threads.setMetadata(thread, { set: { issueId, issueKey: issue.key, connectionId: this.id } }).catch(() => {});
		this.onChange();
		return issue;
	}

	detach(issueId: string, thread: string) {
		const links = storage.get<Record<string, string[]>>("links") ?? {};
		links[thread] = (links[thread] ?? []).filter((i) => i !== issueId);
		if (links[thread]!.length === 0) delete links[thread];
		storage.set("links", links);
		void swarm.threads.metadata(thread).then((meta) => {
			if (meta.issueId === issueId) return swarm.threads.setMetadata(thread, { remove: ["issueId", "issueKey", "connectionId"] });
		}).catch(() => {});
		this.onChange();
	}

	/** Links a Flux project to a Swarm project, whose threads it's the default of; null unlinks it. */
	link(projectId: string, swarmProject: string | null) {
		const links = storage.get<Record<string, string>>("projectLinks") ?? {};
		if (swarmProject) links[projectId] = swarmProject;
		else delete links[projectId];
		storage.set("projectLinks", links);
		this.onChange();
	}

	projectOfSwarm(swarmProject: string): Project | null {
		return this.projects().find((p) => p.swarmProjectId === swarmProject) ?? null;
	}

	connection() {
		return {
			id: this.id,
			state: this.state,
			message: this.message,
			baseUrl: this.client?.baseUrl ?? null,
			workspace: this.workspace,
			me: this.me,
			issueCount: this.ofType("issue").length,
			queued: this.queue.length,
			dropped: this.dropped,
			syncedAt: this.syncedAt,
		};
	}

	/** Uploads a picture and returns the URL Markdown should use. */
	async uploadImage(bytes: Uint8Array, type: string, name: string, entity: "issue_image" | "comment_image"): Promise<string> {
		const up = await this.requireClient().upload({ name, type, bytes }, entity);
		return up.url.startsWith("/") ? this.baseUrl + up.url : up.url;
	}
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		let timer = 0;
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		timer = setTimeout(finish, ms);
		signal.addEventListener("abort", finish, { once: true });
	});
}

function parseSSE(frame: string): { event: string; data: string } | null {
	let event = "message";
	const data: string[] = [];
	for (const line of frame.split("\n")) {
		if (!line || line.startsWith(":")) continue;
		if (line.startsWith("event:")) event = line.slice(6).trim();
		else if (line.startsWith("data:")) data.push(line.slice(5).trim());
	}
	return data.length ? { event, data: data.join("\n") } : null;
}

const DATA_IMAGE = /!\[([^\]]*)\]\((data:image\/([a-zA-Z0-9.+-]+);base64,([^)]+))\)/g;

/** Uploads Markdown's data-URL pictures and puts Flux's URLs in their place. */
/** Signs in to a Flux with url and token, saving nothing: who it is, and its workspace. */
export async function checkFlux(url: string, token: string): Promise<{ baseUrl: string; account: string; workspace: { id: string; name: string } }> {
	const client = new FluxClient({ baseUrl: url, token, deviceId: storage.get<string>("deviceId") ?? crypto.randomUUID() });
	const me = await client.me();
	const ws = await client.workspace();
	if (!ws.id) throw new Error("Finish setting up your Flux workspace in Flux first.");
	return { baseUrl: client.baseUrl, account: me.name, workspace: { id: ws.id, name: ws.name } };
}

export async function liftDataImages(markdown: string, upload: (bytes: Uint8Array, type: string, name: string) => Promise<string>): Promise<string> {
	if (!markdown.includes("data:image/")) return markdown;
	let out = "";
	let last = 0;
	for (const match of markdown.matchAll(DATA_IMAGE)) {
		out += markdown.slice(last, match.index);
		const subtype = match[3]!.toLowerCase() === "jpg" ? "jpeg" : match[3]!.toLowerCase();
		const url = await upload(Uint8Array.fromBase64(match[4]!), `image/${subtype}`, `${match[1] || "image"}.${subtype === "jpeg" ? "jpg" : subtype}`);
		out += `![${match[1]}](${url})`;
		last = match.index! + match[0].length;
	}
	return out + markdown.slice(last);
}

function member(a: Account): Member {
	return { id: a.id, name: a.name, username: a.username, email: a.email, avatarUrl: a.avatarUrl ?? null, avatarColor: asColor(a.avatarColor) };
}

// The engine's own base64, ES2026's.
function base64(bytes: Uint8Array): string {
	return bytes.toBase64();
}
function fromBase64(s: string): Uint8Array {
	return Uint8Array.fromBase64(s);
}
