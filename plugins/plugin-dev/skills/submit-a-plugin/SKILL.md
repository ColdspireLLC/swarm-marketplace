---
name: submit-a-plugin
description: "Prepare and submit a Swarm plugin to Swarm's marketplace (the catalog Coldspire reviews), when asked to publish or list a plugin there."
---

# Submit a plugin to Swarm's marketplace

Swarm's marketplace is a catalog, `marketplace.json`, in
`coldspire/swarm-marketplace`, mirrored to
https://github.com/ColdspireLLC/swarm-marketplace. Each entry names where
a plugin installs from: a public git repository and a range of its tags,
or an npm package. The code stays in its own repository.

If the user asks only how, explain these steps and change nothing.

## Before any release

A request to submit doesn't approve a release. Before the first push,
tag, npm publish or pull request, show the user the account, the
repository, the commit, the tag or version, and the commands, and get
their yes. Never print or commit a token.

## Steps

1. **Read the catalog's own rules**: its `README.md` (Listing a plugin),
   `marketplace.json`, and an entry or two as examples. They win over
   this skill where they differ.
2. **Check the plugin** in its folder: `swarm plugin test .`,
   `swarm plugin check .`, `swarm plugin pack .`. Fix what fails.
3. **Its listing**: `PLUGIN_OVERVIEW.md` saying what it does and what it
   asks for, in plain words (no title, images, HTML or tables); an icon,
   an SVG glyph in `currentColor` (Swarm tints it) or a PNG, 1 MB at most;
   `plugin.json`'s `description`, one sentence; `author`; and
   `engines.swarm` if it needs a recent Swarm.
4. **Ask for no more than it needs**: Coldspire reads what it's granted
   before listing it.
5. **Its release**: a public git repository with a tag `vX.Y.Z`
   (or `PREFIX/vX.Y.Z` with `tagPrefix`, for a repository of several
   plugins), or an npm package. A plugin with npm packages installed from
   git runs from its kept bundle, `.swarm-bundle.js`, committed (pack it
   and copy the bundle out of the .zip); one published to npm needn't.
6. **The entry**: in a clone of the catalog, add to `marketplace.json`:
   ```json
   { "id": "ID", "displayName": "Name", "description": "One sentence.",
     "icon": "listings/ID/icon.svg", "overview": "listings/ID/PLUGIN_OVERVIEW.md",
     "tags": ["…"], "author": "…",
     "source": { "git": { "url": "https://github.com/OWNER/REPO.git", "range": "^1.0.0" } } }
   ```
   and copy the icon and overview into `listings/ID/`. The `id` is the
   plugin's own.
7. **Check the catalog**: `ci/check.sh $(command -v swarm)`, which reads it
   as Swarm does.
8. **Open the pull request** on GitHub
   (https://github.com/ColdspireLLC/swarm-marketplace), or a merge request
   on Coldspire's GitLab for those who have it, from the user's account,
   with what the plugin does, what it asks for, and how it was tested.
   Coldspire reviews it and brings it into the catalog.

Report the pull request's link, the release it lists, and what the checks
said.
