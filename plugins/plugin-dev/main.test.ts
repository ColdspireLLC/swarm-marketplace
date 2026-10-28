import { expect, test } from "swarm/test";

test("starts, and gives its skills", async (t) => {
	const thread = await t.thread("say Ready.");
	await thread.idle();
	expect((await t.log()).join("\n")).toMatch(/starting Plugin development 1\.0\.0/);
});
