---
name: coolify
description: "Deploy, restart, stop and start the user's Coolify applications, services and databases, and read their deployments, build logs and container logs, with `swarm coolify`. Use it when asked to ship, deploy or check on something hosted on Coolify, or why a deployment failed."
---

# Coolify

The user's self-hosted Coolify, connected in Swarm (Settings, Coolify).
Use `swarm coolify` for it, not Coolify's API with curl: the token stays
in Swarm. A RESOURCE is a name, `Project/name` where names repeat across
Coolify's projects, or a uuid. Left out, it's the application built from
the project you're in (`swarm coolify status` names it), so in such a
project `swarm coolify deploy --wait` is all it takes. Add
`--json` where a script reads the output. `swarm coolify --help` lists
the commands.

## Look

```sh
swarm coolify list                 # each application, service and database: type, status, uuid, project, domains
swarm coolify show web             # its status, domains, repository, last 5 deployments
swarm coolify deployments web      # an application's last deployments (--limit N)
swarm coolify logs web --lines 200 # its containers' last lines (applications and databases)
```

## Deploy

```sh
swarm coolify deploy web --wait    # prints the build log as it comes; exits 1 when the deployment fails
swarm coolify deploy web --force   # rebuild without the build cache
swarm coolify deployment-log UUID  # a deployment's build log; -f follows it
swarm coolify rollback web         # the images it can roll back to
swarm coolify rollback web --to TAG --wait
```

Coolify builds what's pushed to the branch it watches: push the commit
first, then deploy, and use `--wait` so you see whether it worked. When
a deployment fails, read its log (`deployment-log`), fix what it says,
push, and deploy again.

## Set things up

When the user has let agents use Coolify's MCP server (Settings, Coolify),
you have its tools, named `coolify` among your MCP servers: create
applications from a repository, databases, services from templates, env
vars, domains, backups, scheduled tasks, rollbacks. Start with its
`coolify_help` tool, which gives step-by-step recipes (topic
`deploy_app_from_git`, `add_database_to_app`…), and `search_resources`
to find something by name or domain.

- Put the user's secrets in env vars through those tools or the user,
  never in a commit or a reply.
- A tool that destroys something wants `confirm=true`: ask the user
  first, every time.
- Deploy with `swarm coolify deploy RESOURCE --wait` even then: the MCP
  server never returns a full build log, and this does.

Without those tools, say what you'd set up and that the user can turn
them on in Swarm, Settings, Coolify (Let agents set things up).

## Environment variables

```sh
swarm coolify env                       # this project's application's variables: names and how they're used, never values
swarm coolify env-set NODE_ENV=production LOG_LEVEL=info [--app RESOURCE] [--build-only|--runtime-only] [--literal]
swarm coolify env-unset OLD_FLAG [--app RESOURCE]
```

Coolify uses changed variables from the next deploy: deploy with `--wait`
after. Don't put a secret (a password, an API key, a database URL with
its password) in a command: ask the user to add it in Swarm's Coolify
page (the app, Environment, Add variable or Paste .env…), so it never
reaches the thread.

## Start, stop, restart

```sh
swarm coolify restart web
swarm coolify stop main-db
swarm coolify start main-db
```

Stopping takes a live service down: do it only when the user asked.

## When it fails

- "Coolify isn't connected": tell the user to connect it in Swarm,
  Settings, Coolify.
- "refused the token", or logs missing: the token needs more in Coolify's
  Keys & Tokens: `read` to list, `deploy` to act, `read:sensitive` for logs.
