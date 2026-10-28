pele 1.12.0, Obsidian's Mermaid renderer (https://github.com/obsidianmd/pele,
MIT, LICENSE beside it): its `dist/pele.js` as npm publishes it, kept here
because Swarm installs a plugin from its repository without `node_modules`.
`pele.d.ts` is what the plugin uses of its types.

To update it: `npm pack pele@VERSION`, copy `package/dist/pele.js` and
`package/LICENSE` here, change the version above, and run the plugin's tests.
