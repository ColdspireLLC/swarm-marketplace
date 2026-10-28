// What the plugin uses of pele 1.12.0 (https://github.com/obsidianmd/pele,
// MIT): its full types are in its package's dist/*.d.ts.

export type DiagramType = string;

export interface TextMeasurer {
	/** style: bold 1, italic 2, mono 4, sub 8, sup 16, underline 32. */
	width(text: string, size: number, style: number): number;
}

export interface RenderOptions {
	measurer?: TextMeasurer;
	fontFamily?: string;
	fontSize?: number;
	maxWidth?: number;
	autoDirection?: boolean;
	padding?: number;
	links?: boolean;
	images?: boolean;
	now?: number | Date;
}

export interface RenderResult {
	svg: string;
	width: number;
	height: number;
	type: DiagramType;
	mermaidType: string;
}

export function detectType(text: string): DiagramType | null;
export function render(source: string, options?: RenderOptions): RenderResult;
