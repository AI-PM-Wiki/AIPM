#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
mkdir -p meta/toc-regression

uv run mkdocs build -q -d meta/toc-regression/site-default
uv run mkdocs build -q -f test/toc/features.yml

python3 -m http.server 8765 --bind 127.0.0.1 --directory meta/toc-regression/site-default >meta/toc-regression/default.log 2>&1 &
default_pid=$!
python3 -m http.server 8766 --bind 127.0.0.1 --directory meta/toc-regression/site-features >meta/toc-regression/features.log 2>&1 &
features_pid=$!
trap 'kill "$default_pid" "$features_pid" 2>/dev/null || true' EXIT

for attempt in $(seq 1 30); do
  kill -0 "$default_pid" "$features_pid"
  if curl --silent --fail http://127.0.0.1:8765/ai/evaluation/ >/dev/null &&
     curl --silent --fail http://127.0.0.1:8766/ai/evaluation/ >/dev/null; then
    break
  fi
  sleep 0.2
done
kill -0 "$default_pid" "$features_pid"
curl --silent --fail http://127.0.0.1:8765/ai/evaluation/ >/dev/null
curl --silent --fail http://127.0.0.1:8766/ai/evaluation/ >/dev/null
ego-browser nodejs < test/toc/verify.js
