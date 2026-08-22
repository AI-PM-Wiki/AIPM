#!/usr/bin/env bash
# claude-boss-workflow · spawn one headless boss-scanner (strictly read-only) for
# a quality scan.
#
# Usage:
#   bash spawn-scanner.sh <scope> <scanDirAbs>
#
#   <scope>      docs | frontend | backend | db | data | all (comma-separated allowed)
#   <scanDirAbs> where scan-report.md + scan-stdout.log land,
#                e.g. <quality_scans_dir>/20260819-docs
#
# The scanner runs in the main repo (cwd = repo root) from a clean context. It is
# strictly read-only: its only writable file is <scanDirAbs>/scan-report.md
# (Write:<reportPath> is the sole write allow). Run with the Bash tool
# run_in_background=true so the boss gets a completion notification when done.
set -euo pipefail
SCOPE="$1"; SCANDIR="$2"
REPORT="$SCANDIR/scan-report.md"
MAIN="$(git rev-parse --show-toplevel)"

mkdir -p "$SCANDIR"
cd "$MAIN"

printf '请对仓库 %s 执行一次范围 [%s] 的只读质量扫描。完整报告写入 %s(按 boss-scanner 定义的格式)。严格只读:不要创建/修改/删除任何其他文件。最后一行输出 结论: SCAN_DONE: <High>/<Med>/<Low> 或 结论: BLOCKED: <原因>。\n' \
  "$MAIN" "$SCOPE" "$REPORT" \
| claude -p \
  --agent boss-scanner \
  --name "boss-scan" \
  --output-format text \
  --allowedTools "Read, Grep, Glob, Search, Write:$REPORT, Bash(git log*), Bash(git status*), Bash(git diff*), Bash(git show*), Bash(git branch*), Bash(git grep*), Bash(git rev-parse*), Bash(grep*), Bash(find*), Bash(rg*), Bash(cat*), Bash(head*), Bash(tail*), Bash(wc*), Bash(ls*), Bash(pwd), Bash(sed -n*), Bash(awk*), Bash(du*), Bash(file*), Bash(dirname*), Bash(basename*), Bash(which*)" \
  --disallowedTools "Bash(git push*), Bash(git add*), Bash(git commit*), Bash(git merge*), Bash(git worktree*), Bash(git checkout*), Bash(git switch*), Bash(git reset*), Bash(git rebase*), Bash(git clean*), Bash(git stash*), Bash(git rm*), Bash(git mv*), Bash(npm*), Bash(make*), Bash(rm*), Bash(mv*), Bash(cp*), Bash(mkdir*), Bash(touch*), Bash(chmod*), Bash(chown*), Bash(export*), Bash(echo*), Bash(sudo*), Bash(npx*), Bash(install*)" \
  > "$SCANDIR/scan-stdout.log" 2>&1

exit $?
