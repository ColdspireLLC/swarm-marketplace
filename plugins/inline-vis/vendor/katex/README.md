KaTeX 0.16.47 (https://katex.org, MIT, LICENSE beside it): its
`dist/katex.mjs` and `dist/fonts/*.ttf` as npm publishes them, kept here
because Swarm installs a plugin from its repository without
`node_modules`. One line is added at the end of `katex.mjs`, exporting
`getCharacterMetrics`: KaTeX combines a run of text into one glyph node
without adding up its width (a browser measures it), and the plugin
measures it from KaTeX's own metrics. `katex.d.mts` is what the plugin
uses of its API.

To update it: `npm pack katex@VERSION`, copy `package/dist/katex.mjs`,
`package/dist/fonts/*.ttf` and `package/LICENSE` here, add the export line
again, change the version above, and run the plugin's tests.
