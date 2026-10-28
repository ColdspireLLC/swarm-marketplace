import { expect, test } from "swarm/test";
import { SAMPLES } from "./samples";

/** The thread of a reply, opened: its title is the prompt's first line. */
async function open(t: any, reply: string) {
	const thread = await t.thread("say " + reply);
	await thread.idle();
	const w = await t.window();
	await w.resize(1100, 900);
	await w.click("say " + reply.split("\n")[0]);
	return w;
}

// Each sample, drawn in Swarm's window as the demo agent replies with it,
// light and dark, to test-shots/.

for (const [name, s] of Object.entries(SAMPLES)) {
	test(`draws ${name}`, async (t) => {
		const w = await open(t, s.reply);
		await w.see(s.see);
		await w.see("Copy the source");
		await w.screenshot(name);
		await w.dark(true);
		await w.see(s.see);
		await w.screenshot(name + "-dark");
	});
}

test("a broken chart says why, and shows its source", async (t) => {
	const w = await open(t, 'This one is wrong:\n\n```chart\n{ "type": "radar", "series": [] }\n```');
	await w.see("Couldn't draw this chart");
	await w.see('"type" is one of bar, line, area, scatter, pie, donut, not "radar".');
	await w.screenshot("error");
});

test("a kind of Mermaid it doesn't draw shows its source", async (t) => {
	const w = await open(t, "The classes:\n\n```mermaid\nclassDiagram\n  Animal <|-- Duck\n```");
	await w.see("Couldn't draw this diagram");
	await w.see("Animal <|-- Duck");
});

test("the data and the source are a click away", async (t) => {
	const w = await open(t, SAMPLES["bar-stacked"].reply);
	await w.see("Chart");
	await w.click("Show the data");
	await w.see("Passed");
	await w.see("55 runs");
	await w.screenshot("table");
	await w.click("Show the source");
	await w.see('"stacked": true');
	await w.click("Show the chart");
	await w.gone("55 runs");
});
