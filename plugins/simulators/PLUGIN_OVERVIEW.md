Gives each agent an iOS simulator or Android emulator of its own, slim, so that several run at once on one Mac.

A thread gets a simulator the first time it needs one: a fresh device of the plugin's, with none of your apps or data, made, slimmed and booted for it. It keeps it until its turn ends, and gets it back as it left it next turn unless another thread took it meanwhile. Then it's cleared first: apps quit, permissions and overrides reset. When all are busy, the next thread waits in line. A simulator unused for 10 minutes shuts down.

Slim: on iOS, launchd services agents rarely need (Siri, Spotlight, widgets, photo analysis, iCloud sync and more) are turned off before the device boots, after simslim. On Android, the AVD is tuned for less memory and Google's apps, sync and background processes are disabled, after avdslim, with everything recorded so it can be undone. Your own simulators are never touched. Keep settings leave chosen categories on.

Agents get tools: take, release, capture, describe the screen as elements, drive it with taps, swipes, keys and text, manage apps (install, launch, deep links, logs), and change the device (appearance, text size, location, permissions, push, status bar, erase). The same actions are on the command line as swarm simulators.

A side panel and a row above the composer show which simulator a thread holds. Swarm's window shows an Android emulator live.

Needs a Mac joined to Swarm for iOS (Xcode), and the Android SDK with an emulator and a system image for Android.
