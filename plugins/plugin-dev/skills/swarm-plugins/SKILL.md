---
name: swarm-plugins
description: "Build, run, test and check a Swarm plugin: a TypeScript module Swarm runs, which adds commands, tools and skills for agents, and panels, pages, code fences and more to the window. Use when asked to make or change a Swarm plugin."
---

# Swarm plugins

A Swarm plugin is a folder: `plugin.json` (its manifest) and its main
module, TypeScript or JavaScript, which Swarm runs in a sandbox of its own
(QuickJS) and bundles with its npm packages as it starts it. It reaches
nothing of the machine but what the user grants it, item by item.

## Make one

```
swarm plugin new ID [DIR]     # a plugin in TypeScript: plugin.json, main.tsx, a test, swarm.d.ts
swarm plugin types [DIR]      # write swarm.d.ts and plugin.schema.json again, for this Swarm
```

`swarm.d.ts` is the whole API, with comments: read it for what a call
takes. Swarm's guide is `docs/sdk.md` (making one) and `docs/plugins.md`
(what a plugin can do) in Swarm's repository; `swarm plugin new` prints
its link.

What a plugin can add:

- **For agents**: commands on the command line (`swarm ID COMMAND`, with
  `defineCli`), tools (`tools` in plugin.json, answered with `tool()`),
  skills (`"skills": "skills"`, a folder of `NAME/SKILL.md`), and lines
  of instructions (`"instructions": "AGENTS.md"`).
- **For the window**, drawn with Swarm's own widgets (`ui.*`, JSX with
  `jsxImportSource: "swarm"`): side panels, pages of Settings, code
  fences (`ui.codeFence`), message directives (`::name{…}`), cards,
  menus, commands in the palette, overlays, a canvas (`ui.canvas`) for
  drawings of its own.
- **Its own**: storage, a SQLite database, settings (secrets kept in the
  keychain), schedules, HTTP routes, threads it starts.

Ask in `permissions` for what it needs and nothing more: hosts it
reaches (`network`), folders (`fs`), programs (`process`), Swarm's API
scopes (`api`), `storage`, `threads`. The user grants each.

## Run it

With Swarm open (or `swarm serve` on its data folder):

```
swarm plugin link .            # add it as it is here, reloaded as it changes
swarm plugin grant ID --all    # or item by item
swarm plugin enable ID
swarm plugin log ID            # its console.log
```

## Test and check it

```
swarm plugin test .            # its NAME.test.ts files, each in a Swarm of its own, headless
swarm plugin check .           # what's wrong with its panels and pages: styles, names, contrast
swarm plugin shot .            # its panels and pages as PNGs, to look at
swarm plugin pack .            # ID-VERSION.zip, as people install it
```

A test imports `swarm/test`: `t.thread("say …")` has Swarm's demo agent
reply with what follows (a fence, a directive), `t.window()` is Swarm's
window to click, read and `screenshot`, `t.run` runs its commands,
`t.server` stands in for a service it reaches. A file importing
`swarm/testing` runs the plugin alone, quickly, its API calls stubbed.

Look at the screenshots before calling UI done, light and dark
(`w.dark(true)`): nothing clipped, overlapping or unstyled, controls in
Swarm's style.

## Publish it

`PLUGIN_OVERVIEW.md` beside plugin.json is its listing: plain text, no
title, no images, HTML or tables, https links, 4000 characters at most
(`swarm plugin pack` checks it). `engines.swarm` is the range of Swarm it
runs on. To list it in Swarm's marketplace, see the submit-a-plugin
skill.
