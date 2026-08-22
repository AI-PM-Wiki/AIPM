#!/usr/bin/env bash
# claude-boss-workflow · spawn one headless boss-worker in its pre-built worktree.
#
# Usage:
#   bash spawn-worker.sh <ws> <worktreeAbs> <batchDirAbs>
#
#   <ws>          workstream id, e.g. w1
#   <worktreeAbs> absolute path to the pre-built worktree (boss created it)
#   <batchDirAbs> absolute path to the batch dir (prompts/, reports/, logs/)
#
# Reads the prompt from <batchDir>/prompts/<ws>.md (stdin), writes stdout to
# <batchDir>/logs/<ws>.log. Run with the Bash tool run_in_background=true so the
# boss gets a completion notification when the worker exits.
set -euo pipefail
WS="$1"; WORKTREE="$2"; BATCH="$3"
LOG="$BATCH/logs/$WS.log"

mkdir -p "$BATCH/logs" "$BATCH/reports"
cd "$WORKTREE"

claude -p \
  --agent boss-worker \
  --name "boss-w-$WS" \
  --output-format text \
  --allowedTools "Read, Edit, Write, Grep, Glob, Search, Bash(cd*), Bash(git status*), Bash(git log*), Bash(git diff*), Bash(git show*), Bash(git branch*), Bash(git add*), Bash(git commit*), Bash(git merge dev), Bash(git checkout --*), Bash(uv run mkdocs*), Bash(python3 scripts/check-characters.py*), Bash(cat*), Bash(grep*), Bash(find*), Bash(ls*), Bash(pwd)" \
  --disallowedTools "Bash(git push*), Bash(git worktree*), Bash(git switch*), Bash(git checkout dev), Bash(git checkout main), Bash(git checkout master), Bash(git checkout -b*), Bash(git reset --hard*), Bash(git rebase*), Bash(git clean*), Bash(git stash*), Bash(uv sync*), Bash(uv add*), Bash(uv remove*), Bash(yarn install*), Bash(yarn add*), Bash(npm install*), Bash(npm ci*), Bash(npm audit*), Bash(npx*), Bash(export*), Bash(chmod*), Bash(rm -rf*), Bash(sudo*)" \
  --add-dir "$BATCH" \
  < "$BATCH/prompts/$WS.md" \
  > "$LOG" 2>&1

# Exit with claude's exit code so run_in_background completion reflects success.
exit $?
