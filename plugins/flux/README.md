# Flux

Flux issues in Swarm, ported from bb's Flux plugin (SWARM-132) with
Swarm's SDK (docs/sdk.md). Agents read and update issues with
`swarm flux …`, as bb's agents do with `bb flux …` (its skill says how);
a thread attached to an issue (`swarm flux start ABC-12`, or its Flux
panel) is told to keep it current; `::flux{key="ABC-12"}` in a reply shows
the issue's card.

What carries over as it was: the Flux client, Markdown and HTML
(`marked`, `turndown`), descriptions written into the issue's live Yjs
document through Flux's WebSocket (`yjs`, TipTap's schema, `domino` for a
DOM), the prompts and the CLI's output. What's Swarm's: the copy of the
workspace in the plugin's storage, kept live on Flux's event stream
(`GET /sync/events`, and a pull every half minute where a Flux has no
stream); the board and the issue page; descriptions and comments in the
editor Swarm draws; several Flux connections; uploads. `swarm flux`
takes `--flux NAME` for one of them. A thread started on an issue is
linked both ways, and the issue's status follows that thread's merge
request.

```
swarm plugin install examples/plugins/flux
swarm plugin set flux url https://flux.example.com
swarm plugin set flux token -           # paste a token (Flux: Settings, API tokens), then Ctrl+D
swarm plugin grant flux --all
swarm plugin enable flux
swarm flux status
```

`.swarm-bundle.js` is the plugin bundled, kept so that it runs without its
`node_modules`. After changing its sources, `npm ci` here and
`go test ./internal/plugins -run TestExampleBundles -update-bundles`.
`swarm plugin test examples/plugins/flux` runs its tests against a Flux of
the test's own.
