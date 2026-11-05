// Every Flux this Swarm is connected to. The first one is the url, token
// and workspace settings. The others are a JSON list in the connections
// secret. Each is on one workspace, by its id, kept as it first connects:
// a token for all its account's workspaces makes one of each workspace
// picked, and stays on it as the account joins others. One is active: the
// page and `swarm flux` use it unless a command says --flux. A thread's
// issue shows from its own Flux, active or not, and its commands use it.
import { settings, storage, ui } from "swarm";
import type { Issue } from "./contract";
import { Flux, FluxNotFoundError } from "./service";

interface Extra {
	id: string;
	url: string;
	token: string;
	/** The workspace it's on; none for the one its token picks. */
	workspace?: string;
}

export function parseExtras(value: string): Extra[] {
	if (!value.trim()) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is Extra => {
			if (!item || typeof item !== "object") return false;
			const row = item as Extra;
			return typeof row.id === "string" && row.id !== "" && row.id !== "default" && typeof row.url === "string" && typeof row.token === "string" && (row.workspace === undefined || typeof row.workspace === "string");
		});
	} catch {
		return [];
	}
}

/** The Fluxes Swarm is signed in to. */
export class Hub {
	readonly main = new Flux("default");
	/** The other Fluxes, and the one in use: tracked, as each Flux's copy is. */
	private readonly extras = ui.store(new Map<string, Flux>(), { shallow: true });
	private readonly activeState = ui.state(storage.get<string>("activeConnection") || "default");
	private get activeId() { return this.activeState.value; }
	private set activeId(id: string) { this.activeState.value = id; }
	/** Told after a Flux changed, for what isn't a render: the badges, the sidebar. */
	onChange: () => void = () => {};

	constructor() {
		this.main.onChange = () => this.changed();
		this.main.onPin = (workspace) => this.pin("default", workspace);
	}

	/** Keeps the workspace a connection set to none is on. */
	private pin(id: string, workspace: string) {
		if (id === "default") {
			if (!String(settings.get("workspace") ?? "")) settings.set({ workspace });
			return;
		}
		const list = parseExtras(String(settings.get("connections") ?? ""));
		const row = list.find((item) => item.id === id);
		if (!row || row.workspace) return;
		row.workspace = workspace;
		settings.set({ connections: JSON.stringify(list) });
	}

	private changed() {
		this.onChange();
	}

	/** The connection commands and the page use. */
	get active(): Flux {
		if (this.activeId !== "default") {
			const extra = this.extras.get(this.activeId);
			if (extra && extra.state !== "unconfigured") return extra;
		}
		return this.main;
	}

	all(): Flux[] {
		return [this.main, ...this.extras.values()];
	}

	/** A connection by id, workspace name, slug, or a bit of its URL. The active one when unnamed. */
	get(name?: string): Flux {
		if (!name?.trim()) return this.active;
		const needle = name.trim().toLowerCase();
		const found = this.all().find((flux) => {
			const workspace = flux.workspace;
			return flux.id.toLowerCase() === needle || workspace?.name.toLowerCase() === needle || workspace?.slug.toLowerCase() === needle || flux.baseUrl.toLowerCase().includes(needle);
		});
		if (!found) throw new FluxNotFoundError(`No Flux connection ${name}.`);
		return found;
	}

	/**
	 * The issues a thread is attached to, in whichever Flux each is: a
	 * thread keeps its issue as another workspace is made active.
	 */
	issuesOfThread(thread: string): { flux: Flux; issue: Issue }[] {
		return this.all().flatMap((flux) => flux.issuesOfThread(thread).map((issue) => ({ flux, issue })));
	}

	/** The Flux a thread's issues are in, when it's attached to some: the active one first. */
	ofThread(thread: string): Flux | undefined {
		const attached = this.issuesOfThread(thread);
		return attached.find((a) => a.flux === this.active)?.flux ?? attached[0]?.flux;
	}

	/** An issue by key or id, and its Flux: the active one's first, then the others'. */
	findIssue(ref: string): { flux: Flux; issue: Issue } | null {
		const active = this.active;
		for (const flux of [active, ...this.all().filter((f) => f !== active)]) {
			const issue = flux.findIssue(ref);
			if (issue) return { flux, issue };
		}
		return null;
	}

	/** The Flux with a project by key, name or old key: the active one's first. */
	ofProject(ref: string): Flux | undefined {
		const active = this.active;
		return [active, ...this.all().filter((f) => f !== active)].find((flux) => flux.findProject(ref));
	}

	/** The Flux with a project linked to a Swarm project: the active one's first. */
	ofSwarmProject(swarmProject: string): Flux | undefined {
		const active = this.active;
		return [active, ...this.all().filter((f) => f !== active)].find((flux) => flux.projectOfSwarm(swarmProject));
	}

	use(id: string) {
		this.activeId = id;
		storage.set("activeConnection", id);
		this.changed();
	}

	/** The Fluxes set up, the first one's first. */
	connected(): Flux[] {
		return this.all().filter((flux) => flux.state !== "unconfigured" || flux.url !== "");
	}

	/**
	 * Sets a Flux's URL and token: target's, or a new one's when null,
	 * which is the first one's while that isn't set. workspace is the
	 * workspace it's on, "" for the one its token picks; target's stays as
	 * it was when it's undefined. It's then the active one. Returns its id.
	 */
	save(target: string | null, url: string, token: string, workspace?: string): string {
		if (target === "default" || (target === null && this.main.url === "")) {
			settings.set({ url, token, ...(workspace !== undefined || target === null ? { workspace: workspace || null } : {}) });
			this.fromSettings();
			this.use("default");
			return "default";
		}
		const list = parseExtras(String(settings.get("connections") ?? ""));
		let id = target;
		if (id) {
			const row = list.find((item) => item.id === id);
			if (!row) throw new FluxNotFoundError(`No Flux connection ${id}.`);
			row.url = url;
			row.token = token;
			if (workspace !== undefined) row.workspace = workspace || undefined;
		} else {
			id = crypto.randomUUID();
			list.push({ id, url, token, ...(workspace ? { workspace } : {}) });
		}
		settings.set({ connections: JSON.stringify(list) });
		this.fromSettings();
		this.use(id);
		return id;
	}

	/** Forgets a Flux: its token and its copy. The next one takes the first one's place. */
	disconnect(id: string) {
		const list = parseExtras(String(settings.get("connections") ?? ""));
		if (id === "default") {
			this.main.forget();
			const next = list.shift();
			if (next) this.extras.get(next.id)?.forget();
			settings.set({ url: next?.url ?? null, token: next?.token ?? null, workspace: next?.workspace || null, connections: list.length ? JSON.stringify(list) : null });
			if (next && this.activeId === next.id) this.activeId = "default";
		} else {
			this.extras.get(id)?.forget();
			const rest = list.filter((item) => item.id !== id);
			settings.set({ connections: rest.length ? JSON.stringify(rest) : null });
		}
		this.fromSettings();
		if (this.activeId === id || !this.extras.has(this.activeId)) this.use("default");
	}

	/** Connects as the settings say. */
	fromSettings() {
		this.configure(String(settings.get("url") ?? ""), String(settings.get("token") ?? ""), String(settings.get("connections") ?? ""), String(settings.get("workspace") ?? ""));
	}

	/** Starts, restarts, or stops connections to match the settings. */
	configure(url: string, token: string, extraJSON: string, workspace = "") {
		this.main.configure(url, token, workspace);
		const want = parseExtras(extraJSON);
		const ids = new Set(want.map((item) => item.id));
		for (const [id, flux] of this.extras) {
			if (!ids.has(id)) {
				flux.stop();
				this.extras.delete(id);
			}
		}
		for (const item of want) {
			let flux = this.extras.get(item.id);
			if (!flux) {
				flux = new Flux(item.id, `conn:${item.id}`);
				flux.onChange = () => this.changed();
				flux.onPin = (workspace) => this.pin(item.id, workspace);
				this.extras.set(item.id, flux);
			}
			flux.configure(item.url, item.token, item.workspace ?? "");
		}
		if (this.activeId !== "default" && !this.extras.has(this.activeId)) this.use("default");
	}

	stop() {
		this.main.stop();
		for (const flux of this.extras.values()) flux.stop();
	}
}

export const hub = new Hub();
