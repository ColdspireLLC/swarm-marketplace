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
request. The sidebar's projects drag into a new order, as Flux's.

Its page of Settings (Settings, Plugins, Flux; or Flux settings… in the
board's Flux menu) connects it: a Flux's URL and an API token, tried with
Flux before they're kept, more Fluxes beside it, Resync and Disconnect,
and the Flux projects: each one's icon, Delete, and which
Swarm project its agents work in. New project (there, in the board's
project menu, or the palette) makes one as Flux's own dialog does: its
name, a key from the name until one's typed, and an icon in one of
Flux's colors or an emoji, from Swarm's gallery. A project's settings
(the board's project menu) rename it, change its mark, and change its
key, the old one kept, so ABC-12 still finds its issue. A Flux on
your own network, a LAN's address or Tailscale's, needs Reach your own
network granted (Settings, Plugins, Flux), as Swarm keeps plugins off
your network unless you say. From the
command line:

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
