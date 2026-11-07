# Automations

Scheduled work, after bb's Automations plugin: an agent given a prompt, or
a script run here, on a cron or once.

- **Schedules** (`cron.ts`, `plan.ts`, pure and tested): five-field crons
  in local time, as Swarm's own `schedule` reads them, or a one-shot time.
  The minute's `schedule("tick")` starts what's due, and a timer between
  ticks (`arm`) runs anything due within the minute on its second. A run
  missed while Swarm was closed runs once as it starts. Failed scheduled
  runs of a cron are retried after 30 s and 60 s, never past its next
  time; failing never pauses one.
- **Runs** (`runner.ts`): one at a time per automation (one that comes due
  while the last runs is kept as skipped). Agent mode spawns a thread
  (`threads.spawn`, marked with the automation's id in its metadata) or
  `Tell`s the target thread; the run ends on that thread's `turnEnd`. A
  target that's gone pauses every automation that tells it. Script mode
  runs `sh|bash|node|python3 -c|-e SCRIPT` in the project's folder (10 min
  at most, `process.run`'s limit); printing nothing, or a last line of
  `{"wakeAgent": false}`, is a quiet (skipped) run, and with a prompt, what
  it printed goes to an agent the same way. As the plugin starts, runs a
  restart cut off are settled from their threads.
- **Who may make what** (`edit.ts`): an agent's automation runs unwatched,
  so it gets no more than the agent: approval capped at its thread's (an
  Auto across agents gives Auto-accept edits, as core's ChildApproval
  does), a script only from an agent at Full access, a target only its own
  thread or one it started, the user's automations read-only to it. A
  thread an automation started, or one running an automation's turn,
  makes none. A command line Swarm can't vouch for counts as an agent of
  the least access.
- **Kept** (`store.ts`): the plugin's SQLite database, an automation per
  row as JSON, its last 50 runs (each stream's output cut at 64 KB),
  mirrored in tracked stores the page reads.
- **Agents**: `swarm automations …` (`cli.ts`) and the `automations`
  skill.
- **Window**: the Automations page (`page.tsx`), laid out as Pull
  requests is: the list (grouped Needs a look, Active, Paused, Done, each
  row a strip of its latest runs and its switch) in one island, the
  automation opened or its form (`form.tsx`) beside it. Ideas to start
  from (`ideas.ts`) fill the form, or ask an agent in a new thread to set
  one up. Above a thread's composer, the automation that started or
  re-prompts it, and "Automate this thread…" in its menu (`thread.tsx`).
  What the views share is `parts.tsx`.

Not ported from bb: timezones other than this computer's, scripts from a
file on another host, and per-run environment variables beyond
`SWARM_AUTOMATION_ID`, `SWARM_AUTOMATION_RUN` and `SWARM_PROJECT`.
