Math, charts, diagrams and pictures, drawn right in the agent's reply.

When a number, a flow or a structure reads better as a picture, the agent writes a fenced block, and Swarm draws it in place, in its own colours, light and dark. One click shows the data as a table, another the source; Copy takes the source.

**Charts** (`chart`): bar (grouped, stacked or horizontal), line, area, scatter, pie and donut, from a short JSON spec. Hover a bar or a point for its value. The colours are a palette checked for colour-blind readers in both themes.

**Diagrams** (`mermaid`): every common kind of Mermaid diagram, from flowcharts, sequence, class, state and ER diagrams to Gantt charts, git graphs, mind maps, timelines, sankeys and kanban boards. They're laid out by pele, the renderer t3code uses, and drawn by Swarm itself in its own colours, with no browser behind it. Click one to see it full size.

**Math** (`math`): TeX typeset by KaTeX, the typesetter t3code uses, in its own fonts: fractions, roots, sums and integrals with their limits, matrices, cases and aligned equations. `$$…$$` in a diagram's labels is typeset too.

**Pictures** (`svg`): a whole SVG, its text included, in the theme's colours where it asks for them.

The plugin gives the agents a skill and a line of instructions, so they know the fences and use them when a picture helps. It asks for nothing else: no network, no files, no storage.
