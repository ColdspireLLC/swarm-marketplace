---
name: flux
description: "Read, create, and update issues in the Flux tracker with `swarm flux`, including issue keys such as ABC-12, and report progress on the issue you're working on. Use it to track planned work, follow-ups, and plans instead of TODO or plan Markdown files."
---

# Flux

Flux is the team's issue tracker. Use the `swarm flux` command to read issues, keep
them current while you work, and file new ones. Add `--json` to any command
whose output another command or script will read. `swarm flux help` lists the commands.

## Work an issue

1. Read the issue before acting. The output includes the description,
   sub-issues, the latest comments, and a link:

   ```sh
   swarm flux show ABC-12
   ```

   In a thread that is attached to an issue (from its Flux panel, or after
   `swarm flux start`), you can drop the key: `swarm flux show`.

   Images in the issue read `[Image N]`: Flux shows them only to its
   members, so look at them with the Flux plugin's `issue_images` tool (`flux_issue_images`) rather than
   fetching a link.

2. If you're taking on work that didn't start from Flux, attach this thread.
   That moves a Backlog or Todo issue to In Progress:

   ```sh
   swarm flux start ABC-12
   ```

3. Comment at real milestones, not on every step: a settled plan, a change
   ready to check, or a blocker. Comments are Markdown; `@username` notifies
   that person (`swarm flux members` lists usernames), and a project's key
   (`@ABC`) mentions that project without notifying anyone:

   ```sh
   swarm flux comment ABC-12 --body "Fixed the race in the sync loop; added a regression test. @ada can you check the retry timing?"
   ```

   For a comment over several lines, see [Longer text](#longer-text).

4. When the work is ready for review, say so on the issue:

   ```sh
   swarm flux update ABC-12 --status review
   ```

   Use `--status complete` only when nothing is left to check. If you can't
   finish, leave a comment that explains what's blocking and keep the status.

## Longer text

`--body` and `--description` take Markdown over several lines. Pass it with a
quoted heredoc, which keeps backticks, quotes, and `$` as written:

```sh
swarm flux comment ABC-12 --body "$(cat <<'EOF'
Fixed the race in the sync loop.

- Added a regression test
- `retry()` now backs off
EOF
)"
```

Or from a file: `--body "$(cat notes.md)"`.

## Find and file issues

```sh
swarm flux list                       # open issues in the project linked to this Swarm project
swarm flux list --assignee me --all   # everything assigned to you, closed included
swarm flux list --project ABC --status progress,review
swarm flux list -q "sync"             # search keys and titles
swarm flux create --project ABC --title "Retry pushes after a 409" \
  --description "Steps to reproduce…" --priority high --label Bug
swarm flux create --parent ABC-12 --title "Write the migration"   # sub-issue
```

Statuses: `backlog`, `todo`, `progress`, `review`, `complete`, `canceled`
(`in_progress`, `in_review`, and `done` also work). Priorities: `urgent`,
`high`, `medium`, `low`, `none`.

## Change an issue

```sh
swarm flux update ABC-12 --priority urgent --assign me --add-label Bug
swarm flux update ABC-12 --unassign ada --remove-label Bug --due 2026-11-01
swarm flux update ABC-12 --parent ABC-10     # or --parent none
swarm flux update ABC-12 --title "Clearer title"
swarm flux update ABC-12 --description "$(cat <<'EOF'
## Plan
- [x] Reproduce the race
- [ ] Fix the retry
EOF
)"
```

`--description` replaces the whole description with Markdown (read it with
`swarm flux show` first and keep what still holds). Keep an issue's plan there
and current as it changes, and use comments for progress and questions.

Labels have to exist before you can add them. If the one you want is missing,
check `swarm flux labels` for a close match (`Bug` rather than `Bugs`) before
making a new one, then create it on its own or as you add it:

```sh
swarm flux labels create Feature --color green   # color is optional
swarm flux update ABC-12 --add-label Feature --create-labels
swarm flux create --project ABC --title "…" --label Feature --create-labels
```

Colors: `gray`, `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `indigo`,
`purple`, `pink`. Without `--color`, a new label gets the color fewest labels
use, as in Flux.

## Other commands

- `swarm flux projects`, `swarm flux labels`, `swarm flux members` list what you can
  refer to. `swarm flux labels create <name>` adds a label.
- `swarm flux open ABC-12` prints the issue's link in the Flux web app. Share it
  instead of pasting the whole issue.
- To show an issue in your reply, put `::flux{key="ABC-12"}` on its own line.
  Swarm shows it as a card with the issue's status and assignees.
- `swarm flux link ABC` links a Flux project to this thread's Swarm project,
  so `swarm flux list` and `swarm flux create` default to it there.
- `swarm flux detach ABC-12` detaches this thread from an issue.
- `swarm flux status` shows whether Swarm is connected to Flux. If commands
  fail saying Flux isn't set up, tell the user to set its URL and API token in
  Settings, Plugins, Flux, rather than retrying.
- While Flux can't be reached, reads answer from Swarm's last synced copy;
  changes fail saying so: try them again once it's back.
