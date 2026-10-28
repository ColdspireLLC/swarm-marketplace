# Inline visualizations

A Swarm plugin that draws an agent's ```` ```chart ````, ```` ```mermaid ```` and
```` ```svg ```` fences in its reply, with Swarm's own canvas: no browser,
no network. `skills/inline-vis/SKILL.md` is what the agents read, and the
fences' whole syntax.

- `main.tsx`: the fence's frame (its views: the drawing, its data as a
  table, its source; Copy), and a cache of what's drawn.
- `src/chart.ts`: charts from a JSON spec, in dataviz's validated
  palette, with light and dark steps.
- `src/flow.ts`, `src/sequence.ts`, `src/diagram.ts`: Mermaid's
  flowcharts, state, sequence and pie diagrams, read and drawn.
- `src/layout.ts`: a layered graph layout (ranks, fewer crossings, nodes
  over their neighbours, subgraphs kept whole).
- `src/text.ts`: Inter's advances, since a canvas can't measure text.

```
swarm plugin types .     # swarm.d.ts, for your editor and tsc
swarm plugin test .      # parse.test.ts, quick; window.test.ts draws samples.ts in the window, to test-shots/
swarm plugin link .      # run it in your Swarm as you change it
```
