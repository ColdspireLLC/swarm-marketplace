# Swarm's marketplace

The plugins Coldspire reviews for [Swarm](https://gitlab.coldspire.com/coldspire/swarm),
and the catalog Swarm reads them from. Every Swarm lists it first, as
**Swarm**, under Settings, Plugins, Marketplaces, and installs from it
with `swarm plugin install marketplace:swarm/ID`.

It lives on GitLab, [coldspire/swarm-marketplace](https://gitlab.coldspire.com/coldspire/swarm-marketplace),
and is mirrored to GitHub, [coldspire/swarm-marketplace](https://github.com/coldspire/swarm-marketplace),
which is where Swarm reads it:
`https://raw.githubusercontent.com/coldspire/swarm-marketplace/main/marketplace.json`.

## What's here

- `marketplace.json`: the catalog, as Swarm's `docs/plugins.md` (Marketplaces)
  describes it. Each entry names its plugin's source: a git repository
  and a range of its tags, or an npm package.
- `plugins/ID/`: the plugins Coldspire keeps here. Each is released as a
  tag `ID/vX.Y.Z` of this repository, which its entry follows with
  `"subdir": "plugins/ID"`, `"tagPrefix": "ID/"` and a range.
- `ci/check.sh`: what CI runs on every merge request. It reads the
  catalog as Swarm does, checks that each entry kept here matches its
  plugin, and runs each plugin's `swarm plugin check`, `pack` (which holds
  its `PLUGIN_OVERVIEW.md` to the listing's rules) and `test`.

| Plugin | What it does |
| --- | --- |
| [Inline visualizations](plugins/inline-vis) | Charts, Mermaid diagrams and SVG pictures, drawn in the agent's reply. |

## Listing a plugin

Open a merge request that adds your plugin's entry to `marketplace.json`,
with its icon (an SVG, PNG or WebP of 1 MB at most) and its
`PLUGIN_OVERVIEW.md` beside it in `listings/ID/` when its code lives
elsewhere. The code stays in your repository or package: the entry points
at a public git repository and a range of its tags (`"range": "^1.0.0"`),
or an npm package, so updates come as you tag them.

Before you open it:

1. Run your plugin's tests, `swarm plugin check .` and `swarm plugin pack .`.
2. Write its `PLUGIN_OVERVIEW.md`: what it does and what it asks for, in
   plain words, with no title, images, HTML or tables.
3. Ask for what it needs and no more. Coldspire reads the code at the
   tag your range allows, and what it asks to be granted, before it
   merges; a new major version that asks for more is reviewed again.
4. Run `ci/check.sh` with your Swarm: `ci/check.sh $(command -v swarm)`.

## Releasing a plugin kept here

1. Bump `version` in `plugins/ID/plugin.json` and merge it.
2. Tag the merge `ID/vX.Y.Z` (`git tag inline-vis/v1.1.0 && git push origin inline-vis/v1.1.0`).
3. The tag reaches GitHub with the mirror, and Swarms that installed it
   find the update (`swarm plugin outdated`, or the plugin's page).

A tag is never moved: Swarm refuses a tag that points at a new commit.
