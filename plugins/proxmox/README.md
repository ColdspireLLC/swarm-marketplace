# Proxmox

A Proxmox VE server or cluster in Swarm, through its API (`/api2/json`)
and an API token.

- **Its page** (the rail's Proxmox), with a sidebar of views:
  - **Overview**: nodes online, guests running, the cluster's CPU and
    memory; what needs attention (a node offline, a guest locked, a
    storage 90% full); each node with its CPU and memory; the busiest
    guests; the last tasks, a failed one's log a click away.
  - **VMs & containers**: every guest, by node, filtered (running,
    stopped, templates) and searched by name, vmid, tag or node.
  - **Tasks**: the cluster's recent tasks, running ones on top, each
    one's log.
  - **Storage**: each storage of each node, and how full it is.
  - **Each node**: its CPU, memory, swap and root disk, CPU model, load,
    I/O wait, Proxmox and kernel versions, graphs (hour, day, week), its
    guests and its syslog; Shell opens Proxmox's, Reboot and Shut down
    ask first.

  A guest opens beside the view: Start, Resume, Console (Proxmox's noVNC
  or xterm.js), Shut down, Reboot, and in More, Pause, Take snapshot,
  Copy vmid, Stop at once; each that takes it down asks first. Its tabs:
  Summary (CPU, memory, disk, its addresses from the guest agent or the
  container, graphs of CPU, memory, network and disk I/O), Hardware
  (cores, memory, disks, networks, OS type, BIOS, agent, start at boot,
  its notes), Snapshots (take one, with a VM's memory if it runs; roll
  back or delete one, after asking) and Tasks. Each action follows its
  task to its end, with a toast, or says why it failed.
- **Kept current** while the page shows: the resources every 10 s, and
  the guest or node opened.
- **Its page of Settings** connects it: the address (a bare host is
  `https://HOST:8006`), the token's ID and its secret (kept in the
  keychain). Proxmox's own certificate, which no authority signed, is
  shown by its fingerprint to compare with the one in Proxmox, and
  trusted once the user says so: that one alone, by Swarm's
  `fetch(url, { certificate })`. Another one later is shown, not taken.
- **For agents**, `swarm proxmox` (`status`, `list`, `show`, `start`,
  `shutdown`, `reboot`, `stop`, `suspend`, `resume`, `snapshots`,
  `snapshot`, `rollback`, `delete-snapshot`, `nodes`, `storage`,
  `tasks`, `task-log`), and a skill. Actions wait for their task and
  exit 1 when it fails. GUEST is a vmid or a name.

- `pve.ts`: the API client, and what's worked out from its answers:
  states, a guest by name, a configuration in rows, sizes and times.
- `store.ts`: what's read, kept current, and the actions.
- `page.tsx`, `view.tsx`: the page, its meters and graphs.
- `settings.tsx`: its page of Settings. `cli.ts`: the command line.
  `skills/proxmox/SKILL.md`, `AGENTS.md`: for agents.

```
swarm plugin test .      # a fake Proxmox: the command line, and the page in a window
swarm plugin link .      # run it in your Swarm as you change it
```
