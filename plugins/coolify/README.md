# Coolify

A self-hosted [Coolify](https://coolify.io) in Swarm, through its API (v4,
`/api/v1`) and, for agents that set things up, its own MCP server.

- **Its page** (the rail's Coolify), with a sidebar of views:
  - **Overview**: how many run, what needs attention (unhealthy, or whose
    last deployment failed), what's deploying now, the last deployments
    of every application, and which of Swarm's projects Coolify runs.
    Search finds an app by name, domain, project or uuid. New app… hands
    an agent the setup, when agents have Coolify's MCP server.
  - **Deployments**: every application's last five, what runs on top.
  - **Each of Coolify's projects**: its resources by environment.
  - **Servers**: each one, reachable or not, and what runs on it.

  A resource opens beside the view: Deploy, Restart, and in More, Rebuild
  without cache, Start, Stop, Ask an agent about it; a banner when its
  last deployment failed, with Ask an agent to fix it; and its tabs:
  Overview (status, domains, source, build pack, the commit running, the
  last deployment, ports, health check, its Swarm project), Deployments
  (each one's build log, Cancel, Roll back to this), Logs (the last 300
  lines, filtered, Live every 5 s) and Environment: each variable hidden
  until shown, copied, edited (name, value, build time, runtime,
  multiline, literal, hidden once saved, previews) or deleted after a
  second press; Add variable; Paste .env… (a file's variables at once,
  saying how many are new and how many change); Copy as .env; and a note
  offering to redeploy, as Coolify uses changed variables from the next
  deploy. Production's and previews' apart. Changing them needs a token
  with write.
- **Watching**: every deployment that runs, whoever started it (a button,
  an agent, a push's webhook), asked about every 20 s, every 3 s while
  one runs; a toast as each ends, a failed one's leading to its log. The
  rail's button counts what's deploying.
- **In a thread** of a project Coolify deploys (its origin is an
  application's git repository, or a docker image's application's image
  path is under it): a segment above the composer, the application's
  state and last deployment, Deploy at its end, each of its applications
  under it; and a note to the agent naming them.
- **Its page of Settings** connects it, and lets agents use Coolify's MCP
  server (Coolify 4.5 on) through the plugin's route on this machine,
  which adds the token: the agents' configuration has a key of the
  plugin's, never Coolify's token.
- **For agents**, `swarm coolify` (`status`, `list`, `show`, `deploy
  [--force] [--wait]`, `start`, `stop`, `restart`, `rollback [--to TAG]`,
  `deployments`, `deployment-log [-f]`, `logs`, `env`, `env-set KEY=VALUE…`,
  `env-unset KEY…`), and a skill. `env` names the variables, never their
  values; the skill has agents leave secrets to the user's Environment tab. A RESOURCE
  is a name, `Project/name` or a uuid, or, left out, the application of
  the project it's run in. `--json` leaves passwords and webhook secrets
  out.

Coolify turned its actions (deploy, start, stop, restart) from GET into
POST late in v4: the plugin POSTs, and asks again with GET on a 405.

The token wants `read` to list, `deploy` to act, `read:sensitive` for logs
and env values, `write` for agents that create things.

- `coolify.ts`: the API client, and what's worked out from its answers:
  statuses, log lines, a resource by name, which repository an
  application is built from, Coolify's times.
- `store.ts`: what's read, the watch, the actions, Swarm's projects.
- `page.tsx`, `view.tsx`: the page. `env.tsx`: its Environment tab. `context.tsx`: the thread's segment
  and the agent's note. `agent.ts`: what Ask an agent sends.
- `settings.tsx`: its page of Settings and the MCP route. `cli.ts`: the
  command line. `skills/coolify/SKILL.md`, `AGENTS.md`: for agents.

```
swarm plugin test .      # a fake Coolify: the command line, the page in a window, the MCP route; link.test.ts alone
swarm plugin link .      # run it in your Swarm as you change it
```
