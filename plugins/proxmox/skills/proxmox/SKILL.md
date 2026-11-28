---
name: proxmox
description: "Look at and act on the user's Proxmox VE: its nodes, VMs and containers, their state, use, addresses and hardware; start, shut down, reboot, stop, pause and resume them; snapshots and backups; clone, move and resize them; and read the cluster's tasks and their logs, with `swarm proxmox`. Use it when asked about a VM, a container, a homelab server or Proxmox itself."
---

# Proxmox

The user's Proxmox VE, connected in Swarm (Settings, Proxmox). Use
`swarm proxmox` for it, not Proxmox's API with curl or `pvesh` over ssh:
the token stays in Swarm. A GUEST is a VM's or container's vmid (`100`)
or its name. Add `--json` where a script reads the output.
`swarm proxmox --help` lists the commands.

## Look

```sh
swarm proxmox status                # connected? version, nodes online, guests running
swarm proxmox list                  # every VM and container: vmid, name, VM/CT, state, node, use, tags
swarm proxmox list --running --node pve1
swarm proxmox show web              # state, use, addresses, hardware, snapshots
swarm proxmox nodes                 # each node: state, uptime, CPU, memory
swarm proxmox storage               # each storage and how full it is
swarm proxmox tasks --guest web     # recent tasks, newest first (--failed, --limit N)
swarm proxmox task-log UPID         # a task's log, to see why it failed
```

A VM's addresses come from its QEMU guest agent: without one, `show`
has none, and the user can install `qemu-guest-agent` in it. To reach a
guest over ssh, take its address from `show`.

## Act

Each action waits for Proxmox's task to end and exits 1 when it fails,
printing how to read its log; `--no-wait` returns at once with its UPID.

```sh
swarm proxmox start web
swarm proxmox shutdown web          # as its power button: the guest shuts itself down
swarm proxmox reboot web
swarm proxmox stop web              # at once, as pulling its plug: prefer shutdown
swarm proxmox suspend web           # pause a VM; resume to carry on
swarm proxmox resume web
```

Ask the user before you shut down, reboot or stop a guest: what it
serves goes down. Starting one is fine when the task needs it.

## Snapshots

```sh
swarm proxmox snapshots web
swarm proxmox snapshot web before-upgrade --description "Before apt upgrade" [--memory]
swarm proxmox rollback web before-upgrade
swarm proxmox delete-snapshot web before-upgrade
```

Take a snapshot before you change a guest in a way that's hard to undo
(an upgrade, a migration of its data), and say its name. A rollback
loses everything since the snapshot, and deleting one can't be undone:
ask the user first, every time.

## Backups

```sh
swarm proxmox backups               # every guest's last backup, and those never backed up
swarm proxmox backups web           # one guest's, newest first, with their volume IDs
swarm proxmox backup web [--storage pbs] [--mode snapshot|suspend|stop]
```

`backup` picks the node's Proxmox Backup Server, else its first storage
that takes backups. `snapshot` mode keeps the guest running; `stop`
takes it down, so ask first. Restoring replaces a guest or makes a new
one: that's for the user, in Swarm's Proxmox page (the guest, Backups).

## Clone, move, change

```sh
swarm proxmox clone debian-template --name app --linked   # a new VM from a template, sharing its disks
swarm proxmox clone web --name web-test [--vmid 120] [--node pve2]
swarm proxmox migrate web pve2      # a running VM moves live; a container restarts there
swarm proxmox set web --cores 4 --memory 8192 --onboot yes --tags "prod web"
```

A clone is made stopped: start it after. A running VM takes new cores
and memory at its next start, unless hotplug is on for them. Moving a
guest, and taking its cores or memory down, are the user's to agree to.

## What it can't do

Deleting guests, restoring backups, changing disks or networks, and a
node's reboot or shutdown are for the user, in Proxmox or Swarm's
Proxmox page. Say what you'd do and leave it to them.
