// The Proxmox servers the plugin knows: each one's address, how it signs
// in and the certificate trusted, in the setting servers; their secrets
// (a token's secret, or a password and the ticket it last gave) in the
// keychain, in the secret setting secrets, by server; and which one the
// page and the command line act on, current.
import { settings } from "swarm";
import * as api from "./pve";
import type { Conn } from "./pve";

export interface Server {
	id: string;
	name: string;
	url: string;
	certificate: string;
	auth: "token" | "password";
	/** The token's ID (root@pam!swarm), or the user (root@pam). */
	who: string;
}

/** What's kept in the keychain of a server. */
export interface Secret {
	secret: string;
	ticket?: string;
	csrf?: string;
	at?: number;
}

function parse<T>(key: string, empty: T): T {
	try {
		const v = String(settings.get(key) ?? "");
		return v ? (JSON.parse(v) as T) : empty;
	} catch {
		return empty;
	}
}

export const servers = (): Server[] => parse<Server[]>("servers", []);
const secrets = (): Record<string, Secret> => parse<Record<string, Secret>>("secrets", {});

/** The server acted on: the one chosen, else the first. */
export function current(): Server | undefined {
	const all = servers();
	const id = String(settings.get("current") ?? "");
	return all.find((s) => s.id === id) ?? all[0];
}

export function setCurrent(id: string) {
	settings.set({ current: id });
}

/** A server by its name or ID, as a command names it; the current one for none. */
export function serverNamed(what: string | undefined): Server | undefined {
	if (!what) return current();
	const w = what.trim().toLowerCase();
	return servers().find((s) => s.id === what || s.name.toLowerCase() === w) ?? servers().find((s) => api.baseOf(s.url).toLowerCase().includes(w));
}

/** How to reach a server, as kept: a new ticket it's given is kept too. */
export function connOf(s: Server): Conn | null {
	const k = secrets()[s.id];
	if (!k?.secret) return null;
	const auth: api.Auth = s.auth === "token" ? { kind: "token", tokenId: s.who, secret: k.secret } : { kind: "password", user: s.who, password: k.secret, ticket: k.ticket ?? "", csrf: k.csrf ?? "", at: k.at ?? 0 };
	return { id: s.id, name: s.name, url: s.url, certificate: s.certificate, auth, onTicket: (ticket, csrf, at) => keepSecret(s.id, { ...k, ticket, csrf, at }) };
}

/** A Conn of a server not kept yet, as Settings tries it. */
export function trial(s: Omit<Server, "id"> & { id?: string }, secret: string): Conn {
	const auth: api.Auth = s.auth === "token" ? { kind: "token", tokenId: s.who, secret } : { kind: "password", user: s.who, password: secret, ticket: "", csrf: "", at: 0 };
	return { id: s.id ?? "", name: s.name, url: s.url, certificate: s.certificate, auth };
}

function keepSecret(id: string, k: Secret) {
	settings.set({ secrets: JSON.stringify({ ...secrets(), [id]: k }) });
}

/** Adds a server, or changes one, with its secret (and the ticket it was just given). */
export function saveServer(s: Server, c: Conn) {
	const all = servers().filter((x) => x.id !== s.id);
	const a = c.auth;
	const k: Secret = a.kind === "token" ? { secret: a.secret } : { secret: a.password, ticket: a.ticket, csrf: a.csrf, at: a.at };
	settings.set({ servers: JSON.stringify([...all, s].sort((x, y) => x.name.localeCompare(y.name))), secrets: JSON.stringify({ ...secrets(), [s.id]: k }) });
}

export function removeServer(id: string) {
	const left = servers().filter((s) => s.id !== id);
	const { [id]: _gone, ...rest } = secrets();
	settings.set({ servers: JSON.stringify(left), secrets: JSON.stringify(rest), current: String(settings.get("current") ?? "") === id ? (left[0]?.id ?? null) : String(settings.get("current") ?? "") || null });
}

/** Trusts the certificate a server now shows. */
export function trustCertificate(id: string, fp: string) {
	settings.set({ servers: JSON.stringify(servers().map((s) => (s.id === id ? { ...s, certificate: fp } : s))) });
}

export function newId(): string {
	const b = new Uint8Array(6);
	crypto.getRandomValues(b);
	return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * What changes what the plugin shows: the servers, which one is current,
 * and their secrets, not the tickets a sign-in keeps.
 */
export function shape(): string {
	const k = secrets();
	return JSON.stringify([servers(), String(settings.get("current") ?? ""), Object.entries(k).map(([id, v]) => [id, v.secret.length, v.secret.slice(-4)])]);
}
