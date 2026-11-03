// The desktop driver's helpers, one a system, run there for each action
// (desktop.ts): given {action, arg} as JSON, each prints one line of JSON,
// {…} or {error}. Screenshots are JPEG, at the screen's own pixels, which
// the steps' coordinates are in.

/** macOS: JavaScript for Automation, run(argv) with the payload. */
export const MAC_JXA = String.raw`
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
ObjC.import('ApplicationServices');
var app = Application.currentApplication();
app.includeStandardAdditions = true;
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function sh(cmd) { return app.doShellScript(cmd); }
function tmp(name) { return $.NSTemporaryDirectory().js + name; }
var REC = tmp('swarm-test-machines.mp4');
var RECORDER = tmp('swarm-test-machines-recorder-2');  // compiled() names it so
function scale() { return $.NSScreen.mainScreen.backingScaleFactor; }
function b64(path, offset, length) {
	var h = $.NSFileHandle.fileHandleForReadingAtPath(path);
	if (!h || h.isNil()) throw new Error('no file ' + path);
	if (offset) h.seekToFileOffset(offset);
	var d = length ? h.readDataOfLength(length) : h.readDataToEndOfFile;
	h.closeFile;
	return d.base64EncodedStringWithOptions(0).js;
}
function sizeOf(path) {
	var a = $.NSFileManager.defaultManager.attributesOfItemAtPathError(path, null);
	// A folder has no size here, as on Linux and Windows: put copies into it.
	return a.isNil() || a.fileType.js === 'NSFileTypeDirectory' ? 0 : a.fileSize;
}
function mouse(type, x, y, button, clicks) {
	var e = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), button);
	if (clicks) $.CGEventSetIntegerValueField(e, 1, clicks);
	$.CGEventPost(0, e);
}
var KEYS = { enter: 36, 'return': 36, tab: 48, space: 49, backspace: 51, 'delete': 51, forwarddelete: 117, esc: 53, escape: 53,
	left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
	f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111 };
var MODS = { cmd: 'command down', command: 'command down', ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', shift: 'shift down', fn: 'function down' };
function key(chord) {
	var se = Application('System Events');
	var parts = chord.toLowerCase().split('+');
	var k = parts.pop();
	var using = [];
	parts.forEach(function (m) { if (!MODS[m]) throw new Error('no modifier ' + m + ': cmd, ctrl, alt, shift'); using.push(MODS[m]); });
	if (KEYS[k] !== undefined) se.keyCode(KEYS[k], { using: using });
	else if (k.length === 1) se.keystroke(k, { using: using });
	else throw new Error('no key ' + k + ': a letter, enter, tab, esc, space, backspace, up, down, left, right, home, end, pageup, pagedown, f1…f12');
}
function drive(steps) {
	var s = scale();
	var done = [];
	steps.forEach(function (step) {
		var m = /^(\w+)\s*(.*)$/.exec(step.trim());
		if (!m) throw new Error('no step ' + step);
		var op = m[1], rest = m[2], n = rest.split(/\s+/).map(Number);
		var need = function (c) { for (var i = 0; i < c; i++) if (!isFinite(n[i])) throw new Error(op + ' takes ' + c + ' numbers: ' + step); };
		var x = n[0] / s, y = n[1] / s;
		switch (op) {
			case 'click': need(2); mouse(5, x, y, 0); mouse(1, x, y, 0, 1); mouse(2, x, y, 0, 1); break;
			case 'dclick': need(2); mouse(5, x, y, 0); mouse(1, x, y, 0, 1); mouse(2, x, y, 0, 1); mouse(1, x, y, 0, 2); mouse(2, x, y, 0, 2); break;
			case 'rclick': need(2); mouse(5, x, y, 0); mouse(3, x, y, 1, 1); mouse(4, x, y, 1, 1); break;
			case 'move': need(2); mouse(5, x, y, 0); break;
			case 'drag':
				need(4);
				var x2 = n[2] / s, y2 = n[3] / s;
				mouse(5, x, y, 0); mouse(1, x, y, 0, 1);
				for (var i = 1; i <= 12; i++) { mouse(6, x + (x2 - x) * i / 12, y + (y2 - y) * i / 12, 0); delay(0.015); }
				mouse(2, x2, y2, 0, 1);
				break;
			case 'scroll': need(1); $.CGEventPost(0, $.CGEventCreateScrollWheelEvent2(null, 1, 1, -Math.round(n[0]), 0, 0)); break;
			case 'type': Application('System Events').keystroke(rest); break;
			case 'key': key(rest); break;
			case 'wait': delay(Math.min(Math.max(n[0] || 0, 0), 10000) / 1000); break;
			default: throw new Error('no step ' + op);
		}
		done.push(step);
		delay(0.05);
	});
	return { said: 'did ' + done.length + ' step(s)' };
}
// A Swift program of the plugin's, compiled once with Xcode's command line tools, at its version's name.
function compiled(name, source) {
	var bin = tmp(name);
	if (!$.NSFileManager.defaultManager.fileExistsAtPath(bin)) {
		var src = bin + '.swift';
		$(source).writeToFileAtomicallyEncodingError(src, true, 4, null);
		try { sh('xcrun swiftc -O -o ' + q(bin) + ' ' + q(src)); } catch (e) { throw new Error("this needs Xcode's command line tools on the Mac (xcode-select --install): " + e.message); }
	}
	return bin;
}
// The window in front's elements, through its accessibility (Swarm's Accessibility): JXA can't take
// the accessibility API's out parameters, so a program of its own reads them.
function describe(source) {
	if (!$.AXIsProcessTrusted()) throw new Error('Swarm has no Accessibility on this Mac, so it reads no screen: the user turns it on in System Settings, Privacy & Security, Accessibility.');
	return JSON.parse(sh(q(compiled('swarm-test-machines-ax-1', source))));
}
function front() {
	var a = $.NSWorkspace.sharedWorkspace.frontmostApplication;
	if (!a || a.isNil()) return {};
	return { id: a.bundleIdentifier.isNil() ? '' : a.bundleIdentifier.js, name: a.localizedName.isNil() ? '' : a.localizedName.js };
}
function act(action, arg) {
	switch (action) {
		case 'status':
			var f = $.NSScreen.mainScreen.frame, s = scale();
			var ax = $.AXIsProcessTrusted();
			return { summary: 'macOS ' + $.NSProcessInfo.processInfo.operatingSystemVersionString.js + ', ' + Math.round(f.size.width * s) + 'x' + Math.round(f.size.height * s) + (ax ? '' : ', no Accessibility for input'), accessibility: !!ax };
		case 'capture':
			var p = tmp('swarm-shot-' + Date.now() + '.jpg');
			sh('screencapture -x -m -t jpg ' + q(p));
			var png = b64(p);
			$.NSFileManager.defaultManager.removeItemAtPathError(p, null);
			return { png: png };
		case 'drive':
			if (!$.AXIsProcessTrusted()) throw new Error('Swarm has no Accessibility on this Mac, so input does nothing: the user turns it on in System Settings, Privacy & Security, Accessibility.');
			return drive(arg);
		case 'front': return front();
		case 'describe': return describe(arg.swift);
		case 'pointer':
			var l = $.CGEventGetLocation($.CGEventCreate(null)), sc = scale();
			return { x: Math.round(l.x * sc), y: Math.round(l.y * sc) };
		case 'leave':
			var a = $.NSWorkspace.sharedWorkspace.frontmostApplication;
			if (a && !a.isNil()) a.hide;
			return { said: 'hidden' };
		case 'launch':
		case 'focus':
			var t = arg.app, args = (arg.args || []).map(q).join(' ');
			var byId = /^[\w-]+(\.[\w-]+)+$/.test(t);
			// The process it starts, for kill: none where the app was open already (the user's).
			var running = function () {
				var all = $.NSWorkspace.sharedWorkspace.runningApplications, n = all.count;
				for (var i = 0; i < n; i++) {
					var a = all.objectAtIndex(i);
					if ((byId && !a.bundleIdentifier.isNil() && a.bundleIdentifier.js === t) || (!byId && !a.localizedName.isNil() && a.localizedName.js === t)) return a.processIdentifier;
				}
				return 0;
			};
			var before = running();
			sh((byId ? 'open -b ' : 'open -a ') + q(t) + (args && action === 'launch' ? ' --args ' + args : ''));
			var pid = 0;
			for (var w = 0; w < 50 && !before && !(pid = running()); w++) delay(0.1);
			return { said: (action === 'launch' ? 'Launched ' : 'Brought forward ') + t + (before && action === 'launch' ? ' (it was open already: the user\'s, which kill leaves alone).' : '.'), pid: before ? 0 : pid };
		case 'kill':
			var app = arg.pid ? $.NSRunningApplication.runningApplicationWithProcessIdentifier(arg.pid) : null;
			if (!app || app.isNil()) return { said: arg.app + ' had already quit.' };
			app.terminate;
			return { said: 'Stopped ' + arg.app + '.' };
		case 'recordStart':
			// ScreenCaptureKit's recording, a program of its own compiled once
			// (screencapture -v stops only for a key typed at a terminal).
			compiled('swarm-test-machines-recorder-2', arg.swift);
			sh('rm -f ' + q(REC) + ' ' + q(REC + '.log') + '; nohup ' + q(RECORDER) + ' ' + q(REC) + ' ' + Math.round(arg.seconds) + ' > ' + q(REC + '.log') + ' 2>&1 & echo $! > ' + q(REC + '.pid'));
			for (var i = 0; i < 100; i++) {
				var log = sh('cat ' + q(REC + '.log') + ' 2>/dev/null || true');
				if (/^recording/m.test(log)) return { said: 'recording' };
				if (/error/i.test(log)) throw new Error(log.trim());
				delay(0.1);
			}
			throw new Error("the recording didn't start: " + sh('cat ' + q(REC + '.log') + ' 2>/dev/null || true'));
		case 'recordStop':
			sh('kill -INT $(cat ' + q(REC + '.pid') + ') 2>/dev/null || true');
			for (var j = 0; j < 150; j++) {
				if (sh('kill -0 $(cat ' + q(REC + '.pid') + ') 2>/dev/null && echo on || true') === '') break;
				delay(0.1);
			}
			sh('rm -f ' + q(REC + '.pid') + ' ' + q(REC + '.log'));
			return { path: REC, size: sizeOf(REC), ext: 'mp4' };
		case 'read': return { data: b64(arg.path, arg.offset, arg.length) };
		case 'size': return { size: sizeOf(arg.path), exists: $.NSFileManager.defaultManager.fileExistsAtPath(arg.path) };
		case 'write':
			// A piece of a file, base64 on the input: appended, or the file begun.
			var piece = $.NSData.alloc.initWithBase64EncodedStringOptions($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile, 4), 1);
			if (!arg.append) {
				$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(arg.path).stringByDeletingLastPathComponent, true, $(), null);
				$.NSFileManager.defaultManager.createFileAtPathContentsAttributes(arg.path, $.NSData.data, $());
			}
			var w = $.NSFileHandle.fileHandleForWritingAtPath(arg.path);
			if (!w || w.isNil()) throw new Error("can't write " + arg.path);
			w.seekToEndOfFile; w.writeData(piece); w.closeFile;
			return { size: sizeOf(arg.path) };
		case 'remove': $.NSFileManager.defaultManager.removeItemAtPathError(arg.path, null); return {};
	}
	throw new Error('no action ' + action);
}
function run(argv) {
	try {
		var p = JSON.parse(argv[0]);
		return JSON.stringify(act(p.action, p.arg));
	} catch (e) {
		return JSON.stringify({ error: String(e && e.message ? e.message : e) });
	}
}
`;

/**
 * macOS's recorder: ScreenCaptureKit's recording of the main display to
 * an H.264 MP4, at most 1920 wide, until SIGINT or its time is up.
 */
export const MAC_RECORDER = String.raw`
import AppKit
import ScreenCaptureKit
import CoreMedia

let args = CommandLine.arguments
let out = URL(fileURLWithPath: args[1])
let seconds = Double(args.count > 2 ? args[2] : "120") ?? 120
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)

final class Done: NSObject, SCRecordingOutputDelegate {
	func recordingOutputDidFinishRecording(_ o: SCRecordingOutput) { exit(0) }
	func recordingOutput(_ o: SCRecordingOutput, didFailWithError e: Error) {
		print("error: \(e.localizedDescription)"); fflush(stdout); exit(1)
	}
}
let done = Done()
var sources: [DispatchSourceSignal] = []

// An app of no Dock icon: ScreenCaptureKit shows its indicator from the main thread.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
Task { @MainActor in
	do {
		let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
		guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else {
			print("error: no display"); exit(1)
		}
		let cfg = SCStreamConfiguration()
		var w = CGDisplayPixelsWide(display.displayID), h = CGDisplayPixelsHigh(display.displayID)
		if w > 1920 { h = h * 1920 / w; w = 1920 }
		cfg.width = w & ~1
		cfg.height = h & ~1
		cfg.minimumFrameInterval = CMTime(value: 1, timescale: 30)
		cfg.showsCursor = true
		let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: cfg, delegate: nil)
		let rc = SCRecordingOutputConfiguration()
		rc.outputURL = out
		rc.outputFileType = .mp4
		rc.videoCodecType = .h264
		try stream.addRecordingOutput(SCRecordingOutput(configuration: rc, delegate: done))
		try await stream.startCapture()
		print("recording"); fflush(stdout)
		let stop = {
			Task { try? await stream.stopCapture() }
			DispatchQueue.main.asyncAfter(deadline: .now() + 15) { exit(0) }
		}
		for s in [SIGINT, SIGTERM] {
			let src = DispatchSource.makeSignalSource(signal: s, queue: .main)
			src.setEventHandler(handler: stop)
			src.resume()
			sources.append(src)
		}
		DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: stop)
	} catch {
		print("error: \(error.localizedDescription)"); fflush(stdout); exit(1)
	}
}
app.run()
`;

/**
 * macOS's accessibility reader: the window in front's elements (and the
 * menu bar's), named, at screenshot pixels, as JSON.
 */
export const MAC_AX = String.raw`
import AppKit
import ApplicationServices

let scale = Double(NSScreen.main?.backingScaleFactor ?? 1)
func get(_ e: AXUIElement, _ a: String) -> AnyObject? {
	var v: AnyObject?
	return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil
}
func text(_ v: AnyObject?) -> String { ((v as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
let actions = ["Button", "Link", "MenuItem", "MenuBarItem", "CheckBox", "RadioButton", "PopUpButton", "MenuButton", "TextField", "TextArea", "ComboBox", "Cell", "Tab", "Slider", "Incrementor", "DisclosureTriangle", "SearchField"]
var out: [[String: Any]] = []
var seen = 0
func walk(_ e: AXUIElement, _ depth: Int, _ maxDepth: Int) {
	if out.count >= 300 || depth > maxDepth || seen > 6000 { return }
	seen += 1
	let role = text(get(e, kAXRoleAttribute)).replacingOccurrences(of: "AX", with: "")
	var label = text(get(e, kAXTitleAttribute))
	if label.isEmpty { label = text(get(e, kAXDescriptionAttribute)) }
	if label.isEmpty { label = text(get(e, kAXValueAttribute)) }
	if label.isEmpty { label = text(get(e, kAXPlaceholderValueAttribute)) }
	var p = CGPoint.zero, s = CGSize.zero
	if let v = get(e, kAXPositionAttribute), CFGetTypeID(v) == AXValueGetTypeID() { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
	if let v = get(e, kAXSizeAttribute), CFGetTypeID(v) == AXValueGetTypeID() { AXValueGetValue(v as! AXValue, .cgSize, &s) }
	if !label.isEmpty && s.width > 0 && s.height > 0 {
		out.append(["role": role.lowercased(), "label": String(label.prefix(200)), "x": Double(p.x) * scale, "y": Double(p.y) * scale, "w": Double(s.width) * scale, "h": Double(s.height) * scale, "action": actions.contains { role.contains($0) }])
	}
	if let kids = get(e, kAXChildrenAttribute) as? [AXUIElement] {
		for k in kids { walk(k, depth + 1, maxDepth) }
	}
}
var name = ""
// The app in front, or one named by its bundle id.
let target = CommandLine.arguments.count > 1 ? NSRunningApplication.runningApplications(withBundleIdentifier: CommandLine.arguments[1]).first : NSWorkspace.shared.frontmostApplication
if let front = target {
	name = front.localizedName ?? ""
	let app = AXUIElementCreateApplication(front.processIdentifier)
	if let w = get(app, kAXFocusedWindowAttribute) ?? get(app, kAXMainWindowAttribute) ?? (get(app, kAXWindowsAttribute) as? [AXUIElement])?.first { walk(w as AnyObject as! AXUIElement, 0, 30) }
	if let bar = get(app, kAXMenuBarAttribute) { walk(bar as! AXUIElement, 0, 1) }
}
let data = try! JSONSerialization.data(withJSONObject: ["app": name, "elements": out])
print(String(data: data, encoding: .utf8)!)
`;

/**
 * Windows: PowerShell, a script an action, each declaring only the
 * Windows functions it needs (antivirus reads a script that hooks the
 * pointer, the keys and the window in front together as a keylogger's).
 * $Payload is set before it. It needs the signed-in desktop: Swarm's
 * worker run at sign-in, not as a service (session 0 has no screen).
 */
export function windowsScript(action: string): string {
	return WIN_PRELUDE + (WIN_ACTIONS[action] ?? `throw "no action ${action}"`) + WIN_END;
}

const WIN_PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Out-Answer($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)) }
try {
	$p = $Payload | ConvertFrom-Json
	function Need-Desktop { if ([System.Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { throw "Swarm runs outside the signed-in desktop here (session 0, as a service), which has no screen: run Swarm's machine at sign-in instead." } }
	Add-Type -AssemblyName System.Windows.Forms, System.Drawing
	$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
	$rec = Join-Path $env:TEMP 'swarm-test-machines.mp4'
`;

const WIN_END = String.raw`
} catch {
	Out-Answer @{ error = $_.Exception.Message }
}
`;

const WIN_DPI = String.raw`
	if (-not ('SwarmDpi' -as [type])) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SwarmDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }' }
	[SwarmDpi]::SetProcessDPIAware() | Out-Null
	$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
`;

const WIN_WINDOW = String.raw`
	if (-not ('SwarmWindow' -as [type])) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SwarmWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }' }
`;

const WIN_ACTIONS: Record<string, string> = {
	status: String.raw`
	Out-Answer @{ summary = "Windows $([Environment]::OSVersion.Version), $($screen.Width)x$($screen.Height)" }
`,
	capture:
		WIN_DPI +
		String.raw`
	Need-Desktop
	$bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$g.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bmp.Size)
	# Saved, and read by a script of its own (read): one that grabs the screen and prints it is read as spyware's.
	$out = Join-Path $env:TEMP ('swarm-shot-' + [guid]::NewGuid().ToString('N') + '.jpg')
	$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg); $g.Dispose(); $bmp.Dispose()
	Out-Answer @{ path = $out; size = (Get-Item $out).Length }
`,
	drive:
		WIN_DPI +
		String.raw`
	Need-Desktop
	if (-not ('SwarmPointer' -as [type])) { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SwarmPointer { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e); }' }
	function Mouse($x, $y) { [SwarmPointer]::SetCursorPos([int]$x + $screen.Left, [int]$y + $screen.Top) | Out-Null }
	function Btn($f) { [SwarmPointer]::mouse_event($f, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 20 }
	$keys = @{ enter = '{ENTER}'; 'return' = '{ENTER}'; tab = '{TAB}'; esc = '{ESC}'; escape = '{ESC}'; space = ' '; backspace = '{BACKSPACE}'; 'delete' = '{DELETE}'; up = '{UP}'; down = '{DOWN}'; left = '{LEFT}'; right = '{RIGHT}'; home = '{HOME}'; 'end' = '{END}'; pageup = '{PGUP}'; pagedown = '{PGDN}' }
	1..12 | ForEach-Object { $keys["f$_"] = "{F$_}" }
	function Escape-Keys($t) { ($t.ToCharArray() | ForEach-Object { if ('+^%~(){}[]'.Contains([string]$_)) { '{' + $_ + '}' } else { [string]$_ } }) -join '' }
	function Chord($c) {
		$parts = $c.ToLower().Split('+'); $k = $parts[-1]; $mods = ''
		$held = $(if ($parts.Length -gt 1) { $parts[0..($parts.Length - 2)] } else { @() })
		foreach ($m in $held) {
			switch ($m) { 'ctrl' { $mods += '^' } 'control' { $mods += '^' } 'cmd' { $mods += '^' } 'shift' { $mods += '+' } 'alt' { $mods += '%' } default { throw "no modifier $m (ctrl, shift, alt; the Start menu is ctrl+esc)" } }
		}
		if ($keys.ContainsKey($k)) { $s = $keys[$k] } elseif ($k.Length -eq 1) { $s = Escape-Keys $k } else { throw "no key $k" }
		[System.Windows.Forms.SendKeys]::SendWait($mods + $s)
	}
	$n = 0
	foreach ($step in $p.arg) {
		if ($step -notmatch '^\s*(\w+)\s*(.*)$') { throw "no step $step" }
		$op = $Matches[1]; $rest = $Matches[2]; $a = @($rest -split '\s+' | Where-Object { $_ -ne '' })
		switch ($op) {
			'click' { Mouse $a[0] $a[1]; Btn 0x2; Btn 0x4 }
			'dclick' { Mouse $a[0] $a[1]; Btn 0x2; Btn 0x4; Btn 0x2; Btn 0x4 }
			'rclick' { Mouse $a[0] $a[1]; Btn 0x8; Btn 0x10 }
			'move' { Mouse $a[0] $a[1] }
			'drag' { Mouse $a[0] $a[1]; Btn 0x2; for ($i = 1; $i -le 12; $i++) { Mouse ([double]$a[0] + ([double]$a[2] - [double]$a[0]) * $i / 12) ([double]$a[1] + ([double]$a[3] - [double]$a[1]) * $i / 12); Start-Sleep -Milliseconds 15 }; Btn 0x4 }
			'scroll' { [SwarmPointer]::mouse_event(0x800, 0, 0, -120 * [int]$a[0], [UIntPtr]::Zero) }
			'type' { [System.Windows.Forms.SendKeys]::SendWait((Escape-Keys $rest)) }
			'key' { Chord $rest }
			'wait' { Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$a[0], 0), 10000)) }
			default { throw "no step $op" }
		}
		$n++; Start-Sleep -Milliseconds 50
	}
	Out-Answer @{ said = "did $n step(s)" }
`,
	pointer:
		WIN_DPI +
		String.raw`
	Need-Desktop
	$c = [System.Windows.Forms.Cursor]::Position
	Out-Answer @{ x = $c.X - $screen.Left; y = $c.Y - $screen.Top }
`,
	describe:
		WIN_DPI +
		WIN_WINDOW +
		String.raw`
	Need-Desktop
	Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
	$root = [System.Windows.Automation.AutomationElement]::FromHandle([SwarmWindow]::GetForegroundWindow())
	$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
	$out = New-Object System.Collections.ArrayList
	foreach ($e in $all) {
		if ($out.Count -ge 300) { break }
		try { $c = $e.Current } catch { continue }
		if (-not $c.Name -or $c.IsOffscreen) { continue }
		$r = $c.BoundingRectangle
		if ($r.IsEmpty -or $r.Width -le 0) { continue }
		$role = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
		[void]$out.Add(@{ role = $role.ToLower(); label = $c.Name; x = $r.X - $screen.Left; y = $r.Y - $screen.Top; w = $r.Width; h = $r.Height; action = ($role -match 'Button|Hyperlink|MenuItem|CheckBox|RadioButton|ComboBox|Edit|ListItem|TabItem|TreeItem|Slider|SplitButton') })
	}
	Out-Answer @{ elements = $out.ToArray(); app = $root.Current.Name }
`,
	front:
		WIN_WINDOW +
		String.raw`
	Need-Desktop
	$h = [SwarmWindow]::GetForegroundWindow(); $id = 0
	[SwarmWindow]::GetWindowThreadProcessId($h, [ref]$id) | Out-Null
	$pr = Get-Process -Id $id -ErrorAction SilentlyContinue
	if (-not $pr) { Out-Answer @{}; return }
	$desc = ''; try { $desc = $pr.MainModule.FileVersionInfo.FileDescription } catch {}
	Out-Answer @{ id = $pr.ProcessName; name = $(if ($desc) { $desc } else { $pr.MainWindowTitle }) }
`,
	leave:
		WIN_WINDOW +
		String.raw`
	Need-Desktop
	[SwarmWindow]::ShowWindow([SwarmWindow]::GetForegroundWindow(), 6) | Out-Null
	Out-Answer @{ said = 'minimized' }
`,
	launch: String.raw`
	$pr = $(if ($p.arg.args) { Start-Process -PassThru -FilePath $p.arg.app -ArgumentList $p.arg.args } else { Start-Process -PassThru -FilePath $p.arg.app })
	Out-Answer @{ said = "Launched $($p.arg.app)."; pid = $(if ($pr) { $pr.Id } else { 0 }) }
`,
	focus:
		WIN_WINDOW +
		String.raw`
	Need-Desktop
	$pr = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($p.arg.app)) -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
	if (-not $pr) { throw "$($p.arg.app) has no window open" }
	[SwarmWindow]::ShowWindow($pr.MainWindowHandle, 9) | Out-Null; [SwarmWindow]::SetForegroundWindow($pr.MainWindowHandle) | Out-Null
	Out-Answer @{ said = "Brought forward $($p.arg.app)." }
`,
	kill: String.raw`
	# The process the launch started, none of the user's of that name.
	$pr = Get-Process -Id ([int]$p.arg.pid) -ErrorAction SilentlyContinue
	if (-not $pr) { Out-Answer @{ said = "$($p.arg.app) had already quit, or handed itself to a window that was open already (left alone)." }; return }
	Stop-Process -Id $pr.Id -ErrorAction Stop
	Out-Answer @{ said = "Stopped $($p.arg.app)." }
`,
	recordStart: String.raw`
	Need-Desktop
	if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'recording a Windows screen needs ffmpeg on its PATH (winget install ffmpeg)' }
	Remove-Item $rec -ErrorAction SilentlyContinue
	$ff = Start-Process ffmpeg -PassThru -WindowStyle Hidden -ArgumentList @('-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '15', '-t', [int]$p.arg.seconds, '-i', 'desktop', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', $rec)
	Set-Content -Path "$rec.pid" -Value $ff.Id
	Out-Answer @{ said = 'recording' }
`,
	recordStop: String.raw`
	# Only the ffmpeg it started: none of the user's.
	if (Test-Path "$rec.pid") { Stop-Process -Id ([int](Get-Content "$rec.pid")) -ErrorAction SilentlyContinue; Remove-Item "$rec.pid" }
	Start-Sleep -Milliseconds 500
	Out-Answer @{ path = $rec; size = $(if (Test-Path $rec) { (Get-Item $rec).Length } else { 0 }); ext = 'mp4' }
`,
	size: String.raw`
	Out-Answer @{ size = $(if (Test-Path -LiteralPath $p.arg.path -PathType Leaf) { (Get-Item -LiteralPath $p.arg.path).Length } else { 0 }); exists = (Test-Path -LiteralPath $p.arg.path) }
`,
	write: String.raw`
	# A piece of a file, base64 on the input: appended, or the file begun.
	$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
	if (-not $p.arg.append) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p.arg.path) | Out-Null }
	$fs = [System.IO.File]::Open($p.arg.path, $(if ($p.arg.append) { 'Append' } else { 'Create' }))
	try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Close() }
	Out-Answer @{ size = (Get-Item -LiteralPath $p.arg.path).Length }
`,
	read: String.raw`
	$fs = [System.IO.File]::OpenRead($p.arg.path)
	try {
		if ($p.arg.offset) { $fs.Seek($p.arg.offset, 'Begin') | Out-Null }
		$n = [Math]::Min($p.arg.length, $fs.Length - $fs.Position)
		$buf = New-Object byte[] $n; $got = $fs.Read($buf, 0, $n)
		Out-Answer @{ data = [Convert]::ToBase64String($buf, 0, $got) }
	} finally { $fs.Close() }
`,
	remove: String.raw`
	Remove-Item $p.arg.path -ErrorAction SilentlyContinue; Out-Answer @{}
`,
};

/**
 * Linux: python3, given the payload as its argument. On GNOME (Wayland or
 * X11), Mutter's RemoteDesktop and ScreenCast over D-Bus, a session an
 * action, with GStreamer's pipewiresrc for the frames; elsewhere on X11,
 * xdotool and ImageMagick's import. Wayland doesn't say which app is in
 * front, so the sensitive apps aren't known there.
 */
export const LINUX_PY = String.raw`
import json, os, signal, subprocess, sys, tempfile, time, base64

def answer(o):
    print(json.dumps(o)); sys.stdout.flush()

p = json.loads(sys.argv[1])
action, arg = p.get("action"), p.get("arg")
uid = os.getuid()
os.environ.setdefault("XDG_RUNTIME_DIR", "/run/user/%d" % uid)
os.environ.setdefault("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/%d/bus" % uid)
TMP = tempfile.gettempdir()
REC = os.path.join(TMP, "swarm-test-machines.mp4")
NAMED = {"return": 0xff0d, "enter": 0xff0d, "escape": 0xff1b, "esc": 0xff1b, "tab": 0xff09, "backspace": 0xff08,
         "delete": 0xffff, "space": 0x20, "up": 0xff52, "down": 0xff54, "left": 0xff51, "right": 0xff53,
         "home": 0xff50, "end": 0xff57, "pageup": 0xff55, "pagedown": 0xff56}
MODS = {"ctrl": 0xffe3, "control": 0xffe3, "shift": 0xffe1, "alt": 0xffe9, "super": 0xffeb, "cmd": 0xffe3, "win": 0xffeb}
for n in range(1, 13):
    NAMED["f%d" % n] = 0xffbe + n - 1

def keysym(c):
    o = ord(c)
    return o if 0x20 <= o < 0x7f else 0x01000000 + o

def chord(text):
    parts = text.split("+")
    k = parts[-1].lower()
    mods = []
    for m in parts[:-1]:
        if m.lower() not in MODS:
            raise Exception("no modifier %s: ctrl, shift, alt, super" % m)
        mods.append(MODS[m.lower()])
    if k in NAMED:
        key = NAMED[k]
    elif len(parts[-1]) == 1:
        key = keysym(parts[-1])
    else:
        raise Exception("no key %s" % k)
    return mods, key

def mutter():
    try:
        from gi.repository import Gio, GLib
        conn = Gio.bus_get_sync(Gio.BusType.SESSION)
        conn.call_sync("org.gnome.Mutter.RemoteDesktop", "/org/gnome/Mutter/RemoteDesktop", "org.freedesktop.DBus.Peer", "Ping", None, None, 0, 3000, None)
        return conn
    except Exception:
        return None

class Session:
    """A RemoteDesktop session with its screen's stream, as long as an action needs."""
    RD, SC, DC = "org.gnome.Mutter.RemoteDesktop", "org.gnome.Mutter.ScreenCast", "org.gnome.Mutter.DisplayConfig"

    def __init__(self, conn):
        from gi.repository import GLib
        self.conn, self.GLib = conn, GLib
        _, monitors, logical, _ = self.call(self.DC, "/org/gnome/Mutter/DisplayConfig", self.DC, "GetCurrentState").unpack()
        primary = [lm[5][0][0] for lm in logical if lm[4] and lm[5]]
        # A real monitor, the primary first; else a virtual one already there (a headless GNOME's, as
        # a remote desktop made it): never one of its own, which would move the user's windows.
        shown = [m[0][0] for m in monitors]
        real = sorted([c for c in shown if not c.startswith("Meta-")], key=lambda c: (c not in primary, c)) or sorted(shown, key=lambda c: (c not in primary, c))
        if not real:
            raise Exception("GNOME shows no screen here: it runs headless, with no monitor and no remote desktop")
        self.rd = self.call(self.RD, "/org/gnome/Mutter/RemoteDesktop", self.RD, "CreateSession").unpack()[0]
        sid = self.call(self.RD, self.rd, "org.freedesktop.DBus.Properties", "Get", (self.RD + ".Session", "SessionId"), "(ss)").unpack()[0]
        sc = self.call(self.SC, "/org/gnome/Mutter/ScreenCast", self.SC, "CreateSession", ({"remote-desktop-session-id": GLib.Variant("s", sid)},), "(a{sv})").unpack()[0]
        self.stream = self.call(self.SC, sc, self.SC + ".Session", "RecordMonitor", (real[0], {"cursor-mode": GLib.Variant("u", 1)}), "(sa{sv})").unpack()[0]
        loop, got = GLib.MainLoop(), {}
        def on_stream(c, s, p, i, n, params):
            got["node"] = params.unpack()[0]
            loop.quit()
        conn.signal_subscribe(self.SC, self.SC + ".Stream", "PipeWireStreamAdded", self.stream, None, 0, on_stream)
        self.call(self.RD, self.rd, self.RD + ".Session", "Start")
        GLib.timeout_add(8000, loop.quit)
        loop.run()
        if "node" not in got:
            self.stop()
            raise Exception("GNOME gave no screen stream")
        self.node = got["node"]
        params = self.call(self.SC, self.stream, "org.freedesktop.DBus.Properties", "Get", (self.SC + ".Stream", "Parameters"), "(ss)").unpack()[0]
        self.size = tuple(params.get("size", (1920, 1080)))

    def call(self, dest, path, iface, method, args=None, sig=None):
        return self.conn.call_sync(dest, path, iface, method, self.GLib.Variant(sig, args) if sig else None, None, 0, -1, None)

    def rd_call(self, method, args, sig):
        self.call(self.RD, self.rd, self.RD + ".Session", method, args, sig)

    def stop(self):
        try:
            self.rd_call("Stop", None, None)
        except Exception:
            pass

    def frame(self):
        out = os.path.join(TMP, "swarm-shot-%d.jpg" % os.getpid())
        # The stream's first frame: it sends more only as the screen changes.
        r = subprocess.run(["gst-launch-1.0", "-q", "pipewiresrc", "path=%d" % self.node, "always-copy=true", "num-buffers=1", "!", "videoconvert", "!", "jpegenc", "quality=85", "!", "multifilesink", "location=" + out], capture_output=True, timeout=30)
        if r.returncode != 0 or not os.path.exists(out):
            raise Exception("GStreamer took no frame: " + (r.stderr.decode(errors="replace").strip() or "is gstreamer1.0-pipewire installed?"))
        data = open(out, "rb").read()
        os.remove(out)
        return data

    def move(self, x, y):
        self.rd_call("NotifyPointerMotionAbsolute", (self.stream, float(x), float(y)), "(sdd)")

    def button(self, b, down):
        self.rd_call("NotifyPointerButton", (b, down), "(ib)")

    def key(self, k, down):
        self.rd_call("NotifyKeyboardKeysym", (k, down), "(ub)")

    def scroll(self, n):
        self.rd_call("NotifyPointerAxisDiscrete", (0, int(n)), "(ui)")

class X11:
    """xdotool and ImageMagick, on an X11 desktop without GNOME's Mutter."""
    def __init__(self):
        if not os.environ.get("DISPLAY"):
            os.environ["DISPLAY"] = ":0"
        for tool in ("xdotool", "import"):
            if subprocess.run(["which", tool], capture_output=True).returncode != 0:
                raise Exception("this Linux desktop has neither GNOME's Mutter nor %s (xdotool, imagemagick)" % tool)
    def stop(self):
        pass
    def frame(self):
        return subprocess.run(["import", "-window", "root", "jpg:-"], capture_output=True, check=True, timeout=30).stdout
    def x(self, *args):
        subprocess.run(["xdotool"] + [str(a) for a in args], check=True, timeout=30)
    def move(self, x, y):
        self.x("mousemove", int(x), int(y))
    def button(self, b, down):
        self.x("mousedown" if down else "mouseup", {272: 1, 273: 3}[b])
    def key(self, k, down):
        self.x("keydown" if down else "keyup", "0x%x" % k)
    def scroll(self, n):
        self.x("click", "--repeat", abs(int(n)), 5 if n > 0 else 4)

def desktop():
    conn = mutter()
    return Session(conn) if conn else X11()

def drive(d, steps):
    done = 0
    for step in steps:
        op, _, rest = step.strip().partition(" ")
        rest = rest.strip()
        n = [float(v) for v in rest.split()] if op not in ("type", "key") and rest else []
        def need(c):
            if len(n) < c:
                raise Exception("%s takes %d numbers: %s" % (op, c, step))
        if op in ("click", "dclick", "rclick"):
            need(2)
            d.move(n[0], n[1]); time.sleep(0.03)
            b = 273 if op == "rclick" else 272
            for _ in range(2 if op == "dclick" else 1):
                d.button(b, True); time.sleep(0.03); d.button(b, False); time.sleep(0.05)
        elif op == "move":
            need(2); d.move(n[0], n[1])
        elif op == "drag":
            need(4)
            d.move(n[0], n[1]); d.button(272, True)
            for i in range(1, 13):
                d.move(n[0] + (n[2] - n[0]) * i / 12, n[1] + (n[3] - n[1]) * i / 12); time.sleep(0.015)
            d.button(272, False)
        elif op == "scroll":
            need(1); d.scroll(n[0])
        elif op == "type":
            for c in rest:
                k = 0xff0d if c == "\n" else keysym(c)
                d.key(k, True); d.key(k, False); time.sleep(0.01)
        elif op == "key":
            mods, k = chord(rest)
            for m in mods: d.key(m, True)
            d.key(k, True); d.key(k, False)
            for m in reversed(mods): d.key(m, False)
        elif op == "wait":
            time.sleep(min(max(n[0] if n else 0, 0), 10000) / 1000)
        else:
            raise Exception("no step " + op)
        done += 1
        time.sleep(0.05)
    return done

def record_serve(seconds):
    """Held by recordStart, detached: the session lives while GStreamer writes, until SIGINT or its time."""
    d = Session(mutter())
    enc = "x264enc tune=zerolatency speed-preset=veryfast" if subprocess.run(["gst-inspect-1.0", "x264enc"], capture_output=True).returncode == 0 else "openh264enc"
    w, h = d.size
    if w > 1920:
        w, h = 1920, int(h * 1920 / w)
    w, h = w - w % 2, h - h % 2
    g = subprocess.Popen(["gst-launch-1.0", "-e", "-q", "pipewiresrc", "path=%d" % d.node, "do-timestamp=true", "keepalive-time=66", "!", "videorate", "!", "video/x-raw,framerate=15/1", "!", "videoconvert", "!", "videoscale", "!", "video/x-raw,width=%d,height=%d" % (w, h), "!"] + enc.split() + ["!", "h264parse", "!", "mp4mux", "!", "filesink", "location=" + REC])
    print("recording"); sys.stdout.flush()
    stop = lambda *_: g.send_signal(signal.SIGINT)
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        g.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        g.send_signal(signal.SIGINT)
        g.wait(timeout=20)
    d.stop()

try:
    if action == "status":
        conn = mutter()
        kind = "GNOME (%s)" % os.environ.get("XDG_SESSION_TYPE", "wayland") if conn else "X11" if os.environ.get("DISPLAY") else "no desktop"
        answer({"summary": "Linux, %s%s" % (kind, ", the app in front isn't known" if conn else "")})
    elif action == "capture":
        d = desktop()
        try:
            answer({"png": base64.b64encode(d.frame()).decode()})
        finally:
            d.stop()
    elif action == "drive":
        d = desktop()
        try:
            answer({"said": "did %d step(s)" % drive(d, arg)})
        finally:
            d.stop()
    elif action in ("front", "leave"):
        # On X11, xdotool says which window is in front, and minimizes it; Wayland says neither.
        if not mutter() and os.environ.get("DISPLAY", ":0") and subprocess.run(["which", "xdotool"], capture_output=True).returncode == 0:
            os.environ.setdefault("DISPLAY", ":0")
            if action == "leave":
                subprocess.run(["xdotool", "getactivewindow", "windowminimize"], capture_output=True, timeout=10)
                answer({})
            else:
                pid = subprocess.run(["xdotool", "getactivewindow", "getwindowpid"], capture_output=True, text=True, timeout=10).stdout.strip()
                name = subprocess.run(["xdotool", "getactivewindow", "getwindowname"], capture_output=True, text=True, timeout=10).stdout.strip()
                comm = open("/proc/%s/comm" % pid).read().strip() if pid.isdigit() and os.path.exists("/proc/%s/comm" % pid) else ""
                answer({"id": comm, "name": name})
        else:
            answer({})
    elif action == "describe":
        # AT-SPI: the active window's elements. On Wayland a window says where things are within itself,
        # not on the screen: the window's place, from its own frame, is added where it's known.
        import gi
        gi.require_version("Atspi", "2.0")
        from gi.repository import Atspi
        out, seen = [], [0]
        def walk(acc, depth):
            if acc is None or len(out) >= 300 or depth > 30 or seen[0] > 5000:
                return
            seen[0] += 1
            try:
                name = acc.get_name() or ""
                role = acc.get_role_name() or ""
                states = acc.get_state_set()
                if name and states.contains(Atspi.StateType.SHOWING):
                    e = acc.get_extents(Atspi.CoordType.SCREEN)
                    if e.width > 0 and e.height > 0:
                        out.append({"role": role.replace(" ", "-"), "label": name, "x": e.x, "y": e.y, "w": e.width, "h": e.height,
                                    "action": role in ("push button", "toggle button", "check box", "radio button", "menu item", "link", "entry", "text", "combo box", "list item", "page tab", "table cell", "slider", "spin button")})
                for i in range(acc.get_child_count()):
                    walk(acc.get_child_at_index(i), depth + 1)
            except Exception:
                pass
        desk = Atspi.get_desktop(0)
        active = None
        for i in range(desk.get_child_count()):
            app = desk.get_child_at_index(i)
            for j in range(app.get_child_count() if app else 0):
                w = app.get_child_at_index(j)
                if w and w.get_state_set().contains(Atspi.StateType.ACTIVE):
                    active = w
        if active is None:
            raise Exception("no window is active, or its app gives no accessibility (AT-SPI)")
        walk(active, 0)
        answer({"elements": out, "app": active.get_name(), "relative": os.environ.get("XDG_SESSION_TYPE") == "wayland"})
    elif action == "launch":
        child = subprocess.Popen([arg["app"]] + (arg.get("args") or []), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        answer({"said": "Launched %s." % arg["app"], "pid": child.pid})
    elif action == "focus":
        raise Exception("Linux brings no app forward from here: click its window")
    elif action == "kill":
        # The process the launch started, none of the user's of that name.
        pid = int(arg.get("pid") or 0)
        if pid <= 0:
            raise Exception("no process of %s's to stop" % arg["app"])
        try:
            os.kill(pid, signal.SIGTERM)
            answer({"said": "Stopped %s." % arg["app"]})
        except ProcessLookupError:
            answer({"said": "%s had already quit." % arg["app"]})
    elif action == "recordStart":
        if not mutter():
            raise Exception("recording a Linux screen needs GNOME's Mutter")
        for f in (REC, REC + ".pid", REC + ".log"):
            if os.path.exists(f): os.remove(f)
        # Itself again, detached, holding the session while it records (its text is the plugin's: python3 -c).
        log = open(REC + ".log", "w")
        child = subprocess.Popen([sys.executable, "-c", arg["script"], json.dumps({"action": "recordServe", "arg": {"seconds": arg["seconds"]}})], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        open(REC + ".pid", "w").write(str(child.pid))
        for _ in range(150):
            said = open(REC + ".log").read()
            if "recording" in said:
                break
            if child.poll() is not None:
                raise Exception("the recording didn't start: " + said.strip())
            time.sleep(0.1)
        answer({"said": "recording"})
    elif action == "recordServe":
        record_serve(int(arg["seconds"]))
    elif action == "recordStop":
        pid = int(open(REC + ".pid").read()) if os.path.exists(REC + ".pid") else 0
        if pid:
            try: os.kill(pid, signal.SIGINT)
            except ProcessLookupError: pass
            for _ in range(150):
                try: os.kill(pid, 0)
                except ProcessLookupError: break
                time.sleep(0.1)
            os.remove(REC + ".pid")
        answer({"path": REC, "size": os.path.getsize(REC) if os.path.exists(REC) else 0, "ext": "mp4"})
    elif action == "read":
        with open(arg["path"], "rb") as f:
            f.seek(arg.get("offset") or 0)
            answer({"data": base64.b64encode(f.read(arg.get("length") or -1)).decode()})
    elif action == "size":
        answer({"size": os.path.getsize(arg["path"]) if os.path.isfile(arg["path"]) else 0, "exists": os.path.exists(arg["path"])})
    elif action == "write":
        # A piece of a file, base64 on the input: appended, or the file begun.
        piece = base64.b64decode(sys.stdin.read())
        if not arg.get("append"):
            os.makedirs(os.path.dirname(os.path.abspath(arg["path"])), exist_ok=True)
        with open(arg["path"], "ab" if arg.get("append") else "wb") as f:
            f.write(piece)
        answer({"size": os.path.getsize(arg["path"])})
    elif action == "remove":
        if os.path.exists(arg["path"]): os.remove(arg["path"])
        answer({})
    else:
        raise Exception("no action " + str(action))
except Exception as e:
    answer({"error": str(e)})
`;
