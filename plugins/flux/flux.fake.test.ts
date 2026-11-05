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

test("a merge request moves its issue to In Review, and never completes it", async () => {
	const { requestStatus } = await import("./src/requeststatus");
	// Merged isn't released: a merge leaves the issue for whoever ships it.
	expect(requestStatus("progress", "merged", true)).toBe("review");
	expect(requestStatus("review", "merged", true)).toBe("review");
	expect(requestStatus("todo", "merged", false)).toBe("review");
	// Opened, an open issue goes to review; closed unmerged, back to work.
	expect(requestStatus("backlog", "opened", true)).toBe("review");
	expect(requestStatus("review", "closed", true)).toBe("progress");
	// What someone settled stays settled.
	expect(requestStatus("complete", "merged", true)).toBe("complete");
	expect(requestStatus("complete", "closed", true)).toBe("complete");
	expect(requestStatus("canceled", "merged", true)).toBe("canceled");
});
