// What the plugin uses of KaTeX 0.16.47 (https://katex.org, MIT).
declare const katex: {
	__renderToHTMLTree(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean; strict?: boolean | string; trust?: boolean; maxSize?: number; maxExpand?: number; macros?: object }): any;
	version: string;
};
/** Added to the published file (README.md). font is as "Main-Regular"; null for a character it has no metrics for. */
export function __getCharacterMetrics(character: string, font: string, mode: "math" | "text"): { depth: number; height: number; italic: number; skew: number; width: number } | null;
export default katex;
export class ParseError extends Error {
	rawMessage: string;
	position?: number;
}
