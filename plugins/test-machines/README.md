# Test machines

Shared test machines for Swarm's agents: Macs, Linux and Windows boxes
and phones that several threads use, one thread at a time on a machine's
screen. Agents get `machine_*` tools to look at a screen, click and type,
run commands, install and launch apps, copy files and power a machine on
and off. Each machine has a queue: a call that needs the screen waits in
line inside the call, and a thread's turn ends when its turn of the
conversation does. Plain commands, file copies and screenshots run beside
whoever holds the machine. Ported from bb's test-machines plugin.

The machines come from six drivers, each turned on in the settings:

- **desktop**: the computers joined to Swarm (Settings, Machines), and
  this one if you turn it on: their screens, input, apps, files, commands
  and recordings, with nothing to set up but what each system asks, run
  there through `swarm.process.run`'s `machine`:
  - macOS: `screencapture`, JavaScript for Automation (CoreGraphics'
    events for the pointer, System Events for keys, the app in front),
    and a small ScreenCaptureKit recorder compiled once with Xcode's
    command line tools. Swarm needs Accessibility and Screen Recording
    there (System Settings, Privacy & Security).
  - Windows: PowerShell and .NET, a short script an action (Defender
    blocks one that does all at once). Swarm's machine has to run in the
    signed-in desktop, not as a service; recording needs `ffmpeg`.
  - Linux: on GNOME (Wayland or X11), Mutter's remote desktop over D-Bus
    with GStreamer; elsewhere on X11, `xdotool` and ImageMagick. A
    headless GNOME's existing virtual monitor is used, never one of its
    own. Wayland doesn't say which app is in front, so sensitive apps
    aren't caught there; X11 does, through `xdotool`. A driver that can
    tell which app is in front and fails to counts it as a sensitive one.
- **bb**: the machines bb's own test-machines plugin has (a Mac, a Linux
  desktop, a Windows VM and the registered phones), through `bb
  test-machines`. In a bb thread they take bb's
  turn; elsewhere the plugin waits while bb's queue has the machine.
- **ssh**: machines you name as `id:kind:user@host`: commands and files
  on any of them, and a Mac's screenshots and input (`screencapture`,
  `cliclick`).
- **adb**: Android phones and emulators, plugged into this computer, a
  computer joined to Swarm, or one over ssh (*Where they're plugged in*):
  screenshots,
  taps and typing, apps, logs, and the screen on and off. A phone that
  `aapt2` (Android's build-tools, on the PATH there) can read a build for
  takes test builds even when it's one the user carries. A phone's screen
  goes off once the plugin's done with it, whoever turned it on: 60 s after
  its last action, or 10 s after its turn's let go, but never while you
  have it.
- **wda**: iPhones and iPads through WebDriverAgent (*iPhones*,
  `iphone:UDID`): screenshots, taps, swipes and typing in screenshot
  pixels, launching and stopping apps, which app is in front, and their
  elements. The plugin builds WebDriverAgent once on the Mac they're
  plugged into, signed with your Apple developer team (*Build
  WebDriverAgent* on the Settings page, or `swarm test-machines
  setup-iphone --team ID`), and starts it on a phone as it's first used,
  reaching it through the phone's own tunnel from that Mac. One you run
  yourself is `iphone:http://host:8100@UDID`. Installs and uninstalls
  go through `devicectl` on the Mac it's plugged into (*The Mac they're
  plugged into*: one joined to Swarm, which WebDriverAgent is asked from
  too, or over ssh; and `@UDID` after its address). iOS has
  no shell: no commands or files. While a phone sleeps, WebDriverAgent
  answers slowly (10–15 s a call). An iPhone nobody's used for a minute is
  rested as bb's test-machines does: the lock button, then the screen
  going dark is what counts; WebDriverAgent stops 10 min later unless it's
  used again, so "Automation Running" goes. The next action wakes it (Home,
  and the lock screen swiped away, where there's no passcode). On iOS 27.2
  the lock button leaves the screen on: status says so. A phone's screen
  isn't turned off for 20 min after you open its Live view, nor while an
  Android phone's live view shows it.
- **demo**: a screen in memory and this machine's shell, for trying the
  tools without a machine.

`machine_describe` reads a screen as named elements and the point to
click each: Android through `uiautomator`, iPhones through
WebDriverAgent's source, a Mac's window in front through its
accessibility (a small reader compiled once), Windows' through UI
Automation. Linux on Wayland doesn't say where its windows are, so it
isn't read there.

Above a thread's composer, a row says what the thread does on the
machines: *Using iPhone 17 · tap 603 2166*, *Holding*, *Waiting for* (its
place in line and who has it), or *Recording*, with how long, and a
button at its end that ends the thread's turn there or takes it out of
the line. Open, it shows each machine's latest screen, its live view
(or Watch, where it has none) and End turn.

*Test machines* on the window's rail is every machine at once, Phones
then Computers, each a tile shaped like its screen: its latest screen,
who has it (and what it's doing there) and who waits, the phones
plugged in and not used yet (each turned on from there), and a badge of
how many machines agents are on. The Machines panel groups them the same
way.

The Machines panel beside a thread shows who has each machine, who's
waiting, and a screenshot. *Live view* shows a computer or phone joined
to Swarm live, in Swarm's window (Swarm's remote screen), without taking
it: an agent on it keeps its turn. A machine with no live view (the demo,
over ssh, bb's) has *Watch* instead, a screenshot every few seconds for 5
minutes at most. An agent shows one in its reply as a Markdown
image: Swarm keeps the picture with the thread (`KeepMedia`), wherever
its agent runs, and it goes when the thread does. `machine_record` records a flow: bb's machines and Android
phones as a video (an iPhone, or a Mac over ssh, not yet), kept with the
thread and shown in the agent's reply the same way. A recording ends
with its thread's turn.

## What agents stay out of

The plugin holds these, rather than asking them in the agents'
instructions (`rules.ts`):

- **You come first.** *Use it myself* in the panel, or `swarm
  test-machines take MACHINE`, gives you a machine, still yours after the
  plugin restarts. The agent using it is cut off: what it runs there goes
  on to its end, but its call says the user took the machine, and an
  agent's recording there is thrown away. Until you give it back, input
  waits in line, and a look, a command or a copy beside you is refused.
  Agents can't take a machine for you, nor end another thread's turn.
  *Live view* shows a machine's screen without taking it: take it first
  (*Use it myself*) to use it as if at it, so an agent's clicks don't land
  among yours.
- **Sensitive apps.** Passwords, banking and payments, mail, messages,
  photos, health, the car, social posting and shopping, and any you add:
  launching or focusing one is refused, a step that lands in one is
  undone (the app hidden), and no screenshot is taken while one is in
  front. A driver that can tell which app is in front does this: the
  ssh driver on a Mac (System Events, which needs Accessibility for
  `sshd`), and the demo machine. bb's machines have bb's own rules.
- **Phones you carry.** On the phones named in *Phones you carry*, agents
  may only install and uninstall your test builds and read their logs: no
  screen, no input, no commands. An install needs a driver that can read
  a build's package id from its file; with the others, the user installs.

`AGENTS.md` is what the agents are told, and `skills/test-machines` the
skill they load.

## Grants

| Grant | For |
|---|---|
| See your threads | Thread titles for who holds what. |
| Add pictures to threads | Keeping a screenshot or recording with the thread whose agent took it, for its reply. |
| Programs: `sh`, `powershell`, `osascript`, `python3`, `bb`, `ssh`, `scp`, `adb`, `aapt2`, `curl` | The desktop driver's helpers (macOS, Windows, Linux) and copies, the bb, ssh and adb drivers (aapt2 reads a build's package id), WebDriverAgent's API (curl), and the demo machine's commands. |
| Run its programs on your machines | The desktop driver's helpers on the computers joined to Swarm. |
| Files: `~/.cache/test-machines` | The screenshots and recordings bb saves, which the plugin reads. |
| Tools, skills, instructions | The `machine_*` tools, the skill and `AGENTS.md` for the agents. |
| Hook: turn end | Ending a thread's turns on the machines as its turn of the conversation ends. |

## Settings

Its own page of Settings, under Plugins (also from the gear in the
Machines panel): the machines it found; Phones, those plugged into this
computer or one joined to Swarm (through adb and devicectl there), each
turned on with *Use for testing* or *It's my phone*, and an iPhone's
WebDriverAgent built with one button, signed for the team of the Mac's
Apple Development certificate; then Computers (Swarm's
machines, this computer, over ssh),
Android and iPhone by hand (adb's host and the phones' names,
WebDriverAgent's addresses and the Mac, for what Phones doesn't find:
ssh, wireless, a WebDriverAgent you run), Other machines (bb's,
the demo machine), and What agents stay out of (phones you carry, your
test builds, more apps).

## Commands

`swarm test-machines …`, from an agent's shell in its thread's turn, or
from your terminal at once (you wait in no line):

| Command | Does |
|---|---|
| `status [MACHINE] [--live] [--json]` | Who has each machine, who waits, how to drive it. |
| `take MACHINE [--note]` | An agent: wait for its turn and hold it. You: take the machine for yourself, cutting off the agent on it. |
| `give-back MACHINE` | Yours: give a machine you took back to the agents. |
| `release [MACHINE]` | An agent: give its machines back. You: end whichever turn holds it. |
| `run MACHINE [--exclusive] [--background] [--timeout] -- COMMAND` | A command; its output and exit code are the command's. |
| `job [ID] [--wait 5m]` | A background command's state, or waiting for it. |
| `capture MACHINE` | A screenshot kept with the thread: its file, and the line that shows it. |
| `describe MACHINE` | The screen as named elements and the point to click each. |
| `drive MACHINE -- STEP…` | Input, in the machine's own steps. |
| `app MACHINE ACTION TARGET` | Launch, focus, kill, install, uninstall, logs. |
| `put MACHINE LOCAL… REMOTE`, `get MACHINE REMOTE LOCAL` | Files. An agent's local paths are its thread's folder's, nowhere else. |
| `power MACHINE ACTION` | Power, or a phone's screen. |
| `record MACHINE start\|stop [--title]` | A recording, kept with the thread. |
| `adb PHONE -- ARGS` | adb on an Android phone, in the turn, held to the apps agents may use: that phone's commands alone (shell, install, push, pull, logcat…), no `-s`. |
| `connect HOST:PORT [--pair HOST:PORT --code CODE]` | An Android phone over wireless debugging, paired first where given. |
| `doctor [--json]` | Everything the turned-on machines need, checked (also *Check everything* on the Settings page). |
| `discover [--json]` | The phones plugged into this computer and those joined to Swarm, used or not (status names the unused ones too). |
| `use PHONE [--carried]` | Yours: turn on a phone discover found. |
| `stop-using PHONE` | Yours: stop testing on a phone. |
| `setup-iphone [--team ID]` | Yours: build WebDriverAgent on the Mac the iPhones are plugged into, for the team of its certificate when none is given. |
| `carry PHONE [--off]` | Yours: the phone you carry. |
| `test-apps [ID…] [--clear]` | Your test builds (anyone lists them; you set them). |
| `offlimits [APP…] [--clear]` | Apps agents stay out of, besides the built-in kinds. |

Swarm tells your terminal from an agent's shell (`io.user`): what's
yours is refused to an agent. Agents' own `adb` isn't routed through
the line, as Swarm's agents' PATH can't be changed by a plugin; their
instructions send them to `swarm test-machines adb`.

## Test it

```
swarm plugin test examples/plugins/test-machines
```

The tests use the demo machine: the status, a command and a screenshot
the demo agent's tool call gets, two threads taking turns on the screen,
the user taking a machine, sensitive apps and carried phones, a
recording, the command line from an agent's shell and the user's
terminal, and the Machines panel. `test-machines.fake.test.ts` runs the
plugin with no Swarm behind it.
