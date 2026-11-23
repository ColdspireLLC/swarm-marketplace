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

Past taps and screenshots, `sim_shell` runs commands on it (root on
Android through su, which keeps your forwards, unlike `adb root`),
`sim_files` copies files between your own computer and it, `sim_app
install` takes a build on your own computer, and `sim_forward` makes its
localhost reach your dev server (Metro) wherever the simulators run: no
copying by hand, no forwarders of your own, no adb from another tool on
it.

`sim_drive` taps an element by its name too (`tap "Sign in"`), and has
doubletap, scroll, rotate and long presses. To show the user what you
did, `sim_capture show` a screenshot or `sim_record` a clip (a title
first, then stop), and put the line it gives in your reply; `keep` saves
it to the user's captures, only when they ask.

The user's own simulators are theirs. When the task needs one (a bug that
only shows signed in, "look at what I have open"), `sim_device borrow`
with why asks them; once they lend it, your calls use it, with their
apps and data: never sign in or out of their accounts or delete their
data, and you can't shut it down or erase it. When they take over a
simulator, your calls on it wait until they hand it back.

Look before you act on a screen you haven't seen this turn (`sim_describe`
for where to tap, `sim_capture` to see it). The simulators are slim:
services they rarely need are off (on iOS Siri, Spotlight, widgets,
photo analysis…; on Android, Google's apps, sync and background
processes). When the app needs one of those, say so to the user rather
than turning it on yourself. Never touch the user's own simulators,
nor another thread's agent simulator.
