#!/bin/bash
# Double-click to start Resume Bricks on macOS. Close this window to stop it.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org, then double-click this file again."
  read -r -p "Press Return to close."
  exit 1
fi
[ -d node_modules/yaml ] && [ -d node_modules/unpdf ] && [ -d node_modules/mammoth ] && [ -d node_modules/jszip ] || npm install --silent
npm start
