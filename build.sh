#!/bin/sh
# Packages the workflow for distribution. Only the files Alfred needs are included,
# and zip is used directly so the scripts keep their executable bit.
set -eu

name=alfred-rex-workspaces
output="dist/$name.alfredworkflow"

mkdir -p dist
rm -f "$output"
zip --quiet --recurse-paths "$output" info.plist icon.png lib.js list.js open.js \
  rex/workspace_actions.lua rex/workspaces.example.lua

echo "built $output"
