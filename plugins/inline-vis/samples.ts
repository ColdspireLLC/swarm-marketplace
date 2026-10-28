// Replies as an agent writes them, a fence each: the tests draw them.

const fence = (lang: string, code: string, before = "", after = "") =>
	`${before}${before ? "\n\n" : ""}\`\`\`${lang}\n${code.trim()}\n\`\`\`${after ? "\n\n" + after : ""}`;

export const SAMPLES: { [name: string]: { reply: string; see: string } } = {
	"bar-stacked": {
		see: "Test runs this week",
		reply: fence("chart", `
{
  "type": "bar",
  "title": "Test runs this week",
  "subtitle": "Every pipeline on main",
  "x": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "series": [
    { "name": "Passed", "data": [42, 38, 51, 47, 55] },
    { "name": "Flaky", "data": [5, 7, 3, 6, 2] },
    { "name": "Failed", "data": [3, 6, 2, 4, 1] }
  ],
  "stacked": true,
  "unit": "runs"
}`, "Here's how the week went:", "Friday was the cleanest day since the flake fix landed."),
	},
	"bar-grouped": {
		see: "Cold start by platform",
		reply: fence("chart", `
{
  "type": "bar",
  "title": "Cold start by platform",
  "x": ["Linux", "macOS", "Windows"],
  "series": [
    { "name": "Before", "data": [412, 388, 655] },
    { "name": "After", "data": [236, 251, 402] }
  ],
  "unit": "ms"
}`, "The new loader cut cold starts everywhere:"),
	},
	"bar-horizontal": {
		see: "Largest packages",
		reply: fence("chart", `
{
  "type": "bar",
  "horizontal": true,
  "title": "Largest packages",
  "x": ["internal/gui", "internal/core", "internal/plugins", "internal/agent", "third_party/mygo", "cmd"],
  "data": [48.2, 31.5, 27.9, 18.4, 12.1, 2.3],
  "unit": "k lines"
}`, "By lines of Go:"),
	},
	line: {
		see: "Memory over a long session",
		reply: fence("chart", `
{
  "type": "line",
  "title": "Memory over a long session",
  "x": ["0h", "1h", "2h", "3h", "4h", "5h", "6h", "7h", "8h"],
  "series": [
    { "name": "Window", "data": [182, 190, 204, 199, 210, 215, 212, 220, 218] },
    { "name": "Core", "data": [96, 101, 108, 112, 119, 121, 128, 131, 137] },
    { "name": "Plugins", "data": [40, 44, 43, 47, 46, null, 52, 55, 54] }
  ],
  "unit": "MB",
  "yLabel": "Resident memory"
}`, "Memory stays flat after the first hour:"),
	},
	area: {
		see: "Tokens a day",
		reply: fence("chart", `
{
  "type": "area",
  "stacked": true,
  "title": "Tokens a day",
  "x": ["Oct 21", "Oct 22", "Oct 23", "Oct 24", "Oct 25", "Oct 26", "Oct 27"],
  "series": [
    { "name": "Input", "data": [1.2e6, 1.5e6, 1.1e6, 1.9e6, 2.2e6, 1.4e6, 2.6e6] },
    { "name": "Output", "data": [2.1e5, 2.6e5, 1.9e5, 3.3e5, 3.9e5, 2.2e5, 4.4e5] }
  ]
}`, "Usage over the last week:"),
	},
	scatter: {
		see: "Diff size against review time",
		reply: fence("chart", `
{
  "type": "scatter",
  "title": "Diff size against review time",
  "xLabel": "Lines changed",
  "yLabel": "Hours to merge",
  "series": [
    { "name": "Features", "data": [[120, 5], [340, 9], [800, 20], [60, 2], [450, 14], [1200, 31]] },
    { "name": "Fixes", "data": [[15, 1], [40, 1.5], [90, 3], [30, 0.5], [210, 6]] }
  ]
}`, "Bigger diffs take longer, roughly in proportion:"),
	},
	donut: {
		see: "Where the time went",
		reply: fence("chart", `
{
  "type": "donut",
  "title": "Where the time went",
  "data": [
    { "label": "Tests", "value": 41 },
    { "label": "Build", "value": 23 },
    { "label": "Lint and vet", "value": 12 },
    { "label": "Upload", "value": 6 }
  ],
  "unit": "min"
}`, "The pipeline's 82 minutes:"),
	},
	flowchart: {
		see: "Diagram",
		reply: fence("mermaid", `
flowchart TD
  A[Agent writes a reply] --> B{Has a fence?}
  B -->|no| C[Markdown as usual]
  B -->|yes| D{A plugin claims its language?}
  D -->|no| E[Code block]
  D -->|yes| F([Plugin renders it])
  F --> G[(Cache)]
  F --> H[Canvas in the window]
`, "This is how a fence reaches the window:"),
	},
	"flowchart-lr": {
		see: "Diagram",
		reply: fence("mermaid", `
flowchart LR
  subgraph Devbox
    cli[swarm CLI] --> sock((plugins.sock))
  end
  subgraph App
    core[Core] --> rt[Plugin runtime]
    rt --> js[[QuickJS]]
  end
  sock --> core
  rt -.-> win[Window]
  core ==> log[(events.log)]
`, "Where each piece runs:"),
	},
	sequence: {
		see: "Diagram",
		reply: fence("mermaid", `
sequenceDiagram
  autonumber
  actor U as User
  participant W as Window
  participant P as Plugin
  U->>W: Opens Settings, Plugins
  W->>+P: render(page)
  P-->>-W: Recording
  loop Every keystroke
    U->>W: Types in the search
    W->>P: onChange(text)
  end
  alt Found
    P-->>W: Listings
  else Nothing
    P-->>W: Empty state
    Note right of P: Says which catalogs it searched
  end
`, "What happens as you search the store:"),
	},
	state: {
		see: "Diagram",
		reply: fence("mermaid", `
stateDiagram-v2
  [*] --> Off
  Off --> Starting : enable
  Starting --> Running : activate resolves
  Starting --> Failed : throws
  Running --> Off : disable
  Running --> Starting : reload
  Failed --> Starting : reload
  Failed --> [*] : remove
`, "A plugin's states:"),
	},
	"mermaid-pie": {
		see: "Languages",
		reply: fence("mermaid", `
pie title Languages
  "Go" : 71.4
  "TypeScript" : 17.2
  "JavaScript" : 6.1
  "Shell" : 3.3
  "Other" : 2
`, "The repository by language:"),
	},
	svg: {
		see: "SVG",
		reply: fence("svg", `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="320" height="120">
  <title>Three stages</title>
  <rect x="4" y="30" width="88" height="60" rx="10" fill="#2a78d6"/>
  <rect x="116" y="30" width="88" height="60" rx="10" fill="#eb6834"/>
  <rect x="228" y="30" width="88" height="60" rx="10" fill="#1baf7a"/>
  <path d="M92 60h24M204 60h24" stroke="#888" stroke-width="3"/>
</svg>`, "The three stages:"),
	},
};
