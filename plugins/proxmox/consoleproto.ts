// The protocol of Proxmox's terminal proxy, as xterm.js speaks it to
// vncwebsocket (console.ts says the rest): first "USER:TICKET\n", which
// it answers "OK"; then what's typed, "0:LENGTH:DATA" (LENGTH in UTF-8
// bytes); the terminal's size, "1:COLS:ROWS:"; a ping, "2"; and from it,
// the terminal's output, as bytes. Apart from Swarm, so it's tested alone.

/** The socket a console speaks over: a WebSocket's, or a test's. */
export interface Sock {
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((data: ArrayBuffer | string) => void) | null;
	onclose: ((why: string) => void) | null;
}

/** The terminal it shows in: an OpenTerminal, or a test's. */
export interface Term {
	write(data: string): void;
	close(code?: number): void;
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** What's typed, as the proxy takes it. */
export const inputFrame = (text: string) => `0:${utf8Len(text)}:${text}`;
export const resizeFrame = (cols: number, rows: number) => `1:${cols}:${rows}:`;

/**
 * Joins a socket to a terminal: signs in with user and ticket, shows what
 * comes once Proxmox says OK, and sends what's typed and the size. Its
 * functions are the terminal's onInput, onResize and onExit, and a ping
 * to call every 30 s; size before it's open is sent as it opens.
 */
export function bridge(sock: Sock, term: () => Term | undefined, user: string, ticket: string, settled?: (why?: string) => void) {
	const decoder = new TextDecoder();
	let ready = false;
	let size: [number, number] | undefined;
	let ended = false;
	sock.onopen = () => sock.send(`${user}:${ticket}\n`);
	sock.onmessage = (data) => {
		let text = typeof data === "string" ? data : decoder.decode(new Uint8Array(data), { stream: true });
		if (!ready) {
			// Proxmox's OK, before the terminal's own output.
			if (!text.startsWith("OK")) return;
			ready = true;
			settled?.();
			text = text.slice(2);
			if (size) sock.send(resizeFrame(size[0], size[1]));
		}
		if (text) term()?.write(text);
	};
	sock.onclose = (why) => {
		if (ended) return;
		ended = true;
		if (!ready) settled?.(why || "Proxmox closed it");
		term()?.write(`\r\n\x1b[2m[${ready ? "Disconnected" : `Couldn't connect${why ? `: ${why}` : ""}`}]\x1b[0m\r\n`);
		term()?.close(ready ? 0 : 1);
	};
	return {
		onInput: (text: string) => {
			if (ready) sock.send(inputFrame(text));
		},
		onResize: (cols: number, rows: number) => {
			size = [cols, rows];
			if (ready) sock.send(resizeFrame(cols, rows));
		},
		onExit: () => {
			if (!ended && !ready) settled?.("its terminal closed");
			ended = true;
			sock.close();
		},
		ping: () => {
			if (ready) sock.send("2");
		},
	};
}
