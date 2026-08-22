#!/usr/bin/env bash
# claude-boss-workflow · fault-recovery entry: wait for the shared API to come
# back, then resume an interrupted batch from its recorded state (idempotent,
# safe to re-run).
#
# All agents (boss / worker / merger / scanner) share ONE API account. A single
# outage or empty balance stops every session at once — the boss session dies,
# in-flight `claude -p` workers exit non-zero. What survives is on disk:
#   - <batchDir>/boss-state.md      (stage / workstream status / rulings / next plan)
#   - worktrees + branches          (already-committed worker work is intact)
#   - logs/<ws>.log, reports/<ws>.md, merge-report.md
# Recovery = read state → reconcile against reality → resume idempotently.
#
# Usage:
#   bash resume-boss.sh <batchDirAbs> [--headless]
#
#   (default)   probe the API until it responds, then start an interactive claude
#               session that runs the /boss-agent --resume protocol (needs a TTY).
#   --headless  scripted non-interactive resume for cron/launchd: serially
#               re-dispatch unfinished workstreams (idempotent), then run the
#               merger, then write <batchDir>/logs/resume-report.md.
#
# Env: RESUME_MAX_PROBES (default 9999), RESUME_INTERVAL seconds (default 60).
set -euo pipefail

BATCH="${1:?用法: resume-boss.sh <批次目录> [--headless]}"
MODE="${2:-interactive}"
MAIN="$(git rev-parse --show-toplevel)"
PROBE_MAX="${RESUME_MAX_PROBES:-9999}"
PROBE_INTERVAL="${RESUME_INTERVAL:-60}"
LOG="$BATCH/logs/resume-boss.log"

cd "$MAIN"
[ -f "$BATCH/boss-state.md" ] || { echo "[resume-boss] 缺少 $BATCH/boss-state.md,不是有效批次?"; exit 1; }
mkdir -p "$BATCH/logs"

# ---- 1) wait for the API (all agents share one key: nothing can run until it's back) ----
probe() {
  # exit 0 only if claude reaches the API and answers. Single-turn `claude -p` is
  # inherently bounded — do NOT cap with a tiny --max-budget-usd (session overhead
  # alone trips a $0.02 cap and makes the probe fail even when the API is healthy).
  echo "API probe — reply exactly: ok" | claude -p --output-format text >/dev/null 2>&1
}
n=0
until probe; do
  n=$((n+1))
  echo "[$(date '+%F %T')] API 未就绪(第 $n 次探测),${PROBE_INTERVAL}s 后重试..." | tee -a "$LOG"
  [ "$n" -ge "$PROBE_MAX" ] && { echo "[resume-boss] 放弃:超过 $PROBE_MAX 次探测" | tee -a "$LOG"; exit 1; }
  sleep "$PROBE_INTERVAL"
done
echo "[$(date '+%F %T')] API 就绪,开始恢复批次 $BATCH" | tee -a "$LOG"

# ---- 2) resume ----
if [ "$MODE" = "--headless" ]; then
  printf '读 .claude/skills/boss-agent/SKILL.md,严格按其 --resume 对账协议,以 headless 方式恢复批次 %s。要点:串行续派未完成 workstream(用 bash .claude/skills/boss-agent/bin/spawn-worker.sh,阻塞至完成;幂等——已提交/已完成的跳过不重做),逐份读 reports 的 token,再派 merger(spawn-merger.sh),把恢复结果写 %s/logs/resume-report.md,末行输出 结论: RESUME_DONE | BLOCKED: <原因>。\n' "$BATCH" "$BATCH" \
  | claude -p --output-format text \
      --allowedTools "Read, Grep, Glob, Search, Bash(cd*), Bash(git status*), Bash(git log*), Bash(git diff*), Bash(git worktree*), Bash(bash .claude/skills/boss-agent/bin/spawn-worker.sh*), Bash(bash .claude/skills/boss-agent/bin/spawn-merger.sh*), Bash(tail*), Bash(cat*), Bash(ls*), Bash(pwd), Bash(echo*), Bash(sleep*)" \
      --disallowedTools "Bash(git push*), Bash(git add*), Bash(git commit*), Bash(git merge*), Bash(git reset --hard*), Bash(git rebase*), Bash(git worktree add*), Bash(npm run import:*), Bash(npm run geocode:*), Bash(npx*), Bash(export*), Bash(chmod*), Bash(rm -rf*), Bash(sudo*)" \
      > "$LOG.headless" 2>&1
  echo "[resume-boss] headless 恢复完成:$LOG.headless" | tee -a "$LOG"
else
  if [ ! -t 0 ]; then
    echo "[resume-boss] 无 TTY:交互模式需要终端。请用 --headless,或在终端里运行本脚本。" | tee -a "$LOG"
    exit 1
  fi
  echo "[resume-boss] 启动交互恢复会话... 若未自动开始,在会话里输入 /boss-agent --resume $BATCH" | tee -a "$LOG"
  exec claude "调用 boss-agent skill,按 --resume 协议恢复批次 $BATCH。"
fi
