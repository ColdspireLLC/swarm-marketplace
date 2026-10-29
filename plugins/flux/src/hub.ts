// Every Flux this Swarm is connected to. The first one is the url and token
// settings. The others are a JSON list in the connections secret. One is
// active: the page and `swarm flux` use it unless a command says --flux.
import { settings, storage } from "swarm";
import { Flux, FluxNotFoundError } from "./service";

interface Extra {
	id: string;
	url: string;
	token: string;
}

export function parseExtras(value: string): Extra[] {
	if (!value.trim()) return [];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is Extra => {
			if (!item || typeof item !== "object") return false;
			const row = item as Extra;
			return typeof row.id === "string" && row.id !== "" && row.id !== "default" && typeof row.url === "string" && typeof row.token === "string";
		});
	} catch {
		return [];
	}
}

/** The Fluxes Swarm is signed in to. */
export class Hub {
	readonly main = new Flux("default");
	private extras = new Map<string, Flux>();
	private activeId = storage.get<string>("activeConnection") || "default";
	onChange: () => void = () => {};

	constructor() {
		this.main.onChange = () => this.onChange();
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

	use(id: string) {
		this.activeId = id;
		storage.set("activeConnection", id);
		this.onChange();
	}

	/** The Fluxes set up, the first one's first. */
	connected(): Flux[] {
		return this.all().filter((flux) => flux.state !== "unconfigured" || flux.url !== "");
	}

	/**
	 * Sets a Flux's URL and token: target's, or a new one's when null,
	 * which is the first one's while that isn't set. It's then the active
	 * one. Returns its id.
	 */
	save(target: string | null, url: string, token: string): string {
		if (target === "default" || (target === null && this.main.url === "")) {
			settings.set({ url, token });
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
		} else {
			id = crypto.randomUUID();
			list.push({ id, url, token });
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
			settings.set({ url: next?.url ?? null, token: next?.token ?? null, connections: list.length ? JSON.stringify(list) : null });
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
		this.configure(String(settings.get("url") ?? ""), String(settings.get("token") ?? ""), String(settings.get("connections") ?? ""));
	}

	/** Starts, restarts, or stops connections to match the settings. */
	configure(url: string, token: string, extraJSON: string) {
		this.main.configure(url, token);
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
				flux.onChange = () => this.onChange();
				this.extras.set(item.id, flux);
			}
			flux.configure(item.url, item.token);
		}
		if (this.activeId !== "default" && !this.extras.has(this.activeId)) this.use("default");
	}

	stop() {
		this.main.stop();
		for (const flux of this.extras.values()) flux.stop();
	}
}

export const hub = new Hub();
