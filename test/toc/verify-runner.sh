#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
mkdir -p meta/toc-regression

stop_foreign() {
  if [[ -n "${foreign_pid:-}" && " $(jobs -pr) " == *" $foreign_pid "* ]]; then
    kill "$foreign_pid"
    wait "$foreign_pid" || true
  fi
  foreign_pid=""
}
trap stop_foreign EXIT

for occupied in 8765 8766; do
  if [[ "$occupied" == 8765 ]]; then
    role=default
  else
    role=features
  fi
  foreign_dir="meta/toc-regression/foreign-$occupied"
  mkdir -p "$foreign_dir"
  marker="foreign-$occupied-$(python3 -c 'from uuid import uuid4; print(uuid4().hex)')"
  printf '%s\n' "$marker" >"$foreign_dir/__toc_runner_owner__.txt"

  python3 -m http.server "$occupied" --bind 127.0.0.1 --directory "$foreign_dir" >"$foreign_dir/server.log" 2>&1 &
  foreign_pid=$!
  for attempt in $(seq 1 30); do
    kill -0 "$foreign_pid"
    actual="$(curl --silent --fail --max-time 1 "http://127.0.0.1:$occupied/__toc_runner_owner__.txt")" || actual=""
    [[ "$actual" == "$marker" ]] && break
    sleep 0.2
  done
  [[ "$actual" == "$marker" ]]

  requests_before="$(wc -l <"$foreign_dir/server.log")"
  if bash test/toc/run.sh >"$foreign_dir/runner.log" 2>&1; then
    echo "Runner incorrectly passed while $occupied was occupied" >&2
    exit 1
  else
    result=$?
  fi

  grep -q 'Address already in use' "$foreign_dir/runner.log"
  requests_after="$(wc -l <"$foreign_dir/server.log")"
  [[ "$requests_after" == "$requests_before" ]]
  kill -0 "$foreign_pid"
  actual="$(curl --silent --fail --max-time 1 "http://127.0.0.1:$occupied/__toc_runner_owner__.txt")"
  [[ "$actual" == "$marker" ]]
  echo "OCCUPIED_PORT=$occupied RUNNER_EXIT=$result FOREIGN_SERVICE_ALIVE=yes OWNER_UNCHANGED=yes FOREIGN_REQUESTS_DURING_RUN=0"

  stop_foreign
done

for role in default features; do
  if [[ "$role" == default ]]; then
    port=8765
    if AIPM_TOC_DEFAULT_SERVER=/usr/bin/false bash test/toc/run.sh >meta/toc-regression/fail-default.log 2>&1; then
      echo "Runner incorrectly passed when the default service failed" >&2
      exit 1
    else
      result=$?
    fi
  else
    port=8766
    if AIPM_TOC_FEATURES_SERVER=/usr/bin/false bash test/toc/run.sh >meta/toc-regression/fail-features.log 2>&1; then
      echo "Runner incorrectly passed when the features service failed" >&2
      exit 1
    else
      result=$?
    fi
  fi

  grep -q "$role service failed to start on port $port" "meta/toc-regression/fail-$role.log"
  python3 test/toc/check-port.py 8765
  python3 test/toc/check-port.py 8766
  echo "FAILED_SERVICE=$role RUNNER_EXIT=$result BOTH_PORTS_RELEASED=yes"
done
