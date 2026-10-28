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
		see: "Flowchart",
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
		see: "Flowchart",
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
		see: "Sequence diagram",
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
		see: "State diagram",
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
	class: {
		see: "Class diagram",
		reply: fence("mermaid", `
classDiagram
  class Plugin {
    +String id
    +String version
    +activate()
    +deactivate()
  }
  class Runtime {
    +Limits limits
    +install(source)
    +start(id)
  }
  class Marketplace {
    +String name
    +Listing[] plugins
  }
  Runtime "1" --> "*" Plugin : runs
  Runtime --> Marketplace : reads
  Marketplace o-- Plugin : lists
`, "How the pieces relate:"),
	},
	er: {
		see: "Entity relationship diagram",
		reply: fence("mermaid", `
erDiagram
  PROJECT ||--o{ THREAD : has
  THREAD ||--|{ TURN : takes
  THREAD }o--o| WORKTREE : "works in"
  PROJECT {
    string id
    string dir
  }
  THREAD {
    string id
    string title
    string status
  }
`, "The tables:"),
	},
	gantt: {
		see: "Gantt chart",
		reply: fence("mermaid", `
gantt
  title The marketplace
  dateFormat YYYY-MM-DD
  section Catalog
  Repository and CI      :done, a1, 2026-10-26, 2d
  GitHub mirror          :done, a2, after a1, 1d
  section Swarm
  Built-in catalog       :active, b1, 2026-10-27, 3d
  Reviewed marks         :b2, after b1, 2d
  section Plugins
  Inline visualizations  :c1, 2026-10-28, 4d
`, "Where it stands:"),
	},
	git: {
		see: "Git graph",
		reply: fence("mermaid", `
gitGraph
  commit id: "init"
  branch marketplace
  commit id: "catalog"
  commit id: "official"
  checkout main
  commit id: "icon"
  merge marketplace
  commit id: "release"
`, "The branches:"),
	},
	mindmap: {
		see: "Mind map",
		reply: fence("mermaid", `
mindmap
  root((Swarm))
    Threads
      Worktrees
      Agents
    Plugins
      Marketplace
      Fences
    Hosts
`, "What Swarm is made of:"),
	},
	timeline: {
		see: "Timeline",
		reply: fence("mermaid", `
timeline
  title Swarm's plugins
  October 21 : Plugin runtime
  October 24 : Plugin UI : Canvas
  October 27 : Marketplaces
  October 28 : Swarm's own catalog : Inline visualizations
`, "How it got here:"),
	},
	xychart: {
		see: "XY chart",
		reply: fence("mermaid", `
xychart-beta
  title "Installs a week"
  x-axis [w1, w2, w3, w4, w5, w6]
  y-axis "Installs" 0 --> 500
  bar [120, 180, 240, 310, 380, 460]
  line [100, 170, 230, 300, 360, 440]
`, "Installs so far:"),
	},
	quadrant: {
		see: "Quadrant chart",
		reply: fence("mermaid", `
quadrantChart
  title Effort against value
  x-axis Low effort --> High effort
  y-axis Low value --> High value
  quadrant-1 Plan them
  quadrant-2 Do them now
  quadrant-3 Leave them
  quadrant-4 Maybe later
  Math in diagrams: [0.8, 0.45]
  Expand: [0.2, 0.7]
  More kinds: [0.45, 0.85]
  Fence titles: [0.15, 0.3]
`, "What to do next:"),
	},
	sankey: {
		see: "Sankey diagram",
		reply: fence("mermaid", `
sankey-beta
  Agents,Claude Code,52
  Agents,Cursor,31
  Agents,Grok,17
  Claude Code,Merged,40
  Claude Code,Abandoned,12
  Cursor,Merged,22
  Cursor,Abandoned,9
  Grok,Merged,11
  Grok,Abandoned,6
`, "Where the threads went:"),
	},
	journey: {
		see: "User journey",
		reply: fence("mermaid", `
journey
  title Installing a plugin
  section Find it
    Open Settings: 5: User
    Search the store: 4: User
  section Install it
    Read what it asks: 3: User
    Grant it: 4: User, Swarm
  section Use it
    Ask for a chart: 5: User, Agent
`, "The path a user takes:"),
	},
	kanban: {
		see: "Kanban board",
		reply: fence("mermaid", `
kanban
  Todo
    [Math in labels]
    [Fence titles]
  Doing
    [Mermaid through pele]
  Done
    [Official marketplace]
    [Muted icons]
`, "The board:"),
	},
	architecture: {
		see: "Architecture diagram",
		reply: fence("mermaid", `
architecture-beta
  group app(cloud)[Swarm app]
  service window(server)[Window] in app
  service core(database)[Core] in app
  service plugins(disk)[Plugin runtime] in app
  service github(internet)[GitHub]
  window:R -- L:core
  core:R -- L:plugins
  plugins:B -- T:github
`, "Where the pieces run:"),
	},
	c4: {
		see: "C4 diagram",
		reply: fence("mermaid", `
C4Context
  title Swarm's marketplace
  Person(user, "User", "Installs plugins")
  System(swarm, "Swarm", "Runs agents and plugins")
  System_Ext(github, "GitHub", "Hosts the catalog")
  Rel(user, swarm, "Browses the store in")
  Rel(swarm, github, "Reads marketplace.json from")
`, "The context:"),
	},
	block: {
		see: "Block diagram",
		reply: fence("mermaid", `
block-beta
  columns 3
  fence["Fence"] space parse["pele"]
  space:3
  draw["Canvas"] space window["Window"]
  fence --> parse
  parse --> draw
  draw --> window
`, "The blocks:"),
	},
	"math-quadratic": {
		see: "Math",
		reply: fence("math", String.raw`
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
`, "The roots:"),
	},
	"math-calculus": {
		see: "Math",
		reply: fence("math", String.raw`
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}, \qquad \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}, \qquad \lim_{h \to 0} \frac{f(x+h) - f(x)}{h}
`, "A few classics:"),
	},
	"math-matrix": {
		see: "Math",
		reply: fence("math", String.raw`
A = \begin{pmatrix} a_{11} & a_{12} & \cdots & a_{1n} \\ a_{21} & a_{22} & \cdots & a_{2n} \\ \vdots & \vdots & \ddots & \vdots \\ a_{m1} & a_{m2} & \cdots & a_{mn} \end{pmatrix},
\quad \det\begin{bmatrix} a & b \\ c & d \end{bmatrix} = ad - bc
`, "The matrix:"),
	},
	"math-cases": {
		see: "Math",
		reply: fence("math", String.raw`
|x| = \begin{cases} x & \text{if } x \ge 0 \\ -x & \text{otherwise} \end{cases}
\qquad
\begin{aligned} (a+b)^2 &= a^2 + 2ab + b^2 \\ &\le 2\left(a^2 + b^2\right) \end{aligned}
`, "Piecewise, and aligned:"),
	},
	"math-symbols": {
		see: "Math",
		reply: fence("math", String.raw`
\forall \varepsilon > 0\ \exists \delta > 0 : |x - a| < \delta \Rightarrow |f(x) - L| < \varepsilon,
\quad \mathbb{R}^n, \ \mathcal{O}(n \log n), \ \hat{\theta}, \ \vec{v} \cdot \overline{w}, \ \sqrt[3]{x}, \ A \xrightarrow{\ f\ } B,
\ \left\{ \frac{p}{q} \,\middle|\, q \neq 0 \right\}
`, "The symbols:"),
	},
	"mermaid-math": {
		see: "Flowchart",
		reply: fence("mermaid", `
flowchart LR
  A["$$x^2 + y^2 = r^2$$"] --> B["$$\\frac{dy}{dx} = -\\frac{x}{y}$$"]
  B --> C[Slope of the tangent]
`, "Implicit differentiation:"),
	},
	"mermaid-pie": {
		see: "Pie chart",
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
		see: "Picture",
		reply: fence("svg", `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 120" width="340" height="120" font-family="sans-serif">
  <title>Three stages</title>
  <rect x="4" y="30" width="92" height="60" rx="10" fill="#2a78d6"/>
  <rect x="124" y="30" width="92" height="60" rx="10" fill="#eb6834"/>
  <rect x="244" y="30" width="92" height="60" rx="10" fill="#1baf7a"/>
  <path d="M96 60h28M216 60h28" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>
  <g fill="#fff" font-size="14" font-weight="600" text-anchor="middle">
    <text x="50" y="65">Parse</text>
    <text x="170" y="65">Lay out</text>
    <text x="290" y="65">Draw</text>
  </g>
  <text x="170" y="112" text-anchor="middle" font-size="12" fill="currentColor" opacity="0.6">each fence, as it arrives</text>
</svg>`, "The three stages:"),
	},
};
