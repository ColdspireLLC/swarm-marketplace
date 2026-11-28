// Consoles in Swarm's own terminal: a container's, a node's shell, and a
// VM's serial console. Proxmox's terminal proxy (termproxy) gives a port
// and a ticket; its vncwebsocket carries the terminal, in xterm.js's
// protocol, which Proxmox's own page speaks:
//
//   - first the user and the ticket, "USER:TICKET\n", which it answers "OK";
//   - what's typed, "0:LENGTH:DATA", LENGTH in UTF-8 bytes;
//   - the terminal's size, "1:COLS:ROWS:";
//   - a ping, "2", to keep it open;
//   - and from it, the terminal's output, as bytes.
//
// The terminal is one the plugin drives (swarm.terminal.open's onInput).
// A VM's graphical console (VNC) opens in Proxmox's page in a browser.
import { terminal, ui } from "swarm";
import * as api from "./pve";
import type { Conn } from "./pve";
import { bridge, type Sock } from "./consoleproto";

/** What a console is of: a container, a VM's serial port, or a node's shell. */
export type ConsoleOf = { kind: "lxc" | "qemu"; node: string; vmid: number; name: string } | { kind: "node"; node: string; name: string };

const enc = encodeURIComponent;

function pathOf(of: ConsoleOf): string {
	return of.kind === "node" ? `/nodes/${enc(of.node)}` : `/nodes/${enc(of.node)}/${of.kind}/${of.vmid}`;
}

/** An open console: its terminal, for ui.terminal, and what ends it. */
export interface OpenConsole {
	id: number;
	title: string;
	close(): void;
}

/** Opens a console in a terminal the page shows (ui.terminal): once Proxmox says OK, or a PveError. ended is told as it ends. */
export async function openConsole(c: Conn, of: ConsoleOf, ended?: () => void): Promise<OpenConsole> {
	// A Swarm from before terminals a plugin drives would open the user's
	// own shell in their place: none is opened there.
	if (!consolesHere()) throw new api.PveError("This Swarm can't show a console: update Swarm, or open it in Proxmox.", 0);
	const base = pathOf(of);
	const proxy = await api.req<{ port: number | string; ticket: string; user: string; upid?: string }>(c, "POST", `${base}/termproxy`, of.kind === "qemu" ? { serial: "serial0" } : {});
	const wsUrl = `${api.baseOf(c.url).replace(/^http/, "ws")}/api2/json${base}/vncwebsocket?port=${proxy.port}&vncticket=${enc(proxy.ticket)}`;
	const ws = new WebSocket(wsUrl, { protocols: ["binary"], headers: api.authHeaders(c), ...(c.certificate ? { certificate: c.certificate } : {}) });
	ws.binaryType = "arraybuffer";
	const sock: Sock = { send: (d) => ws.send(d), close: () => ws.close(), onopen: null, onmessage: null, onclose: null };
	ws.onopen = () => sock.onopen?.();
	ws.onmessage = (m) => sock.onmessage?.(m.data as ArrayBuffer | string);
	ws.onclose = (e) => sock.onclose?.(e.reason);
	let term: ReturnType<typeof terminal.open> | undefined;
	// Opened once Proxmox says OK; a proxy that closes before, or says
	// nothing in 15 s, is why it didn't, and its terminal goes.
	let settle!: (why?: string) => void;
	const opened = new Promise<void>((ok, fail) => {
		settle = (why) => (why ? fail(new api.PveError(`The console didn't connect: ${why}.`, 0)) : ok());
	});
	const b = bridge(sock, () => term, proxy.user, proxy.ticket, (why) => settle(why));
	const title = of.kind === "node" ? `${of.node}: shell` : of.kind === "qemu" ? `${of.name}: serial console` : `${of.name}: console`;
	let pinger: number | undefined;
	try {
		term = terminal.open({
			title,
			onInput: b.onInput,
			onResize: b.onResize,
			onExit: () => {
				if (pinger !== undefined) clearInterval(pinger);
				b.onExit();
				ended?.();
			},
		});
	} catch (e) {
		ws.close();
		throw e;
	}
	pinger = setInterval(b.ping, 30_000);
	const late = setTimeout(() => {
		settle("Proxmox didn't answer");
		ws.close();
		term?.close(1);
	}, 15_000);
	try {
		await opened;
	} finally {
		clearTimeout(late);
	}
	const t = term;
	return { id: t.id, title, close: () => t.close(0) };
}

/** Whether this Swarm has terminals a plugin drives and shows (ui.terminal, format 21). */
export const consolesHere = () => typeof (ui as unknown as { terminal?: unknown }).terminal === "function";

/** Whether a VM has a serial port its console can reach: serial0 in its configuration. */
export const hasSerial = (cfg: Record<string, string | number> | undefined) => cfg?.serial0 !== undefined;
