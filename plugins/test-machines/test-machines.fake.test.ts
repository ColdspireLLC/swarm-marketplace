import { createFakePluginHost, expect, test } from "swarm/testing";

test("status lists the demo machine", async () => {
	const host = await createFakePluginHost({ settings: { bb: false, demo: true } });
	try {
		const out = await host.run("status");
		expect(out.stdout).toContain("demo — Demo machine: free.");
	} finally {
		await host.close();
	}
});
