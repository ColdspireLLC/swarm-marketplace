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
		// Math's fonts are the plugin's, which the window loads as it first shows them.
		if (name.includes("math")) await new Promise((r) => setTimeout(r, 1500));
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

test("math that isn't TeX says why", async (t) => {
	const w = await open(t, "The sum:\n\n```math\n\\frac{1}{\n```");
	await w.see("Couldn't draw this math");
	await w.see("Unexpected end of input in a macro argument, expected '}' at end of input: \\frac{1}{");
	await w.screenshot("math-error");
});

test("display math in a reply's text is typeset, with no frame", async (t) => {
	const w = await open(t, "Euler's identity ties five constants together:\n\n$$\ne^{i\\pi} + 1 = 0\n$$\n\nAnd the Gaussian integral:\n\n$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$");
	await w.see("And the Gaussian integral:");
	await w.gone("Copy the source");
	await new Promise((r) => setTimeout(r, 1500));
	await w.screenshot("display-math");
	await w.dark(true);
	await w.screenshot("display-math-dark");
});

test("what isn't Mermaid shows its source, saying so", async (t) => {
	const w = await open(t, "The plan:\n\n```mermaid\nroadmap\n  Q1: ship\n```");
	await w.see("Couldn't draw this diagram");
	await w.see('Swarm doesn\'t know this kind of Mermaid diagram: it starts with "roadmap".');
	await w.screenshot("mermaid-error");
});

test("a drawing expands over the window", async (t) => {
	const w = await open(t, SAMPLES.sequence.reply);
	await w.see("Sequence diagram");
	await w.click("Expand");
	await w.see("Close the drawing");
	await w.see("Opens Settings, Plugins");
	await w.screenshot("expanded");
	await w.dark(true);
	await w.screenshot("expanded-dark");
	await w.click("Close the drawing");
	await w.gone("Close the drawing");
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
