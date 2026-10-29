// The copy of a Flux workspace on disk: its items in the plugin's SQLite
// database, a row each, written as they change, as bb's replica.ts kept
// them. No write carries the whole workspace: one that did ran the
// plugin out of memory on a workspace of a few hundred issues.
import { storage, type Database } from "swarm";

export interface StoredItem {
	id: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	body: Record<string, unknown>;
}

/** Rows a statement writes (six parameters each, of the 32 a statement takes), and the bytes of their bodies, at most. */
const ROWS = 5;
const BYTES = 256 << 10;

let db: Database | null = null;
let made: Promise<void> | null = null;

async function open(): Promise<Database> {
	db ??= storage.database();
	made ??= db.migrate([
		"CREATE TABLE items (store TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (store, id))",
	]);
	await made;
	return db;
}

/** One Flux's items, apart from another's by store. */
export class ItemStore {
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly store: string) {}

	/** Every item kept. */
	async load(): Promise<Record<string, StoredItem>> {
		const d = await open();
		const out: Record<string, StoredItem> = {};
		let after = "";
		for (;;) {
			const rows = await d.all("SELECT id, version, created, updated, body FROM items WHERE store = ? AND id > ? ORDER BY id LIMIT 500", [this.store, after]);
			for (const row of rows) {
				try {
					const body = JSON.parse(String(row.body)) as unknown;
					if (body && typeof body === "object" && !Array.isArray(body)) {
						out[String(row.id)] = { id: String(row.id), version: Number(row.version), createdAt: String(row.created), updatedAt: String(row.updated), body: body as Record<string, unknown> };
					}
				} catch {
					// A row that doesn't read is pulled again.
				}
			}
			if (rows.length < 500) return out;
			after = String(rows[rows.length - 1]!.id);
		}
	}

	/**
	 * Writes what changed, after what's already writing: items, ids gone,
	 * and, with clear, everything kept dropped first. Resolves once it's
	 * written.
	 */
	write(items: StoredItem[], gone: string[], clear = false): Promise<void> {
		const run = async () => {
			const d = await open();
			if (clear) await d.exec("DELETE FROM items WHERE store = ?", [this.store]);
			for (let i = 0; i < gone.length; i += 30) {
				const ids = gone.slice(i, i + 30);
				await d.exec(`DELETE FROM items WHERE store = ? AND id IN (${ids.map(() => "?").join(",")})`, [this.store, ...ids]);
			}
			let rows: (string | number)[][] = [];
			let bytes = 0;
			const flush = async () => {
				if (rows.length === 0) return;
				await d.exec(`INSERT OR REPLACE INTO items (store, id, version, created, updated, body) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}`, rows.flat());
				rows = [];
				bytes = 0;
			};
			for (const it of items) {
				const body = JSON.stringify(it.body);
				if (rows.length >= ROWS || (rows.length > 0 && bytes + body.length > BYTES)) await flush();
				rows.push([this.store, it.id, it.version, it.createdAt, it.updatedAt, body]);
				bytes += body.length;
			}
			await flush();
		};
		const next = this.queue.then(run, run);
		this.queue = next.catch((e) => console.warn(`Flux couldn't keep its copy: ${e instanceof Error ? e.message : String(e)}`));
		return next;
	}
}
