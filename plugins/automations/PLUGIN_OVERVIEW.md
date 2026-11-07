Schedule work once or on a repeat, and let Swarm run it while you do something else. An automation either gives an agent a prompt or runs a script on this computer.

An Automations page in the sidebar lists them: make, edit, pause, resume and run them there, and see each one's runs, the thread each started and what each script printed.

Two schedules: a cron in this computer's time (weekdays at 9:30, every 10 minutes) for repeating work, or a time, or a delay such as 2h, for once.

Agent mode starts a thread with the prompt each run, with the agent, model, effort and permission mode you pick, in a worktree of its own if you like; or it re-prompts a thread you already have. The run ends as the agent's turn does.

Script mode runs a sh, bash, node or python3 script in its project's folder and keeps its exit code and output. A script that prints nothing is a quiet run. Give it a prompt too and whatever it prints goes to an agent, so a watchdog only wakes one when something's wrong.

Failed runs of a repeating automation are tried again after 30 seconds and a minute; failing never pauses it. One run of an automation at a time.

Agents get the automations skill and the swarm automations command: create, list, show, update, pause, resume, run, runs and delete, each with --json. What an agent makes does no more than the agent may: its runs' threads get no more access than the agent's thread, only an agent at Full access may make a script, it re-prompts only its own thread or ones it started, and it leaves your automations alone. Threads an automation started can't make automations.
