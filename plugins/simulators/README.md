# Simulators

iOS simulators and Android emulators of the agents' own, one thread's each,
slim: Swarm's port of bb's Simulator plugin's agent pool, with simlock's
leases and simslim's and avdslim's slimming.

- **The pool** (`pool.ts`, pure and tested): a slot per simulator, a
  thread's from its first call until its turn ends (the `turnEnd` hook),
  it releases, or it sits unused 10 minutes while another waits. An action
  running holds it past the turn. Free, a slot is kept for the thread that
  had it; another thread gets it cleared. Sizes: `iosAgents`,
  `androidAgents`.
- **iOS** (`ios.ts`): `Swarm agent N · <model>` simulators in the default
  device set (so `xcodebuild -destination id=…` and `expo run:ios` find
  them), made with `simctl create`; screenshots with `simctl io`; apps and
  settings with `simctl`; touches and the screen's elements through
  WebDriverAgent, built once for the simulator on the Mac
  (`~/Library/Caches/swarm-simulators/wda`) and run per slot on port
  8300+N.
- **Android** (`android.ts`): `swarm_agent_N` AVDs in
  `~/.swarm-simulators/avd` (never the user's), written as their two files
  (no avdmanager, no Java), booted headless with the host's GPU, driven
  through adb. Swarm's window shows them live as it does any adb device.
  An emulator boots cold (a minute or two, more on a busy Mac): one
  restored from a snapshot on a Mac's GPU draws nothing. A call answers
  within 45 s, saying it's still booting, as an agent's client gives up
  on a tool after a minute; waiting in line too, its place kept.
- **Slimming**: `slimios.ts` writes launchd's `disabled.plist` for the
  device while it's shut down (simslim's categories; the device's other
  entries kept); `slimandroid.ts` tunes the AVD's config.ini and disables
  packages and settings in the guest, recording each original in
  `/data/local/tmp/swarm-slim-state` first, which `unslimScript` puts back.
  `swarm simulators slimming` lists the categories.
- **Agents**: `sim_status`, `sim_take`, `sim_release`, `sim_capture`,
  `sim_describe`, `sim_drive`, `sim_app`, `sim_device`, `sim_shell`,
  `sim_files`, `sim_forward`; `swarm simulators …` the same. Files go
  between the thread's computer and the simulators' through Swarm
  (`transfer.ts`, 8 MB chunks, checked by SHA-256); a forward is `adb
  reverse` (Android) onto a small forwarder on the simulators' computer
  to the thread's (`access.ts`). Test machines leaves the agents'
  emulators out, so only the thread holding one drives it.

**Live**: Swarm's window shows a slot's simulator live and takes its
touches (Watch live, `swarm://screen/<machine>?phone=<serial>` or
`?simulator=<UDID>`). An iOS simulator's comes from Swarm's core: the media
module's `SimulatorScreens` reads its framebuffer and sends it touches and
keys through SimulatorKit, no WebDriverAgent. Agents' own `sim_drive` and
`sim_describe` on iOS use WebDriverAgent, which plugins reach and which
reads the screen as elements.
