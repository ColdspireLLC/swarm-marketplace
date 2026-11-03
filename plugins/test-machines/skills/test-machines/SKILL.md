---
name: test-machines
description: Use Swarm's shared test machines and phones (computers over ssh, Android phones through adb, iPhones through WebDriverAgent, bb's machines), one thread at a time on each screen, through the machine_* tools or `swarm test-machines` in the shell. Use when a task needs a screenshot, input, a command, an app, a recording or a file on one of them.
---

# Test machines

## Tools

- `machine_status` lists the machines, who has each, who waits, and the
  input steps each takes. It never waits.
- `machine_capture` looks at a screen (no turn needed); `show: true` gives a
  Markdown image line (`![Screenshot of …](path)`) to put in your reply,
  on a line of its own, which shows it to the user.
- `machine_describe` reads a screen as named elements (buttons, fields,
  links, rows) and the point to click each: cheaper and surer than a
  screenshot for finding where to click. Android, iPhones, a Mac's and
  Windows' window in front (not Linux on Wayland).
- `machine_drive` clicks and types in screenshot pixels, in the machine's
  own steps; `capture: true` looks after.
- `machine_run` runs a command (on Android, `adb shell`); `exclusive: true`
  for the app under test or anything on the screen. Long ones go on as
  jobs: `machine_job`.
- `machine_app` launches, focuses or kills (only what you launched) an
  app, installs or uninstalls a test build, or reads a phone app's logs.
- `machine_files` copies files; `machine_power` a machine's power or a
  phone's screen.
- `machine_record` start, the steps, then stop, all in one turn: the stop
  gives a `![title](path)` line that plays the video in your reply. Only
  for what a still can't show; a recording ends with your turn.
- `machine_take` holds a machine for a sequence of steps; `machine_release`
  gives it back early. Your turn ending gives it back.

Phones' steps: `tap X Y`, `long X Y [MS]`, `swipe X1 Y1 X2 Y2 [MS]`,
`type TEXT`, `key home|back|enter…`, `wait MS`, in screenshot pixels.
iPhones run no commands.

## The shell

`swarm test-machines` does the same from your shell, for builds and
scripts, in your thread's turn: `status [--json]`, `take`, `release`,
`run MACHINE [--exclusive] [--background] -- COMMAND` (its exit code is the
command's), `job ID --wait 5m`, `capture` (prints the screenshot's file),
`describe`, `doctor`,
`drive MACHINE -- STEP…`, `app`, `put`, `get`, `power`, `record`, and
`adb PHONE -- ARGS` for an Android phone: never adb itself, which skips
your turn and the apps you may use.

## The user's rules

A call that waited its time says so and keeps your place: call again.
The user comes first: a machine they take (the Machines panel, `swarm
test-machines take` in their terminal) is theirs until they give it
back. A call that says the user took it: stop, and tell them what you
were doing.

Sensitive apps (passwords, banking and payments, mail, messages, photos,
health, the car, social posting, shopping, and those the user adds) are
refused, and a step that lands in one is undone: ask the user for that
part. `machine_status` says which phones the user carries: there, only
their test builds' installs, uninstalls and logs.
