# Proxmox

Proxmox VE servers and clusters in Swarm, through their API
(`/api2/json`), signed in with an API token or a user's password (and a
TOTP code where there's a second factor).

- **Its page** (the rail's Proxmox), with a sidebar of views:
  - **Overview**: nodes online, guests running, the cluster's CPU and
    memory; what needs attention (a node offline, a guest locked, a
    storage 90% full); each node with its CPU and memory; the busiest
    guests; the last tasks, a failed one's log a click away.
  - **VMs & containers**: every guest, by node, filtered (running,
    stopped, templates) and searched by name, vmid, tag or node.
  - **Tasks**: the cluster's recent tasks, running ones on top, each
    one's log.
  - **Backups**: each guest's last backup, oldest first, those never
    backed up or not in a week marked; a guest opens on its backups.
  - **Storage**: each storage of each node, and how full it is.
  - **Each node**: its CPU, memory, swap and root disk, CPU model, load,
    I/O wait, Proxmox and kernel versions, graphs (hour, day, week), its
    guests and its syslog; Shell opens Proxmox's, Reboot and Shut down
    ask first.

  A guest opens beside the view: Start, Resume, Console (Proxmox's noVNC
  or xterm.js), Shut down, Reboot, and in More, Pause, Take snapshot,
  Back up now, Clone, Move to another node, Edit, Copy vmid, Stop at
  once; each that takes it down asks first. A template has New guest
  from it (a linked clone, or a full copy). Its tabs:
  Summary (CPU, memory, disk, its addresses from the guest agent or the
  container, graphs of CPU, memory, network and disk I/O), Hardware
  (cores, memory, disks, networks, OS type, BIOS, agent, start at boot,
  its notes), Snapshots (take one, with a VM's memory if it runs; roll
  back or delete one, after asking), Backups (each one's storage, size,
  verification; Back up now to a storage in a mode; Restore as a new
  guest or over it once it's stopped; Delete, after asking) and Tasks.
  Edit changes its name, cores, memory, tags and start at boot. Each action follows its
  task to its end, with a toast, or says why it failed.
- **Kept current** while the page shows: the resources every 10 s, and
  the guest or node opened.
- **Several servers**: each one named, in Settings; the sidebar's
  Servers switch between them, and every command takes `--server`.
  Each server's backups are watched every three minutes, the page open
  or not, and a backup that fails is a toast saying where and why.
- **Consoles in Swarm**: a container's Console, a node's Shell, and a
  VM's serial console (with a `serial0`), each a tab where its guest or
  node is, Swarm's own terminal typed into in place (`ui.terminal`),
  through Proxmox's terminal proxy (`console.ts`; its protocol in
  `consoleproto.ts`). A VM's screen opens in Proxmox's page.
- **A node's disks**: each one's model, size, wear and SMART health; a
  failing or worn-out one under the overview's Needs attention; its
  SMART attributes, or what smartctl printed, under it.
- **Its page of Settings** connects them: the address (a bare host is
  `https://HOST:8006`), and a token's ID and secret, or a user and
  password: a ticket, renewed hourly with itself, so a second factor's
  code is asked only when it lapses (Swarm closed past two hours), on
  the page. Secrets and tickets are kept in the keychain. Proxmox's own certificate, which no authority signed, is
  shown by its fingerprint to compare with the one in Proxmox, and
  trusted once the user says so: that one alone, by Swarm's
  `fetch(url, { certificate })`. Another one later is shown, not taken.
- **For agents**, `swarm proxmox` (`status`, `list`, `show`, `start`,
  `shutdown`, `reboot`, `stop`, `suspend`, `resume`, `snapshots`,
  `snapshot`, `rollback`, `delete-snapshot`, `backups`, `backup`,
  `clone`, `migrate`, `set`, `nodes`, `storage`,
  `tasks`, `task-log`), and a skill. Actions wait for their task and
  exit 1 when it fails. GUEST is a vmid or a name.

- `pve.ts`: the API client, and what's worked out from its answers:
  states, a guest by name, a configuration in rows, sizes and times.
- `store.ts`: what's read, kept current, and the actions.
- `page.tsx`, `view.tsx`: the page, its meters and graphs.
  `actions.tsx`: backups, clone, move and edit, and the Backups view.
- `servers.ts`: the servers, their secrets and which is shown.
  `watch.ts`: the backups' watch.
- `settings.tsx`: its page of Settings. `cli.ts`: the command line.
  `skills/proxmox/SKILL.md`, `AGENTS.md`: for agents.

```
swarm plugin test .      # a fake Proxmox: the command line, and the page in a window
swarm plugin link .      # run it in your Swarm as you change it
```
