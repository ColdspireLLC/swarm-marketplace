// The simulators' pure parts: which model and image agents' simulators are
// made of, an AVD's files, input steps as Android's commands. No Swarm
// here, for the tests.
import { ini, slimConfig } from "./slimandroid";

export class SimError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SimError";
	}
}

export interface Runtime {
	identifier: string;
	version: string;
	name: string;
	types: { identifier: string; name: string; family: string }[];
}

const vnum = (v: string) => v.split(".").reduce((n, p, i) => n + Number(p || 0) / 1000 ** i, 0);

/**
 * The model and runtime agent simulators are made of: the one named (a
 * device type's name, as "iPhone 17 Pro"), on the newest iOS that has it;
 * else the newest iOS's newest iPhone Pro, else its newest iPhone.
 */
export function pickModel(rts: Runtime[], wanted: string): { runtime: Runtime; type: Runtime["types"][number] } | null {
	const sorted = [...rts].sort((a, b) => vnum(b.version) - vnum(a.version));
	const w = wanted.trim().toLowerCase();
	if (w) {
		for (const r of sorted) {
			const t = r.types.find((t) => t.name.toLowerCase() === w || t.identifier.toLowerCase() === w);
			if (t) return { runtime: r, type: t };
		}
		return null;
	}
	for (const r of sorted) {
		const phones = r.types.filter((t) => t.family === "iPhone" && !/\b(SE|e)\b|mini/.test(t.name));
		const num = (t: { name: string }) => Number(/iPhone (\d+)/.exec(t.name)?.[1] ?? 0);
		const pro = phones.filter((t) => / Pro$/.test(t.name)).sort((a, b) => num(b) - num(a))[0];
		const any = phones.sort((a, b) => num(b) - num(a))[0];
		if (pro ?? any) return { runtime: r, type: (pro ?? any)! };
	}
	return null;
}

export function unbase64(s: string): Uint8Array {
	const bin = atob(s.replace(/\s+/g, ""));
	const b = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
	return b;
}

/** A PNG's width and height. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
	const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return png.length > 24 ? { width: dv.getUint32(16), height: dv.getUint32(20) } : { width: 0, height: 0 };
}

/**
 * The image agents' emulators are made of: the newest Android's Google
 * APIs image (adb root works, unlike Play Store's), not a 16 KB-page one
 * (it needs 4 GB of RAM), of the host's architecture.
 */
export function pickImage(images: string[], abi: string): string {
	const api = (s: string) => Number(/android-(\d+)/.exec(s)?.[1] ?? 0);
	const ok = images.filter((i) => i.startsWith("system-images;") && i.endsWith(";" + abi) && !/ps16k|playstore|tv|wear|automotive/.test(i));
	const rank = (i: string) => api(i) * 10 + (/;google_apis;/.test(i) ? 2 : /;default;/.test(i) ? 1 : 0);
	return ok.sort((a, b) => rank(b) - rank(a))[0] ?? "";
}

/** An agent AVD's files, pure: the pointer <name>.ini and its config.ini, slim or stock. */
export function avdFiles(home: string, name: string, n: number, image: string, s: { os: "darwin" | "linux"; headless: boolean }, slim: boolean): { pointer: string; config: string } {
	const [, api = "", tag = "", abi = ""] = image.split(";");
	const config = new Map(
		Object.entries({
			"avd.ini.encoding": "UTF-8",
			"avd.ini.displayname": `Swarm agent ${n}`,
			AvdId: name,
			"PlayStore.enabled": "no",
			"abi.type": abi,
			"hw.cpu.arch": abi.startsWith("arm") ? "arm64" : abi,
			"hw.cpu.ncore": "4",
			"hw.ramSize": "2048",
			"vm.heapSize": "256",
			"disk.dataPartition.size": "4G",
			"hw.device.name": "pixel_9",
			"hw.device.manufacturer": "Google",
			"hw.lcd.width": "1080",
			"hw.lcd.height": "2424",
			"hw.lcd.density": "420",
			"hw.gpu.enabled": "yes",
			"hw.gpu.mode": "auto",
			"hw.keyboard": "yes",
			"hw.mainKeys": "no",
			"hw.sdCard": "no",
			showDeviceFrame: "no",
			"image.sysdir.1": `system-images/${api}/${tag}/${abi}/`,
			"tag.id": tag,
			target: api,
		}),
	);
	return {
		pointer: ini(new Map([["avd.ini.encoding", "UTF-8"], ["path", `${home}/${name}.avd`], ["target", api]])),
		config: ini(slim ? slimConfig(config, s) : config),
	};
}

export const ANDROID_STEPS = "tap X Y, long X Y [MS], swipe X1 Y1 X2 Y2 [MS], type TEXT, key home|back|enter|recents|delete|tab|power|volumeup|volumedown, wait MS (screenshot pixels)";
const KEYS: Record<string, string> = { home: "HOME", back: "BACK", enter: "ENTER", recents: "APP_SWITCH", delete: "DEL", tab: "TAB", power: "POWER", volumeup: "VOLUME_UP", volumedown: "VOLUME_DOWN", escape: "ESCAPE" };

/** Input steps as one script of `input` commands for the guest. */
export function stepsScript(steps: string[]): string {
	const lines: string[] = [];
	for (const step of steps) {
		const [op = "", ...rest] = step.trim().split(/\s+/);
		const n = rest.map(Number);
		const xy = { tap: 2, long: 2, swipe: 4 }[op.toLowerCase()] ?? 0;
		if (rest.length < xy || n.slice(0, xy).some((v) => !Number.isFinite(v))) throw new SimError(`${step}: ${ANDROID_STEPS}`);
		const r = (v: number) => String(Math.round(v));
		switch (op.toLowerCase()) {
			case "tap":
				lines.push(`input tap ${r(n[0]!)} ${r(n[1]!)}`);
				break;
			case "long":
				lines.push(`input swipe ${r(n[0]!)} ${r(n[1]!)} ${r(n[0]!)} ${r(n[1]!)} ${r(n[2] || 800)}`);
				break;
			case "swipe":
				lines.push(`input swipe ${n.slice(0, 4).map(r).join(" ")} ${r(n[4] || 300)}`);
				break;
			case "type": {
				// input text takes %s for a space, and the shell's specials escaped.
				const text = step.trim().slice(4).trimStart().replace(/ /g, "%s").replace(/(['"`\\$&|;<>()*?~!#{}[\]])/g, "\\$1");
				if (text) lines.push(`input text ${text}`);
				break;
			}
			case "key": {
				const k = KEYS[(rest[0] ?? "").toLowerCase()];
				if (!k) throw new SimError(`no key ${rest[0] ?? ""}: ${Object.keys(KEYS).join(", ")}`);
				lines.push(`input keyevent KEYCODE_${k}`);
				break;
			}
			case "wait":
				lines.push(`sleep ${Math.min(n[0] || 500, 10_000) / 1000}`);
				break;
			default:
				throw new SimError(`no step ${op}: ${ANDROID_STEPS}`);
		}
	}
	return lines.join("\n");
}

