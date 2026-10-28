# Inline visualizations

A Swarm plugin that draws an agent's ```` ```math ````, ```` ```chart ````, ```` ```mermaid ```` and
```` ```svg ```` fences in its reply, with Swarm's own canvas: no browser,
no network. A drawing expands to the window on a click. `skills/inline-vis/SKILL.md` is what the agents read, and the
fences' whole syntax.

- `main.tsx`: the fence's frame (its views: the drawing, its data as a
  table, its source; Copy), and a cache of what's drawn.
- `src/chart.ts`: charts from a JSON spec, in dataviz's validated
  palette, with light and dark steps.
- `src/mermaid.ts`: Mermaid's diagrams, laid out by pele
  (`vendor/pele`, Obsidian's renderer, MIT), measured with Inter's widths.
- `src/math.ts`: TeX through KaTeX (`vendor/katex`, MIT, with its fonts):
  KaTeX's HTML tree read as its CSS lays it out, into glyphs, rules and
  paths, drawn in KaTeX's fonts (the canvas's `font`, Swarm 0.1.0 on),
  or written as SVG for pele's `$$…$$` labels.
- `src/svgcanvas.ts`: an SVG drawn with the canvas's commands, text
  included, pele's colours as Swarm's (Swarm's own SVG pictures have no
  text).
- `src/text.ts`: Inter's advances, since a canvas can't measure text.

```
swarm plugin types .     # swarm.d.ts, for your editor and tsc
swarm plugin test .      # parse.test.ts, quick; window.test.ts draws samples.ts in the window, to test-shots/
swarm plugin link .      # run it in your Swarm as you change it
```
