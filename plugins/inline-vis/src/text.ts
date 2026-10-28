// Text widths, for laying out what a canvas draws: a canvas can't measure
// its text, so these are Inter's advances (the font a canvas draws in), in
// ems, for printable ASCII at the three weights Swarm ships. Generated from
// Swarm's internal/gui/theme/fonts.

const REGULAR = [0.281,0.288,0.466,0.633,0.642,0.982,0.644,0.300,0.365,0.365,0.501,0.662,0.288,0.460,0.288,0.360,0.631,0.407,0.610,0.618,0.646,0.593,0.620,0.566,0.619,0.620,0.288,0.302,0.662,0.662,0.662,0.511,0.966,0.690,0.654,0.730,0.722,0.601,0.590,0.746,0.743,0.269,0.571,0.672,0.565,0.903,0.753,0.765,0.639,0.765,0.644,0.642,0.646,0.744,0.690,0.985,0.682,0.679,0.629,0.365,0.360,0.365,0.471,0.456,0.323,0.562,0.612,0.571,0.612,0.583,0.370,0.613,0.591,0.242,0.242,0.549,0.242,0.876,0.591,0.600,0.612,0.612,0.376,0.528,0.327,0.591,0.562,0.818,0.546,0.562,0.552,0.426,0.333,0.426,0.662];
const MEDIUM = [0.267,0.304,0.494,0.639,0.646,0.993,0.653,0.313,0.369,0.369,0.521,0.667,0.303,0.462,0.303,0.370,0.646,0.415,0.616,0.627,0.656,0.603,0.630,0.571,0.629,0.630,0.303,0.315,0.667,0.667,0.667,0.527,0.982,0.709,0.657,0.733,0.722,0.603,0.589,0.748,0.745,0.272,0.575,0.688,0.565,0.913,0.756,0.767,0.642,0.769,0.648,0.646,0.653,0.740,0.709,1.003,0.701,0.696,0.641,0.369,0.370,0.369,0.477,0.463,0.337,0.568,0.618,0.577,0.618,0.587,0.379,0.620,0.602,0.252,0.252,0.559,0.252,0.888,0.602,0.604,0.618,0.618,0.387,0.539,0.340,0.602,0.575,0.829,0.557,0.575,0.559,0.440,0.346,0.440,0.667];
const SEMIBOLD = [0.252,0.321,0.523,0.644,0.650,1.004,0.663,0.326,0.373,0.373,0.540,0.673,0.319,0.465,0.319,0.379,0.660,0.423,0.623,0.636,0.666,0.612,0.640,0.576,0.640,0.640,0.319,0.329,0.673,0.673,0.673,0.543,0.999,0.728,0.659,0.737,0.722,0.605,0.588,0.749,0.746,0.277,0.580,0.703,0.565,0.922,0.759,0.769,0.645,0.773,0.652,0.650,0.660,0.736,0.728,1.020,0.720,0.713,0.652,0.373,0.379,0.373,0.481,0.469,0.351,0.574,0.624,0.583,0.624,0.591,0.389,0.625,0.612,0.262,0.262,0.569,0.262,0.900,0.612,0.609,0.624,0.624,0.397,0.549,0.353,0.612,0.587,0.839,0.569,0.588,0.566,0.455,0.359,0.455,0.673];

function wide(c: number): boolean {
	return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
		(c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60) || c >= 0x1f300;
}

/** How wide text is, in the canvas's units, at size and weight. */
export function textWidth(text: string, size: number, weight = 400): number {
	const t = weight >= 600 ? SEMIBOLD : weight >= 500 ? MEDIUM : REGULAR;
	let em = 0;
	for (const ch of text) {
		const c = ch.codePointAt(0)!;
		if (c >= 32 && c < 127) em += t[c - 32];
		else em += wide(c) ? 1 : 0.6;
	}
	return em * size;
}

/** text in lines no wider than max, broken at its spaces and at its own line breaks; a word wider than max stays whole. */
export function wrap(text: string, size: number, max: number, weight = 400): string[] {
	const out: string[] = [];
	for (const para of text.split("\n")) {
		let line = "";
		for (const word of para.split(/ +/)) {
			const next = line ? line + " " + word : word;
			if (line && textWidth(next, size, weight) > max) {
				out.push(line);
				line = word;
			} else {
				line = next;
			}
		}
		out.push(line);
	}
	return out;
}

/** text cut to fit max, ending in an ellipsis when it had to be. */
export function clip(text: string, size: number, max: number, weight = 400): string {
	if (textWidth(text, size, weight) <= max) return text;
	let s = text;
	while (s.length > 1 && textWidth(s + "…", size, weight) > max) s = s.slice(0, -1);
	return s.trimEnd() + "…";
}
