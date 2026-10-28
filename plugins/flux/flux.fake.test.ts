import { createFakePluginHost, expect, test } from "swarm/testing";

test("status when Flux isn't set up", async () => {
	const host = await createFakePluginHost();
	try {
		const out = await host.run("status");
		expect(out.stdout).toContain("Flux: unconfigured");
		expect(out.stdout).toContain("Set Flux's URL");
	} finally {
		await host.close();
	}
});
