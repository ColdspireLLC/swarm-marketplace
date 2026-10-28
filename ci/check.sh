#!/usr/bin/env bash
# Checks the catalog as Swarm reads it, and each plugin kept here: its
# entry matches it, it passes swarm plugin check and pack (which hold the
# overview to the listing's rules), and its tests pass.
#
#   ci/check.sh [SWARM]     SWARM is the swarm binary, else the one on PATH
set -euo pipefail
cd "$(dirname "$0")/.."
SWARM=${1:-${SWARM:-swarm}}
JQ=${JQ:-jq}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "== the catalog"
# Under another name: swarm is the one Swarm reads from GitHub itself.
SWARM_DATA_DIR=$work/data "$SWARM" marketplace add . --name swarm-check --yes
SWARM_DATA_DIR=$work/data "$SWARM" marketplace list

# An entry kept in this repository: its folder, its id, its tags' prefix.
here=https://github.com/ColdspireLLC/swarm-marketplace.git
"$JQ" -c '.plugins[]' marketplace.json | while read -r p; do
	id=$("$JQ" -r .id <<<"$p")
	url=$("$JQ" -r '.source.git.url // empty' <<<"$p")
	[ "$url" = "$here" ] || continue
	dir=$("$JQ" -r .source.git.subdir <<<"$p")
	[ "$dir" = "plugins/$id" ] || { echo "$id: its subdir is $dir, not plugins/$id"; exit 1; }
	[ "$("$JQ" -r .id "$dir/plugin.json")" = "$id" ] || { echo "$id: $dir/plugin.json has another id"; exit 1; }
	[ "$("$JQ" -r .source.git.tagPrefix <<<"$p")" = "$id/" ] || { echo "$id: its tagPrefix isn't $id/"; exit 1; }
	[ -n "$("$JQ" -r '.source.git.range // empty' <<<"$p")" ] || { echo "$id: give its source a range, so updates follow its tags"; exit 1; }
done

for dir in plugins/*/; do
	id=$(basename "$dir")
	"$JQ" -e --arg id "$id" '.plugins[] | select(.id == $id)' marketplace.json >/dev/null || { echo "$dir has no entry in marketplace.json"; exit 1; }
	# Committed, not only here: an install from git has only what's committed.
	if [ -f "$dir/package.json" ] && ! git ls-files --error-unmatch "$dir/.swarm-bundle.js" >/dev/null 2>&1; then
		echo "$id has packages but no committed .swarm-bundle.js: an install has no node_modules (ci/bundle.sh $id, then commit it)"
		exit 1
	fi
	echo "== $id"
	(cd "$dir" && "$SWARM" plugin types . >/dev/null && "$SWARM" plugin check . && "$SWARM" plugin pack . -o "$work/$id.zip" && "$SWARM" plugin test .)
done
