// The agents' tools: sim_*, each an action of ops.ts on the calling
// thread's own simulator.
import { tool, type ToolContent, type ToolContext } from "swarm";
import { SimError } from "./ios";
import * as ops from "./ops";
import { PoolError } from "./pool";
import { message } from "./state";

function b64(data: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
	return btoa(bin);
}

function result(o: ops.Out, isError = false) {
	const content: ToolContent[] = [{ type: "text", text: o.text }];
	if (o.shot) content.push({ type: "image", data: b64(o.shot.data), mimeType: o.shot.mimeType });
	return { content, isError: isError || (o.code !== undefined && o.code !== 0) };
}

/** An error the agent reads as the action's, not a crash. */
export const said = (e: unknown) => (e instanceof SimError || e instanceof PoolError ? e.message : `Failed: ${message(e)}`);

function simTool<A>(name: string, fn: (a: A, ctx: ToolContext) => Promise<ops.Out> | ops.Out) {
	tool<A>(name, async (a, ctx) => {
		try {
			return result(await fn(a, ctx));
		} catch (e) {
			return result({ text: said(e) }, true);
		}
	});
}

type P = { platform?: string; wait?: number };

export function registerTools() {
	simTool<P>("sim_status", () => ops.status());
	simTool<P & { note?: string }>("sim_take", (a, ctx) => ops.take(ctx.thread, a.platform, a));
	simTool<P>("sim_release", (a, ctx) => ops.release(ctx.thread, a.platform));
	simTool<P & { show?: boolean }>("sim_capture", (a, ctx) => ops.capture(ctx.thread, a.platform, a));
	simTool<P>("sim_describe", (a, ctx) => ops.describe(ctx.thread, a.platform, a));
	simTool<P & { steps: string[]; capture?: boolean }>("sim_drive", (a, ctx) => ops.drive(ctx.thread, a.platform, a.steps, a));
	simTool<P & { action: string; target?: string; args?: string[] }>("sim_app", (a, ctx) => ops.app(ctx.thread, a.platform, a.action, a.target, a));
	simTool<P & { action: string; value?: string; app?: string }>("sim_device", (a, ctx) => ops.device(ctx.thread, a.platform, a.action, a.value, a));
}
