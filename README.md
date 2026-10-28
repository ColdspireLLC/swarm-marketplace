# Swarm's marketplace

The plugins Coldspire reviews for [Swarm](https://gitlab.coldspire.com/coldspire/swarm),
and the catalog Swarm reads them from. Every Swarm lists it first, as
**Swarm**, under Settings, Plugins, Marketplaces, and installs from it
with `swarm plugin install marketplace:swarm/ID`.

It lives on GitLab, [coldspire/swarm-marketplace](https://gitlab.coldspire.com/coldspire/swarm-marketplace),
and is mirrored to GitHub, [ColdspireLLC/swarm-marketplace](https://github.com/ColdspireLLC/swarm-marketplace),
which is where Swarm reads it:
`https://raw.githubusercontent.com/ColdspireLLC/swarm-marketplace/main/marketplace.json`.

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
| [Flux](plugins/flux) | Flux issues in Swarm, for you and your agents. |

Swarm's own plugins, Inline visualizations, Plugin development and the
Thread list, come with Swarm and are kept in its repository
([`plugins/`](https://gitlab.coldspire.com/coldspire/swarm/-/tree/main/plugins)),
not here: they're updated with Swarm, and their IDs are reserved.

## Listing a plugin

Open a pull request on GitHub,
[ColdspireLLC/swarm-marketplace](https://github.com/ColdspireLLC/swarm-marketplace),
or a merge request on Coldspire's GitLab if you have it there. It adds
your plugin's entry to `marketplace.json`, with its icon (an SVG glyph in
`currentColor`, which Swarm tints, or a PNG; 1 MB at most) and its
`PLUGIN_OVERVIEW.md` in `listings/ID/`. The code stays in your repository
or package: the entry points at a public git repository and a range of
its tags (`"range": "^1.0.0"`), or an npm package, so updates come as you
tag them. GitHub is a mirror, so Coldspire brings a pull request there
into GitLab, where it's merged, and it comes back with the mirror.

The **Plugin development** plugin, which comes with Swarm, gives an agent the
`submit-a-plugin` skill, which does all of this with you.

Before you open it:

1. Run your plugin's tests, `swarm plugin check .` and `swarm plugin pack .`.
2. Write its `PLUGIN_OVERVIEW.md`: what it does and what it asks for, in
   plain words, with no title, images, HTML or tables.
3. Ask for what it needs and no more. Coldspire reads the code at the
   tag your range allows, and what it asks to be granted, before it
   merges; a new major version that asks for more is reviewed again.
4. A plugin with npm packages installed from git runs from its kept
   bundle, `.swarm-bundle.js`: commit it (`swarm plugin pack`, and copy
   it out of the .zip).
5. Run `ci/check.sh` with your Swarm: `ci/check.sh $(command -v swarm)`.

Swarm reads the catalog from GitHub's raw files, which GitHub caches for
five minutes: a change reaches Swarms within that, as they read it again.

## Releasing a plugin kept here

1. Bump `version` in `plugins/ID/plugin.json`. A plugin with packages
   (a `package.json`) runs from its kept bundle, as an install has no
   `node_modules`: write it with `ci/bundle.sh ID` and commit it. Merge.
2. Tag the merge `ID/vX.Y.Z` (`git tag flux/v1.1.0 && git push origin flux/v1.1.0`).
3. The tag reaches GitHub with the mirror, and Swarms that installed it
   find the update (`swarm plugin outdated`, or the plugin's page).

A tag is never moved: Swarm refuses a tag that points at a new commit.
