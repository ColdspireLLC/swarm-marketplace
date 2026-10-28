---
name: inline-vis
description: "Show a chart, a diagram (flowchart, sequence, state, pie) or an SVG picture drawn inline in your reply in Swarm, with a ```chart, ```mermaid or ```svg fence. Use it when data, a flow, an architecture or a comparison reads better as a picture than as text or a table."
---

# Inline visualizations

Swarm draws three kinds of fenced block in your replies. Write the fence in
your message, not in a file: Swarm replaces it with the drawing, and the
user can switch to its data or its source.

Use one when it says more than prose would: numbers over time or across
categories, a share of a whole, how parts connect, who calls whom. Keep
the text that explains what the picture shows; don't draw what one
sentence says.

## ```chart

A JSON object. `type` is `bar`, `line`, `area`, `scatter`, `pie` or `donut`.

```chart
{
  "type": "bar",
  "title": "Test runs this week",
  "x": ["Mon", "Tue", "Wed", "Thu", "Fri"],
  "series": [
    { "name": "Passed", "data": [42, 38, 51, 47, 55] },
    { "name": "Failed", "data": [3, 6, 2, 4, 1] }
  ],
  "stacked": true,
  "unit": "runs"
}
```

- `x`: the categories (or numbers) along the axis. `series`: up to 8,
  each `{ "name", "data" }` with a number (or `null`) per `x`.
- Options: `title`, `subtitle`, `unit` (`"ms"`, `"%"`, `"$"`…), `xLabel`,
  `yLabel`, `min`, `max`, `height` (pixels, 160 to 720), `stacked` (bar,
  area), `horizontal` (bar: long category names read better this way).
- `scatter`: each series' `data` is `[x, y]` pairs. Keep it to 3 series.
- `pie` and `donut`: `"data": [{ "label": "Go", "value": 62 }, …]`.
  Past 8 slices the smallest fold into Other. Prefer a bar chart when
  slices are close in size or there are more than 5.
- One measure per chart: never two y-axes. Two measures of different
  scale are two charts.

## ```mermaid

Mermaid's syntax, for these kinds:

- `flowchart TD` (or `LR`, `BT`, `RL`; `graph` too): nodes `A[box]`,
  `B(rounded)`, `C([stadium])`, `D{decision}`, `E((circle))`,
  `F[(database)]`, `G[[subroutine]]`, `H{{hexagon}}`; edges `-->`, `---`,
  `-.->`, `==>`, `--x`, `--o`, `<-->`, labels as `-->|yes|` or
  `-- yes -->`; chains `A --> B --> C`, `A & B --> C`; `subgraph … end`.
- `sequenceDiagram`: `participant`/`actor … as …`, messages `->>`, `-->>`,
  `->`, `-->`, `-x`, `-)`, with `+`/`-` to activate; `Note left of`,
  `right of`, `over A,B`; `loop`, `alt`/`else`, `opt`, `par`/`and`,
  `critical`, `break`, `rect`, each closed by `end`; `autonumber`.
- `stateDiagram-v2`: `[*] --> A`, `A --> B : event`,
  `state "Long name" as A`, composite `state A { … }`, `<<choice>>`,
  `<<fork>>`, `direction LR`.
- `pie`: `title …`, then `"Label" : value` lines.

Styling (`classDef`, `style`, `linkStyle`) and `click` are ignored:
Swarm draws in its own theme. Other Mermaid kinds (class, ER, Gantt…)
show as their source; draw those another way.

Keep labels short (a few words), and diagrams under about 30 nodes: a
wide one is scaled down to fit the reply.

## ```svg

A whole `<svg …>…</svg>`, drawn as a picture. Give it a `viewBox` and a
`width`, and a `<title>` saying what it shows. Use it for what neither a
chart nor a diagram fits. It doesn't follow the light and dark themes,
so give it a background that reads on both, or none.
