---
name: inline-vis
description: "Show a chart, a Mermaid diagram (flowchart, sequence, class, state, ER, Gantt, git graph, mind map, timeline and more) or an SVG picture drawn inline in your reply in Swarm, with a ```chart, ```mermaid or ```svg fence. Use it when data, a flow, an architecture or a comparison reads better as a picture than as text or a table."
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

Mermaid's syntax, drawn by pele (the renderer t3code uses) in Swarm's own
colours, light and dark. Every common kind works: `flowchart`/`graph`,
`sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`,
`gantt`, `pie`, `gitGraph`, `mindmap`, `timeline`, `journey`,
`xychart-beta`, `quadrantChart`, `sankey-beta`, `kanban`, `block-beta`,
`packet-beta`, `architecture-beta`, `radar-beta`, `treemap-beta`,
`requirementDiagram` and C4 (`C4Context`…), with subgraphs, notes,
activations, frames and edge labels as Mermaid has them.

- Prefer a ```` ```chart ```` for numbers: it has hover values and a data
  table. Use Mermaid's `pie` and `xychart-beta` when the reply is already
  Mermaid.
- `classDef`, `style` and themes are drawn as Swarm's colours; links and
  images in a diagram are not followed or shown.
- Keep labels short and diagrams under about 40 nodes. A wide one scales
  down in the reply; the user can expand it to the window.

## ```svg

A whole `<svg …>…</svg>`, for what neither a chart nor a diagram fits.
Give it a `viewBox` and a `width`, and a `<title>` saying what it shows.
Shapes, paths, text and transforms are drawn as Swarm draws its own, and
`currentColor` is the theme's text colour, so use it for lines and words
that must read on light and dark alike. Gradients, clip paths, masks,
`<use>` and images are drawn too, but then its text isn't: keep those
pictures wordless.
