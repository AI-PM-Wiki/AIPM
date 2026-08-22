#!/usr/bin/env bash
# claude-boss-workflow · spawn one headless boss-merger in the main work tree.
#
# Usage:
#   bash spawn-merger.sh <mainRepoAbs> <batchDirAbs>
#
#   <mainRepoAbs> absolute path to the main repo (or "$(git rev-parse --show-toplevel)")
#   <batchDirAbs> absolute path to the batch dir (contains README.md, reports/, prompts/)
#
# Writes a small merge-instructions.md into the batch dir, feeds it to the merger
# via stdin, and records stdout to <batchDir>/logs/merge.log. Run with the Bash
# tool run_in_background=true.
set -euo pipefail
MAIN="$1"; BATCH="$2"
LOG="$BATCH/logs/merge.log"
INST="$BATCH/merge-instructions.md"

mkdir -p "$BATCH/logs"
cd "$MAIN"

cat > "$INST" <<EOF
# Merge Instructions(boss-agent 生成)

- 批次目录:$BATCH
- 读 \`$BATCH/README.md\`(manifest:分支清单+合并顺序)与 \`$BATCH/reports/<ws>.md\`(确认每分支完成、门禁自测通过)。
- 按 parallel-development 的 Merge orchestration 执行:
  1. Preflight:\`git switch dev && git pull --ff-only origin dev\`;\`git status --short\` 主树干净。
  2. 按 manifest 顺序逐个 \`git merge --no-ff <branch>\` → 跑门禁(\`uv run mkdocs build -q\`;\`python3 scripts/check-characters.py\`;\`git diff --check\`)→ 任一红则停。
  3. 每个成功分支:\`git push origin dev\`;\`git worktree remove <worktree> 2>/dev/null || true\`;\`git branch -d <branch> 2>/dev/null || true\`。
- 冲突以各分支 prompt 的「不碰」为据解决,解决后重跑完整门禁。
- Env-only 步骤(workflow.json 的 env_only)不做。
- 写 \`$BATCH/merge-report.md\`(格式见 boss-merger agent 定义)。
- 末两行必须精确:
门禁: ALL_GREEN | PARTIAL_RED
结论: MERGED_ALL | MERGED_PARTIAL: <红停分支> | BLOCKED: <原因>
EOF

claude -p \
  --agent boss-merger \
  --name "boss-merger" \
  --output-format text \
  --allowedTools "Read, Grep, Glob, Edit, Write, Bash(cd*), Bash(git switch dev), Bash(git pull --ff-only origin dev), Bash(git status*), Bash(git log*), Bash(git branch --merged*), Bash(git worktree list), Bash(git worktree remove*), Bash(git branch -d*), Bash(git merge --no-ff*), Bash(git push origin dev), Bash(git diff*), Bash(git add*), Bash(git commit*), Bash(git checkout --*), Bash(uv run mkdocs*), Bash(python3 scripts/check-characters.py*), Bash(cat*), Bash(grep*), Bash(ls*), Bash(pwd)" \
  --disallowedTools "Bash(git push origin main), Bash(git push --force*), Bash(git reset --hard*), Bash(git rebase*), Bash(git worktree add*), Bash(git checkout dev), Bash(git checkout main), Bash(git checkout master), Bash(uv sync*), Bash(uv add*), Bash(uv remove*), Bash(yarn install*), Bash(yarn add*), Bash(npm install*), Bash(npm ci*), Bash(npm audit*), Bash(npx*), Bash(export*), Bash(chmod*), Bash(rm -rf*), Bash(sudo*)" \
  --add-dir "$BATCH" \
  < "$INST" \
  > "$LOG" 2>&1

exit $?
