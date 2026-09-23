#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
mkdir -p meta/toc-regression

python3 test/toc/check-port.py 8765
python3 test/toc/check-port.py 8766

uv run mkdocs build -q -d meta/toc-regression/site-default
uv run mkdocs build -q -f test/toc/features.yml

run_id="$(python3 -c 'from uuid import uuid4; print(uuid4().hex)')"
default_owner="$run_id:default"
features_owner="$run_id:features"
printf '%s\n' "$default_owner" >meta/toc-regression/site-default/__toc_runner_owner__.txt
printf '%s\n' "$features_owner" >meta/toc-regression/site-features/__toc_runner_owner__.txt

"${AIPM_TOC_DEFAULT_SERVER:-python3}" -m http.server 8765 --bind 127.0.0.1 --directory meta/toc-regression/site-default >meta/toc-regression/default.log 2>&1 &
default_pid=$!
"${AIPM_TOC_FEATURES_SERVER:-python3}" -m http.server 8766 --bind 127.0.0.1 --directory meta/toc-regression/site-features >meta/toc-regression/features.log 2>&1 &
features_pid=$!
stop_servers() {
  for pid in "$default_pid" "$features_pid"; do
    if [[ " $(jobs -pr) " == *" $pid "* ]]; then
      kill "$pid"
      wait "$pid" || true
    fi
  done
}
trap stop_servers EXIT

check_owner() {
  local name="$1" pid="$2" port="$3" expected="$4" actual
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name service failed to start on port $port" >&2
    return 1
  fi
  actual="$(curl --silent --fail --max-time 1 "http://127.0.0.1:$port/__toc_runner_owner__.txt")" || return 1
  if [[ "$actual" != "$expected" ]]; then
    echo "$name service on port $port has another owner" >&2
    return 1
  fi
}

for attempt in $(seq 1 30); do
  if ! kill -0 "$default_pid" 2>/dev/null; then
    echo "default service failed to start on port 8765; see meta/toc-regression/default.log" >&2
    exit 1
  fi
  if ! kill -0 "$features_pid" 2>/dev/null; then
    echo "features service failed to start on port 8766; see meta/toc-regression/features.log" >&2
    exit 1
  fi
  if check_owner default "$default_pid" 8765 "$default_owner" &&
     check_owner features "$features_pid" 8766 "$features_owner"; then
    break
  fi
  sleep 0.2
done
check_owner default "$default_pid" 8765 "$default_owner"
check_owner features "$features_pid" 8766 "$features_owner"
ego-browser nodejs < test/toc/verify.js
check_owner default "$default_pid" 8765 "$default_owner"
check_owner features "$features_pid" 8766 "$features_owner"
