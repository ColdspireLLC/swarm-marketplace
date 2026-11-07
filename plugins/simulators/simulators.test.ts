import { expect, test } from "swarm/test";
import { avdFiles, pickImage, pickModel, stepsScript, type Runtime } from "./devices";
import { Pool, PoolError } from "./pool";
import { androidPackagesOff, androidSettingsSet, parseIni, slimmedPackages, slimScript, unslimScript } from "./slimandroid";
import { IOS_CATEGORIES, iosLabelsOff, parseDisabled, parseKeep, slimmedLabels, slimmedPlist } from "./slimios";

// A thread keeps its slot across calls, gets the one it had back once
// free, and waits in line where all are held; the first in line gets the
// next one given back. A turn's end gives back its slots, but a late end
// of an earlier turn doesn't.
test("the pool: one thread's each, back to who had it, a line", async () => {
	let now = 1000;
	const p = new Pool(() => 2, undefined, () => now);
	const a = await p.take("A", "ios", { waitMs: 0, turn: 3 });
	expect([a.slot.n, a.fresh, a.created]).toEqual([1, true, true]);
	expect((await p.take("A", "ios", { waitMs: 0 })).slot).toBe(a.slot);
	const b = await p.take("B", "ios", { waitMs: 0 });
	expect(b.slot.n).toBe(2);
	await expect(p.take("C", "ios", { waitMs: 0 })).rejects.toThrow("other threads'");
	// Android's are apart.
	expect((await p.take("C", "android", { waitMs: 0 })).slot.n).toBe(1);

	p.turnEnded("A", 2); // an earlier turn's end, heard late
	expect(p.held("A", "ios")).toBe(a.slot);
	const c = p.take("C", "ios", { waitMs: 60_000 });
	p.turnEnded("A", 3);
	const got = await c;
	expect([got.slot, got.fresh]).toEqual([a.slot, true]);

	// B gives its back and gets it again, as it was.
	p.releaseAll("B");
	const again = await p.take("B", "ios", { waitMs: 0 });
	expect([again.slot, again.fresh]).toEqual([b.slot, false]);

	// An action running holds a slot past its turn's end.
	let done!: () => void;
	const running = p.using(again.slot, () => new Promise<void>((r) => (done = r)));
	p.turnEnded("B");
	expect(p.held("B", "ios")).toBe(again.slot);
	done();
	await running;
	expect(p.held("B", "ios")).toBe(undefined);

	// Held unused 10 minutes while another waits: bumped.
	const d = p.take("D", "ios", { waitMs: 60 * 60_000 });
	expect(p.waiting.length).toBe(0); // B's was free: D has it
	expect((await d).slot).toBe(b.slot);
	const e = p.take("E", "ios", { waitMs: 60 * 60_000 });
	now += 11 * 60_000;
	// The first bumped goes to E: nobody waits for the other, which its holder keeps.
	expect(p.sweep().bumped.length).toBe(1);
	expect((await e).slot.holder?.thread).toBe("E");

	// Two calls of a thread in line: the slot is the thread's, and neither stays in line.
	const q = new Pool(() => 1, undefined, () => now);
	await q.take("A", "ios", { waitMs: 0 });
	const b1 = q.take("B", "ios", { waitMs: 60_000 });
	const b2 = q.take("B", "ios", { waitMs: 60_000 });
	q.releaseAll("A");
	expect((await b1).slot).toBe((await b2).slot);
	expect(q.waiting.length).toBe(0);

	// A call that stops waiting keeps its thread's place: the slot that comes up is held for it,
	// and its next call gets it.
	const r = new Pool(() => 1, undefined, () => now);
	await r.take("A", "android", { waitMs: 0 });
	await expect(r.take("B", "android", { waitMs: 1 })).rejects.toThrow("#1 in line");
	await expect(r.take("C", "android", { waitMs: 1 })).rejects.toThrow("#2 in line");
	r.releaseAll("A");
	expect(r.held("B", "android")?.holder?.note).toBe("kept for its next call");
	const back = await r.take("B", "android", { waitMs: 0 });
	expect([back.slot.holder?.thread, r.waiting.map((w) => w.thread)]).toEqual(["B", ["C"]]);

	// None for agents.
	await expect(new Pool(() => 0).take("A", "ios", { waitMs: 0 })).rejects.toThrow("0");
	expect(new PoolError("busy", "x").code).toBe("busy");
});

// The overrides launchd_sim reads: slimming's labels set, the device's
// other entries kept as they were; stock again takes slimming's away and
// leaves the rest. A category kept keeps its labels on, even those
// another category lists too (financed: store and other).
test("iOS slimming writes launchd's overrides, keeping the device's own", () => {
	const keep = parseKeep("store, web, com.apple.healthd, bogus", IOS_CATEGORIES);
	expect(keep).toEqual({ categories: ["store", "web"], labels: ["com.apple.healthd"], unknown: ["bogus"] });
	const off = iosLabelsOff(keep);
	expect(off).toContain("com.apple.searchd");
	expect(off).not.toContain("com.apple.financed");
	expect(off).not.toContain("com.apple.healthd");
	expect(off).not.toContain("com.apple.gamed");

	const theirs = `<?xml version="1.0"?><plist version="1.0"><dict><key>com.example.mine</key><true/><key>com.apple.searchd</key><false/></dict></plist>`;
	const slim = slimmedPlist(theirs, off);
	const entries = parseDisabled(slim);
	expect(entries.get("com.example.mine")).toBe(true);
	expect(entries.get("com.apple.searchd")).toBe(true);
	expect(slimmedLabels(slim).length).toBe(off.length);
	const stock = parseDisabled(slimmedPlist(slim, []));
	expect([...stock]).toEqual([["com.example.mine", true]]);
});

// The guest's script records what it changes before changing it, only
// once (a second run keeps the first originals), and the undo puts each
// back; nothing reaches the shell that isn't a package or a setting.
test("Android slimming is undone from what it recorded", () => {
	const packages = androidPackagesOff({ categories: ["media"], labels: ["com.google.android.tts"] });
	expect(packages).toContain("com.google.android.googlequicksearchbox");
	expect(packages).not.toContain("com.google.android.youtube");
	expect(packages).not.toContain("com.google.android.tts");
	expect(packages).not.toContain("com.google.android.gms");
	const settings = androidSettingsSet({ categories: ["location"] });
	expect(settings.some(([, name]) => name === "location_mode")).toBe(false);

	const script = slimScript(packages, settings);
	expect(script).toContain(`grep -q '^set global auto_sync ' /data/local/tmp/swarm-slim-state || echo "set global auto_sync $(settings get global auto_sync)"`);
	expect(script.indexOf(`echo "pkg $p" >>`)).toBeLessThan(script.indexOf("pm disable-user"));
	expect(() => slimScript(["com.x; reboot"], [])).toThrow("not a package");
	expect(unslimScript()).toContain(`pm enable --user 0 "$a"`);
	expect(slimmedPackages("pkg com.a\nset global auto_sync 1\npkg com.b\npkg com.a\n")).toEqual(["com.a", "com.b"]);
});

test("an agent's AVD, slim or stock", () => {
	const image = pickImage(["system-images;android-35;google_apis;arm64-v8a", "system-images;android-36;google_apis_playstore;arm64-v8a", "system-images;android-36;google_apis_ps16k;arm64-v8a", "system-images;android-36;google_apis;arm64-v8a", "system-images;android-36;google_apis;x86_64"], "arm64-v8a");
	expect(image).toBe("system-images;android-36;google_apis;arm64-v8a");
	const stock = parseIni(avdFiles("/h/avd", "swarm_agent_1", 1, image, { os: "darwin", headless: true }, false).config);
	const slim = avdFiles("/h/avd", "swarm_agent_1", 1, image, { os: "darwin", headless: true }, true);
	const s = parseIni(slim.config);
	expect([stock.get("hw.ramSize"), s.get("hw.ramSize"), s.get("hw.gpu.mode"), s.get("image.sysdir.1")]).toEqual(["2048", "1536", "host", "system-images/android-36/google_apis/arm64-v8a/"]);
	expect(parseIni(slim.pointer).get("path")).toBe("/h/avd/swarm_agent_1.avd");
});

// What an agent types reaches Android's input text, not the shell.
test("Android input steps, the text escaped", () => {
	expect(stepsScript(["tap 10.4 20", "type hi there; reboot $(id)", "key back", "swipe 1 2 3 4"])).toBe(
		["input tap 10 20", "input text hi%sthere\\;%sreboot%s\\$\\(id\\)", "input keyevent KEYCODE_BACK", "input swipe 1 2 3 4 300"].join("\n"),
	);
	expect(() => stepsScript(["tap x 1"])).toThrow("tap x 1");
});

test("the iOS model agents' simulators are made of", () => {
	const t = (name: string, family = "iPhone") => ({ identifier: `com.apple.${name.replace(/ /g, "-")}`, name, family });
	const rts: Runtime[] = [
		{ identifier: "ios-18", version: "18.6", name: "iOS 18.6", types: [t("iPhone 16 Pro"), t("iPhone 16")] },
		{ identifier: "ios-26", version: "26.5", name: "iOS 26.5", types: [t("iPhone 17"), t("iPhone 17 Pro"), t("iPhone 17e"), t("iPad Pro", "iPad")] },
	];
	expect(pickModel(rts, "")?.type.name).toBe("iPhone 17 Pro");
	expect(pickModel(rts, "iphone 16")?.runtime.version).toBe("18.6");
	expect(pickModel(rts, "Pixel")).toBe(null);
});
