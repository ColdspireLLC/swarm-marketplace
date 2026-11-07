---
name: automations
description: Schedule work in Swarm to run later or on a repeat, with `swarm automations`: an agent given a prompt (a new thread each run, or this thread re-prompted), or a script run on Swarm's computer, on a cron or once. Use when asked to do something every morning, every hour, at a time, in two hours, or to watch something and report.
---

# Automations

An automation is a scheduled task. When it comes due it runs in one of two
modes:

- **agent**: starts a thread with its prompt each run (in a worktree of its
  own with `--worktree`), or tells an existing thread (`--target-thread`).
  The run ends as that thread's turn ends.
- **script**: runs a script on Swarm's computer (sh, bash, node or
  python3), in its project's folder, and keeps its exit code and output.
  With `--prompt` as well, whatever the script prints is handed to an agent
  with that prompt, so the agent only wakes when there's something to see.

Pick **script** when code alone decides: health checks, watchdogs,
thresholds, pollers. Make it print nothing when all is well: a run that
exits 0 printing nothing, or whose last line is `{"wakeAgent": false}`, is a
quiet run, kept as skipped. A non-zero exit or a timeout is a failed run.
Pick **agent** when the run needs judgment: triage, summaries, drafting.

## Make one

```bash
swarm automations create --name "Morning triage" --cron "0 9 * * 1-5" \
  --prompt "Triage yesterday's new issues and summarise what needs me."

swarm automations create --name "Check the deploy" --in 30m \
  --prompt "Check the deploy finished and the site answers." --target-thread "$SWARM_THREAD"

swarm automations create --name "Site down?" --cron "*/10 * * * *" \
  --script 'curl -fsS https://example.com/health >/dev/null || echo "health check failed"' \
  --prompt "The health check failed: find out why and tell me."
```

- Schedule: `--cron` (five fields in this computer's local time, or
  `@daily`, `@hourly`), or once with `--at 2026-11-08T09:00` or `--in 2h`.
- Agent: `--provider`, `--model`, `--effort`, `--approval ask|edits|auto|all`,
  `--worktree [--branch B]`.
- Script: `--script "$(cat check.sh)"`, `--interpreter`, `--timeout 5m`
  (10m at most), `--cwd /abs/folder`. It gets `SWARM_AUTOMATION_ID`,
  `SWARM_AUTOMATION_RUN` and `SWARM_PROJECT`.
- From a thread, the project is the thread's; elsewhere say `--project`.

## What an agent may make

An automation runs with nobody watching, so one an agent makes does no more
than the agent may itself:

- its runs' threads get no more approval than this thread has;
- a script runs without asking anyone, so only an agent at Full access may
  make, change or run one;
- `--target-thread` is this thread, or one this thread started;
- the user's own automations are theirs: read them, don't change them;
- a thread an automation started makes none, nor does a thread while an
  automation's turn runs in it.

When one of these refuses you, tell the user what you wanted to schedule:
they can make it in Automations, in the sidebar.

## Look after them

```bash
swarm automations list [--project P] [--target-thread T]
swarm automations show NAME_OR_ID
swarm automations runs NAME_OR_ID [--limit N] [--output RUN]
swarm automations run NAME_OR_ID          # now, its schedule as it was
swarm automations update NAME_OR_ID --cron "0 8 * * *"   # only what's given changes
swarm automations pause|resume NAME_OR_ID
swarm automations delete NAME_OR_ID --yes
```

Every command takes `--json`. One run of an automation at a time: one that
comes due while the last still runs is kept as skipped. A failed scheduled
run of a repeating automation is tried again after 30 seconds and a minute,
never past its next time; failing doesn't pause it. A run missed while Swarm
was closed runs once as it starts.
