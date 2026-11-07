import { expect, test } from "swarm/test";
import { describeCron, nextCron, parseCron, parseDuration } from "./cron";
import { afterRun, afterStart, capApproval, dueNow, silent } from "./plan";
import type { Automation } from "./store";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

// Crons come due when cron says, in local time; day of month and of week,
// both narrowed, match either; what can't be is refused.
test("crons, durations, and what a schedule says", () => {
	const next = (expr: string, from: number) => nextCron(parseCron(expr), from);
	// Fri 2026-11-06 09:30: weekdays at 9:30 next comes Monday.
	expect(next("30 9 * * 1-5", at(2026, 11, 6, 9, 30))).toBe(at(2026, 11, 9, 9, 30));
	expect(next("*/15 * * * *", at(2026, 11, 6, 9, 31))).toBe(at(2026, 11, 6, 9, 45));
	expect(next("0 0 1 jan *", at(2026, 11, 6))).toBe(at(2027, 1, 1));
	expect(next("@daily", at(2026, 11, 6, 23, 59))).toBe(at(2026, 11, 7));
	// 13th or a Friday: Fri 13 Nov counts once, Fri 20th by its weekday.
	expect(next("0 12 13 * 5", at(2026, 11, 7))).toBe(at(2026, 11, 13, 12));
	expect(next("0 12 13 * 5", at(2026, 11, 13, 12))).toBe(at(2026, 11, 20, 12));
	expect(next("0 0 * * 7", at(2026, 11, 6))).toBe(at(2026, 11, 8)); // 7 is Sunday too
	expect(next("0 0 30 2 *", at(2026, 1, 1))).toBe(null);
	expect(() => parseCron("0 9 * *")).toThrow("five fields");
	expect(() => parseCron("61 * * * *")).toThrow("out of 0-59");

	expect(describeCron("30 9 * * 1-5")).toBe("Weekdays at 09:30");
	expect(describeCron("0 8 * * *")).toBe("Every day at 08:00");
	expect(describeCron("*/10 * * * *")).toBe("Every 10 minutes");
	expect(describeCron("5 4 * * 0")).toBe("Sundays at 04:05");
	expect(describeCron("0 * * * 1-5")).toBe("Every hour on weekdays");
	expect(describeCron("1,2 3 * * *")).toBe("1,2 3 * * *");

	expect([parseDuration("90s"), parseDuration("2h30m"), parseDuration("1d"), parseDuration("5", "m"), parseDuration("soon")]).toEqual([90_000, 9_000_000, 86_400_000, 300_000, null]);
});

// A failed scheduled run of a repeat is tried twice more, never past its
// next time; success clears its failures; a one-shot is done once started.
test("retries, one-shots, and what an agent's runs may do", () => {
	const now = at(2026, 11, 6, 9);
	const a: Automation = { id: "a", name: "A", project: "p", mode: "agent", cron: "0 * * * *", enabled: true, origin: "user", nextAt: at(2026, 11, 6, 10), retryAt: null, failures: 0, created: 0, updated: 0 };
	expect(dueNow(a, now)).toBe(null);
	expect(dueNow({ ...a, nextAt: now }, now)).toBe("schedule");
	expect(dueNow({ ...a, nextAt: now, enabled: false }, now)).toBe(null);

	const f1 = afterRun(a, "schedule", "failed", "boom", now);
	expect(f1).toEqual({ failures: 1, retryAt: now + 30_000, lastError: "boom" });
	const f2 = afterRun({ ...a, ...f1 }, "retry", "failed", "boom", now);
	expect(f2.retryAt).toBe(now + 60_000);
	expect(afterRun({ ...a, failures: 2 }, "retry", "failed", "boom", now).retryAt).toBe(null);
	expect(afterRun({ ...a, nextAt: now + 10_000 }, "schedule", "failed", "x", now).retryAt).toBe(null);
	expect(afterRun({ ...a, failures: 2 }, "manual", "failed", "x", now).failures).toBe(2);
	expect(afterRun({ ...a, failures: 2, lastError: "x" }, "schedule", "skipped", undefined, now)).toEqual({ failures: 0, retryAt: null, lastError: undefined });

	expect(afterStart(a, "schedule", now).nextAt).toBe(at(2026, 11, 6, 10));
	expect(afterStart({ ...a, cron: undefined, at: now }, "schedule", now)).toEqual({ nextAt: null, retryAt: null, enabled: false });

	// No more than the agent that made it: across agents, an Auto gives Auto-accept edits.
	expect(capApproval("all", { approval: "edits", provider: "claude" }, "claude")).toBe("edits");
	expect(capApproval(undefined, { approval: "auto", provider: "claude" }, "claude")).toBe("auto");
	expect(capApproval("auto", { approval: "auto", provider: "claude" }, "codex")).toBe("edits");
	expect(capApproval("ask", { approval: "all", provider: "claude" }, "codex")).toBe("ask");

	expect([silent("", ""), silent("ok\n", ""), silent('checked\n{"wakeAgent": false}\n', ""), silent("", "warn")]).toEqual([true, false, true, false]);
});

const runsOf = async (t: { run(c: string, ...a: string[]): Promise<{ stdout: string }> }, name: string) => JSON.parse((await t.run("runs", name, "--json")).stdout) as { status: string; summary?: string; thread?: string; code?: number }[];

// The user's automations: an agent's run starts a thread with its prompt
// and ends with its turn; a script's keeps its output; a quiet one is
// skipped; a failing one keeps its error; a one-shot runs on its time.
test("agent and script runs", async (t) => {
	const made = await t.run("create", "--name", "Report", "--cron", "0 9 * * 1-5", "--prompt", "say The morning report is ready.");
	expect(made.stdout).toContain("Made Report (auto_");
	expect((await t.run("list")).stdout).toContain("Report  [on]  Weekdays at 09:00 (0 9 * * 1-5), next ");

	expect((await t.run("run", "Report")).stdout).toMatch(/Report: run #\d+ running in thread /);
	await t.until(async () => (await runsOf(t, "Report"))[0]?.status === "ok");
	const [run] = await runsOf(t, "Report");
	const threads = await t.call("Threads", {});
	const th = threads.find((x) => x.id === run!.thread)!;
	expect(th.title).toMatch(/^Report · /);
	expect(th.lastReply).toContain("The morning report is ready.");

	await t.run("create", "--name", "Quiet", "--cron", "@hourly", "--script", "true");
	await t.run("run", "Quiet");
	expect((await runsOf(t, "Quiet"))[0]).toMatchObject({ status: "skipped", summary: "Nothing to report" });

	await t.run("create", "--name", "Loud", "--cron", "@hourly", "--interpreter", "bash", "--script", 'echo "disk at 91%"; echo "$SWARM_AUTOMATION_ID" >&2');
	await t.run("run", "Loud");
	const loudRun = (await runsOf(t, "Loud"))[0] as unknown as { id: number };
	const loud = JSON.parse((await t.run("runs", "Loud", "--output", String(loudRun.id), "--json")).stdout);
	expect([loud.status, loud.summary, loud.stdout]).toEqual(["ok", "disk at 91%", "disk at 91%\n"]);
	expect(loud.stderr).toMatch(/^auto_/);

	await t.run("create", "--name", "Broken", "--cron", "@hourly", "--script", "echo nope >&2; exit 3");
	expect((await t.run("run", "Broken")).code).toBe(1);
	const broken = JSON.parse((await t.run("show", "Broken", "--json")).stdout);
	expect([broken.state, broken.lastError, broken.failures]).toEqual(["failing", "Exited 3: nope", 0]);

	// Once, a moment from now: the timer between ticks runs it, and it's done.
	await t.run("create", "--name", "Soon", "--in", "1s", "--script", "echo ran");
	await t.until(async () => (await runsOf(t, "Soon"))[0]?.status === "ok");
	expect(JSON.parse((await t.run("show", "Soon", "--json")).stdout).state).toBe("done");

	expect((await t.run("create", "--name", "Bad", "--cron", "9 9 9")).stderr).toContain("five fields");
	expect((await t.run("delete", "Bad", "--yes")).code).toBe(1);
	expect((await t.run("delete", "Soon", "--yes")).stdout).toBe("Deleted Soon.\n");
});

// What an agent makes runs with no more than the agent may do: no scripts
// below Full access, approval capped, only its own thread to re-prompt,
// the user's left alone; a thread an automation started makes none.
test("what an agent may make", async (t) => {
	const mine = await t.thread("say Here.", { approval: "auto" });
	const other = await t.thread("say There.");
	await t.run("create", "--name", "Users", "--cron", "@daily", "--prompt", "say hi");

	const script = await t.runIn(mine, "create", "--name", "S", "--cron", "@daily", "--script", "rm -rf ~");
	expect(script.code).toBe(1);
	expect(script.stderr).toContain("only an agent at Full access");
	const target = await t.runIn(mine, "create", "--name", "T", "--cron", "@daily", "--prompt", "hi", "--target-thread", other.id);
	expect(target.stderr).toContain("its own thread, or one it started");
	expect((await t.runIn(mine, "pause", "Users")).stderr).toContain("the user's");

	const made = JSON.parse((await t.runIn(mine, "create", "--name", "Mine", "--cron", "@daily", "--prompt", "say From the automation.", "--approval", "all", "--json")).stdout);
	expect([made.origin, made.approval, made.creator]).toEqual(["agent", "auto", mine.id]);

	// Its run's thread can't make another.
	await t.runIn(mine, "run", "Mine");
	await t.until(async () => (await runsOf(t, "Mine"))[0]?.status === "ok");
	const child = (await runsOf(t, "Mine"))[0]!.thread!;
	expect((await t.runIn(child, "create", "--name", "Again", "--cron", "@daily", "--prompt", "hi")).stderr).toContain("A thread an automation started");
});

// The page: an empty one offers ideas; the list by how they stand, one
// opened beside it with its runs; an idea fills the form, which makes it;
// a thread an automation started says so above its composer.
test("the page", async (t) => {
	const w = await t.window();
	await w.click("Automations");
	await w.see("Ideas to start from");
	await w.screenshot("empty");

	await t.run("create", "--name", "Morning triage", "--cron", "30 9 * * 1-5", "--prompt", "say Triaged.");
	await t.run("create", "--name", "Health check", "--cron", "*/10 * * * *", "--interpreter", "bash", "--script", 'echo "up, 120ms"; echo "checked 3 endpoints"');
	await t.run("create", "--name", "Nightly", "--cron", "0 2 * * *", "--script", "echo nope >&2; exit 2");
	await t.run("run", "Health check");
	await t.run("run", "Health check");
	await t.run("run", "Nightly");
	await t.run("create", "--name", "Release notes", "--cron", "0 15 * * 5", "--prompt", "say Drafted.", "--paused");
	await t.run("run", "Morning triage");
	await w.see("Needs a look");
	await w.screenshot("list");

	await w.click("Health check");
	await w.see("Next run");
	await w.click("Done: up, 120ms");
	await w.see("checked 3 endpoints");
	await w.screenshot("detail");
	await w.dark(true);
	await w.screenshot("detail-dark");
	await w.dark(false);

	await w.click("Close");
	await w.click("New");
	await w.click("CI failure watch");
	await w.see("New automation");
	await w.see("Every hour on weekdays");
	await w.screenshot("form");
	await w.click("Make it");
	await w.see("Run now");
	expect((await t.run("show", "CI failure watch", "--json")).stdout).toContain('"worktree": true');

	const [run] = await runsOf(t, "Morning triage");
	await w.show(run!.thread!);
	await w.see("Started by");
	await w.screenshot("thread-row");

	// From a thread's menu: the form, set to re-prompt it.
	const info = (await t.call("Threads", {})).find((x) => x.id === run!.thread)!;
	await w.rightClick(info.title);
	await w.click("Automate this thread…");
	await w.see("A thread I have");
});
