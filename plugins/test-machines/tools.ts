// The agents' tools: machine_*, each an action of ops.ts in the calling
// thread's turn. A call the user took the machine from under says so,
// whatever it did.
import { tool, type ToolContent, type ToolContext } from "swarm";
import { DriverError } from "./drivers";
import * as ops from "./ops";
import { base64 } from "./png";
import { message, st, turnsOf } from "./state";
import { TurnError } from "./turns";

/** A tool's result, from an action's. */
function result(o: ops.Out, isError = false) {
	const content: ToolContent[] = [{ type: "text", text: o.text }];
	if (o.shot) content.push({ type: "image", data: base64(o.shot.data), mimeType: o.shot.mimeType });
	return { content, isError: isError || (o.code !== undefined && o.code !== 0) };
}

/** Why the user's taking a machine cut a call off, as its result says first. */
export function cutOffNote(thread: string, since: number): string {
	const taken = st.machines.filter((m) => turnsOf(m).cutSince(thread, since)).map((m) => m.name);
	return taken.length ? `The user took ${taken.join(" and ")} while this ran: it's no longer your turn there. Stop, and tell them what you were doing.` : "";
}

/** An error the agent reads as the action's, not a crash. */
export const said = (e: unknown) => (e instanceof TurnError || e instanceof DriverError ? e.message : `Failed: ${message(e)}`);

function machineTool<A>(name: string, fn: (a: A, ctx: ToolContext) => Promise<ops.Out>) {
	tool<A>(name, async (a, ctx) => {
		const started = Date.now();
		let r: ReturnType<typeof result>;
		try {
			r = result(await fn(a, ctx));
		} catch (e) {
			r = result({ text: said(e) }, true);
		}
		const cut = cutOffNote(ctx.thread, started);
		if (cut) (r.content[0] as { type: "text"; text: string }).text = `${cut}\n\n${(r.content[0] as { text: string }).text}`;
		return r;
	});
}

export function registerTools() {
	machineTool<{ machine?: string; live?: boolean }>("machine_status", (a) => ops.status(a.machine, a.live));
	machineTool<{ machine: string; note?: string; wait?: number }>("machine_take", (a, ctx) => ops.take(ctx.thread, a.machine, a.note, a.wait));
	machineTool<{ machine?: string }>("machine_release", (a, ctx) => ops.release(ctx.thread, a.machine));
	machineTool<{ machine: string; show?: boolean; wait?: number }>("machine_capture", (a, ctx) => ops.capture(ctx.thread, a.machine, a));
	machineTool<{ machine: string; wait?: number }>("machine_describe", (a, ctx) => ops.describe(ctx.thread, a.machine, a.wait));
	machineTool<{ machine: string; steps: string[]; capture?: boolean; wait?: number }>("machine_drive", (a, ctx) => ops.drive(ctx.thread, a.machine, a.steps, a));
	machineTool<{ machine: string; command: string; timeout?: number; background?: boolean; exclusive?: boolean; wait?: number }>("machine_run", (a, ctx) => ops.run(ctx.thread, a.machine, a.command, a));
	machineTool<{ job?: string; action?: "status" | "wait" | "stop"; wait?: number }>("machine_job", (a, ctx) => ops.job(ctx.thread, a.job, a.action, a.wait));
	machineTool<{ machine: string; action: string; target: string; args?: string[]; env?: Record<string, string>; cwd?: string; wait?: number }>("machine_app", (a, ctx) => ops.app(ctx.thread, a.machine, a.action, a.target, a));
	machineTool<{ machine: string; action: "put" | "get"; local: string | string[]; remote: string; wait?: number }>("machine_files", (a, ctx) => ops.files(ctx.thread, a.machine, a.action, Array.isArray(a.local) ? a.local : [a.local], a.remote, a.wait));
	machineTool<{ machine: string; action: string; wait?: number }>("machine_power", (a, ctx) => ops.power(ctx.thread, a.machine, a.action, a.wait));
	machineTool<{ machine: string; action: "start" | "stop"; title?: string; seconds?: number; wait?: number }>("machine_record", (a, ctx) => ops.record(ctx.thread, a.machine, a.action, a));
}
