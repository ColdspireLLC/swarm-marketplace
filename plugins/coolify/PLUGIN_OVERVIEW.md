Your self-hosted Coolify in Swarm. Its page has an overview of what's running, what needs attention and what's deploying, every deployment, each Coolify project's apps by environment, and your servers. Open an app to deploy, restart, stop or roll it back, read each deployment's build log, follow its logs live, and manage its environment variables: add, edit, delete, paste a whole .env file or copy them all as one, values hidden until you show one, with a Redeploy button once they change.

Every deployment is watched, whoever started it, including a push's webhook, and a toast says how it ended. When one fails, Ask an agent to fix it opens a thread with the failing log, in the project the app is built from.

In a thread of a project Coolify deploys, the app's state and last deployment sit above the composer with a Deploy button, and the agent knows which app it is: swarm coolify deploy --wait is all it takes.

Agents get swarm coolify (list, show, deploy, start, stop, restart, rollback, deployments, deployment-log, logs, env, env-set, env-unset) and a skill. Turn on Let agents set things up and they also get Coolify's own MCP server (Coolify 4.5 or later), to create apps, databases and services; requests go through Swarm, which adds the token, so it never lands in an agent's configuration.

Connect it in Settings, Coolify, with your Coolify's URL and an API token from Keys & Tokens (read and deploy; read:sensitive for logs and env values; write for agents that create things). The token is kept in your keychain. It works with Coolify v4, on the internet or on your own network.
