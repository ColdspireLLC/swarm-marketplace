# Simulators

The sim_* tools, and `swarm simulators …` in your shell, give you an iOS
simulator or Android emulator of your own: a fresh one of the plugin's,
none of the user's apps or data, yours alone until your turn of the
conversation ends. `sim_take` first when you build for it: it says the
UDID (iOS) or adb serial (Android) and the machine it runs on. Build with
a derived-data or build folder of your thread's own, and install the app
you test: it isn't there. A call that says the simulator is still booting,
or that you're in line, answers within a minute while it goes on: call again
(a cold boot takes a few minutes on a busy Mac). Ending your turn gives it
back.

Look before you act on a screen you haven't seen this turn (`sim_describe`
for where to tap, `sim_capture` to see it). The simulators are slim:
services they rarely need are off (on iOS Siri, Spotlight, widgets,
photo analysis…; on Android, Google's apps, sync and background
processes). When the app needs one of those, say so to the user rather
than turning it on yourself. Never touch the user's own simulators,
nor another thread's agent simulator.
