---
name: simulators
description: "Test an iOS or Android app on a simulator of your own: take one (made, slimmed and booted for you), build and install for its UDID or adb serial, look at it, tap and type, change its appearance, location, permissions or status bar, read app logs, and show the user screenshots. Use when a task needs an app run on an iOS simulator or Android emulator."
---

# Simulators

Each thread gets its own simulator from a pool the user sizes
(Settings, Plugins, Simulators): never the user's, never another
thread's. It's yours from your first sim_* call until your turn ends;
next turn you get the same one back as you left it, unless another
thread took it meanwhile (then it's cleared: apps quit, permissions and
overrides reset). When all are busy, a call waits in line (`wait`
minutes, default 4).

## The flow

1. `sim_take` (platform `ios` or `android`, with a `note` of what you
   test). It answers with the device's name, its UDID or adb serial, and
   the machine it runs on (a Mac for iOS). A cold boot can take a few
   minutes on a busy Mac: each call answers within a minute, saying it's
   still booting (or that you're #N in line, your place kept), and goes
   on meanwhile. Call again; don't end your turn, which gives it back.
2. Build and install there, for that device:
   - iOS: `xcodebuild … -destination id=UDID -derivedDataPath <yours>`,
     `npx expo run:ios --device UDID`, or `xcrun simctl install UDID App.app`.
     `sim_app install` takes an .app path on that Mac.
   - Android: `adb -s SERIAL install -r app.apk`, or
     `npx expo run:android --device SERIAL`.
   Your shell may be on another computer than the simulators: then build
   where they are, or copy the build there first.
   Your shell may be elsewhere than the simulators: `sim_app install`
   takes the build where you made it and copies it over.
   For a dev server (Metro, say), `sim_forward` with its port makes the
   device's localhost:PORT reach your computer's (to: host:port or
   another port); it stays across the emulator's reboots and goes when
   the device does.
3. `sim_app launch TARGET` (bundle id or package), or `openurl` a deep link.
4. `sim_describe` for the elements and where to tap; `sim_drive` with
   steps in screenshot pixels (`tap X Y`, `swipe X1 Y1 X2 Y2`,
   `type TEXT`, `key home`); `capture: true` for a screenshot after.
5. `sim_capture` with `show: true` to show the user what you saw: put the
   line it gives in your reply.
6. `sim_release` when done early; your turn ending gives it back anyway.

## Commands and files on it

- `sim_shell`: a command on your device. Android: its shell; `root: true`
  through su (sqlite3 on an app's database, pm, settings, logcat). Don't
  `adb root`: it restarts adbd and drops your forwards. iOS: on the Mac,
  in the simulator's data folder, `$UDID` and `$DATA` set (`xcrun simctl
  get_app_container $UDID BUNDLE data`, sqlite3).
- `sim_files`: `put` a file from your computer onto the device, `get` one
  back. Android: a device path (root outside /sdcard). iOS:
  `app:BUNDLE/Documents/…`, or a path in the simulator's data folder.
- Drive it with the plugin's tools, never adb or simctl through another
  tool (Test machines): that's another thread's way in.

## The device

`sim_device`: `appearance dark|light`, `text-size`, `location LAT,LON`
(or `clear`), `permission grant|revoke|reset SERVICE` with `app`,
`push` (JSON, iOS) with `app`, `status-bar clean|clear`; `reboot`,
`erase` (no apps, no data), `shutdown`, `measure` (its memory).
`sim_app logs TARGET` reads an app's recent logs.

## Slim

The agents' simulators run with services they rarely need turned off,
for a third of the memory: `swarm simulators slimming` lists what, by
category. If the app depends on one (push, iCloud, Maps, HealthKit,
Google's apps…), tell the user: they keep it on in the plugin's Keep
setting, and it applies as the simulator next boots. Don't work around
it.

## The command line

`swarm simulators status | take | release | describe | drive | app |
device | slimming` does the same from your shell, on your thread's
simulator; `--help` at each level.
