// The console's protocol, with Proxmox's proxy and the terminal stood in for.
import { expect, test } from "swarm/testing";
import { bridge, type Sock } from "./consoleproto";

function fakes() {
	const sent: string[] = [];
	const shown: string[] = [];
	let closed: number | undefined;
	let sockClosed = false;
	const sock: Sock = { send: (d) => sent.push(d), close: () => void (sockClosed = true), onopen: null, onmessage: null, onclose: null };
	const term = { write: (d: string) => shown.push(d), close: (code?: number) => void (closed = code ?? 0) };
	return { sent, shown, sock, term, closed: () => closed, sockClosed: () => sockClosed };
}

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

test("signs in, waits for OK, then carries what's typed, the size and the output", () => {
	const f = fakes();
	const settled: (string | undefined)[] = [];
	const b = bridge(f.sock, () => f.term, "root@pam!swarm", "PVEVNC:abc", (why) => settled.push(why));
	// The size the window has before the proxy answers goes once it does.
	b.onResize(120, 40);
	b.onInput("ignored before OK");
	f.sock.onopen!();
	expect(f.sent).toEqual(["root@pam!swarm:PVEVNC:abc\n"]);
	f.sock.onmessage!(bytes("OKroot@ct:~# "));
	expect(f.sent[1]).toBe("1:120:40:");
	expect(settled).toEqual([undefined]);
	expect(f.shown).toEqual(["root@ct:~# "]);
	// Lengths in UTF-8 bytes, as the proxy reads them.
	b.onInput("é");
	expect(f.sent[2]).toBe("0:2:é");
	// A character cut across two messages comes out whole.
	const e = new TextEncoder().encode("✓");
	f.sock.onmessage!(e.slice(0, 1).buffer as ArrayBuffer);
	f.sock.onmessage!(e.slice(1).buffer as ArrayBuffer);
	expect(f.shown.join("")).toBe("root@ct:~# ✓");
	b.ping();
	expect(f.sent[3]).toBe("2");
	f.sock.onclose!("");
	expect(f.shown.at(-1)).toContain("[Disconnected]");
	expect(f.closed()).toBe(0);
});

test("a proxy that closes before OK says so, and closing the terminal closes the socket", () => {
	const f = fakes();
	const settled: (string | undefined)[] = [];
	const b = bridge(f.sock, () => f.term, "root@pam", "t", (why) => settled.push(why));
	f.sock.onopen!();
	f.sock.onclose!("401 permission denied");
	expect(settled).toEqual(["401 permission denied"]);
	expect(f.shown.join("")).toContain("Couldn't connect: 401 permission denied");
	expect(f.closed()).toBe(1);

	const g = fakes();
	const c = bridge(g.sock, () => g.term, "root@pam", "t");
	c.onExit();
	expect(g.sockClosed()).toBe(true);
	g.sock.onclose!("");
	expect(g.shown).toEqual([]);
});
