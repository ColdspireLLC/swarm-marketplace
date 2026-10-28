#!/usr/bin/env bash
# Writes a plugin's kept bundle (.swarm-bundle.js): its main and the
# packages it imports in one module, which an install from this
# repository runs, as it has no node_modules. Run it for a plugin with a
# package.json after changing its code or its packages, and commit the
# bundle with them.
#
#   ci/bundle.sh ID [SWARM]
set -euo pipefail
cd "$(dirname "$0")/.."
id=${1:?give the plugin's id}
SWARM=${2:-${SWARM:-swarm}}
dir=plugins/$id
[ -f "$dir/package.json" ] || { echo "$id has no packages: it runs as it is, with no bundle"; exit 0; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
(cd "$dir" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null && rm -f .swarm-bundle.js && "$SWARM" plugin pack . -o "$work/p.zip" >/dev/null)
unzip -q -o "$work/p.zip" .swarm-bundle.js -d "$dir"
echo "wrote $dir/.swarm-bundle.js ($(wc -c <"$dir/.swarm-bundle.js") bytes)"
