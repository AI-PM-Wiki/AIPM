#!/usr/bin/env bash
# =============================================================================
# check-upstream-remnants.sh — 上游 fork 残留检测(AI-PM / AI-PM-Wiki/AIPM)
#
# 用途:
#   AI-PM 仓库继承自 oi-wiki 深度 fork(主题子模块 fork 链:
#   squidfunk/mkdocs-material → oi-wiki 深度定制 → AI-PM-Wiki/mkdocs-material)。
#   2026-08 已彻查清理 oi-wiki 残留(远程搜索端点、上游域名、CI 与脚本引用等)。
#   本脚本防止类似残留回流:命中致命词表即 exit 1。
#   白名单机制:命中词表但确属「已知合法引用」的文件(如 README.md 依 SATA
#   许可致谢 OI Wiki,必然含 oi-wiki.org / OI-wiki/OI-wiki)登记在
#   LEGAL_EXCEPTIONS 中,命中输出 WARN(合法引用)不置 FAIL;其余命中仍 FAIL。
#
# 模式:
#   默认(本地门禁):
#     扫描 docs/、根层 *.md、mkdocs.yml、.github/、scripts/、yarn.lock;
#     排除 mkdocs-material/(子模块,由 --full 覆盖)、site/、.git/、.venv/、
#     .books/、meta/、node_modules/、__pycache__/。
#   --full(仅本地门禁;对应 CI 工作流已移除):
#     在默认基础上追加扫描 mkdocs-material/src/ 与
#     mkdocs-material/material/templates/(两处均排除 vendor/ 目录即 assets/vendor/),
#     并校验构建产物(仅当 site/ 存在时执行,不存在则跳过并注明,避免本地重复构建)。
#   --quiet:
#     不输出命中明细(错误信息仍输出到 stderr),仅返回 exit code
#     (0 = 无 FAIL 命中,1 = 有 FAIL 命中或校验失败;WARN 不计 FAIL),
#     供其他流程复用。
#
# 词表维护方法:
#   - 在 FATAL_PATTERNS 中追加/修改 grep -E 正则,每行注释说明残留来源。
#   - 新增疑似残留词时,先 `grep -rniE '<词>' docs/` 确认 docs/ 无合法用法再入表。
#   - 合法例外说明:词表刻意不含 squidfunk——squidfunk.github.io(官方主题来源)
#     是合法引用(见 docs/intro/about.md),靠「词表不含该词」天然放行,无需白名单。
#   - 白名单维护:新增合法引用(如 README 依 SATA 致谢 OI Wiki)时,先在
#     LEGAL_EXCEPTIONS 登记文件名,再运行脚本确认输出 WARN(合法引用)而非 FAIL;
#     若同时出现 FAIL 命中,先修掉真正残留,避免白名单掩盖新残留。
#   - 脚本以 --exclude 排除自身文件:词表与注释含致命词原文,否则会自命中。
# =============================================================================
set -euo pipefail

# ---- 致命词表(grep -E,匹配即视为上游残留) ------------------------------------
FATAL_PATTERNS=(
  'oi-wiki\.org'                  # 上游域名主体(官网/搜索/邮箱/join-us 均为其子域)
  'search\.oi-wiki\.org'          # 旧版远程搜索端点(服务端搜索,已被官方本地搜索取代)
  'search\.oi-wiki'               # 任何 search.oi-wiki.* 引用(含预取/跳转)
  'OI-wiki/OI-wiki'               # 上游 GitHub 仓库引用(含 OI-wiki/OI-wiki.git)
  'hi@oi-wiki\.org'               # 上游联系邮箱
  '24OI-Bot'                      # 上游自动机器人
  '__oiWikiSearchEndpoint'        # 上游搜索前端注入端点(旧版远程搜索)
  'join-us\.oi-wiki\.org'         # 上游招募彩蛋链接
  'oiwiki-feedback-sys-frontend'  # 上游反馈系统前端 npm 包
  'oi-wiki\.com'                  # 上游彩蛋域名(含域名判断逻辑)
  'lib\.baomitu\.com'             # 主题 baomitu 字体块(上游 CDN 引用;主题子模块侧删除另行处理,本词表防回流)
)

# ---- 已知合法引用白名单(basename 匹配) ------------------------------------------
# 命中词表但确属「已知合法引用」的文件,输出 WARN(合法引用)不置 FAIL;
# 其余文件命中仍 FAIL。维护方法见头部注释「词表维护方法」。
LEGAL_EXCEPTIONS=('README.md')   # 依 SATA 许可致谢 OI Wiki,必然含 oi-wiki.org / OI-wiki/OI-wiki

# ---- 扫描范围 ----------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# nullglob 仅用于目标 glob 展开(根层 *.md);随后立即关闭,避免影响 --include 选项词
shopt -s nullglob
DEFAULT_TARGETS=(
  "$REPO_ROOT/docs"
  "$REPO_ROOT"/*.md
  "$REPO_ROOT/mkdocs.yml"
  "$REPO_ROOT/.github"
  "$REPO_ROOT/scripts"
  "$REPO_ROOT/yarn.lock"
)
shopt -u nullglob
FULL_TARGETS=(
  "$REPO_ROOT/mkdocs-material/src"
  "$REPO_ROOT/mkdocs-material/material/templates"
)

# 文本类型(配合 grep -r 的 --include 使用;--binary-files=without-match 兜底)
TEXT_EXTS=(md html htm js ts jsx tsx json yml yaml css scss txt py sh bash toml lock tex bib svg xml)
INCLUDE_OPTS=()
for ext in "${TEXT_EXTS[@]}"; do
  INCLUDE_OPTS+=(--include="*.$ext")
done

# 默认排除目录(所有模式)+ 排除脚本自身(词表/注释含致命词原文)
# .books/:本地未跟踪的版权电子书资料(见 .gitignore),不进入扫描范围
SELF_NAME="$(basename "${BASH_SOURCE[0]}")"
EXCLUDE_OPTS=(--exclude="$SELF_NAME")
EXCLUDE_DIRS=(.git .venv node_modules site mkdocs-material meta .books __pycache__)
for d in "${EXCLUDE_DIRS[@]}"; do
  EXCLUDE_OPTS+=(--exclude-dir="$d")
done

# ---- 参数解析 ----------------------------------------------------------------
MODE=default
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --full) MODE=full ;;
    --quiet) QUIET=1 ;;
    -h|--help)
      sed -n '2,44p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "usage: check-upstream-remnants.sh [--full] [--quiet]" >&2
      exit 2
      ;;
  esac
done

# ---- 拼接词表正则 -------------------------------------------------------------
PATTERN="$(IFS='|'; echo "${FATAL_PATTERNS[*]}")"

# ---- 收集命中 -----------------------------------------------------------------
RESULTS="$(mktemp)"
trap 'rm -f "$RESULTS"' EXIT
FAIL=0

scan() {
  # 参数:目标路径;逐个检查存在性,缺失的跳过并注明(如子模块未检出)
  [ "$#" -gt 0 ] || return 0
  local t
  for t in "$@"; do
    if [ ! -e "$t" ]; then
      [ "$QUIET" -eq 0 ] && echo "NOTE: 跳过不存在的目标: $t"
    fi
  done
  # 命中先收集到 RESULTS,是否置 FAIL 由下方白名单判定决定
  grep -rniE --binary-files=without-match "${INCLUDE_OPTS[@]}" "${EXCLUDE_OPTS[@]}" "$PATTERN" "$@" >> "$RESULTS" 2>/dev/null || true
}

scan "${DEFAULT_TARGETS[@]}"

if [ "$MODE" = full ]; then
  scan "${FULL_TARGETS[@]}"
fi

# ---- 构建产物校验(--full 且 site/ 存在时执行)----------------------------------
SITE_CHECKS=""
if [ "$MODE" = full ]; then
  if [ -d "$REPO_ROOT/site" ]; then
    if [ ! -f "$REPO_ROOT/site/search/search_index.json" ]; then
      SITE_CHECKS+="FATAL: site/search/search_index.json 不存在(官方本地搜索产物缺失)$(printf '\n')"
      FAIL=1
    fi
    if grep -rli "search.oi-wiki.org" "$REPO_ROOT/site" > /dev/null 2>&1; then
      SITE_CHECKS+="FATAL: site/ 仍含 search.oi-wiki.org 引用(远程搜索残留)$(printf '\n')"
      FAIL=1
    fi
    if grep -rli "\.oi-wiki\.org" "$REPO_ROOT/site/assets/javascripts/" > /dev/null 2>&1; then
      SITE_CHECKS+="FATAL: site/assets/javascripts/ 仍含 .oi-wiki.org 引用(远程搜索 bundle 残留)$(printf '\n')"
      FAIL=1
    fi
  else
    SITE_CHECKS+="NOTE: site/ 不存在,跳过构建产物校验(CI 中不预构建,由 build 流程覆盖;本地 mkdocs build 后重跑即可校验)$(printf '\n')"
  fi
fi

# ---- 白名单判定 ----------------------------------------------------------------
# 命中行格式「文件:行:内容」:文件在 LEGAL_EXCEPTIONS 中 → WARN(合法引用,不计 FAIL),
# 其余 → FAIL 命中。用进程替换保持 while 循环在当前 shell 执行(管道会开子 shell,
# FAIL_COUNT 无法回写)。
is_legal() {
  local f="$1" e
  for e in "${LEGAL_EXCEPTIONS[@]}"; do
    [ "$f" = "$e" ] && return 0
  done
  return 1
}

WARN_COUNT=0
FAIL_COUNT=0
if [ -s "$RESULTS" ]; then
  while IFS=: read -r fpath rest; do
    if is_legal "$(basename "$fpath")"; then
      WARN_COUNT=$((WARN_COUNT + 1))
      [ "$QUIET" -eq 0 ] && echo "WARN(合法引用): $fpath:$rest"
    else
      FAIL_COUNT=$((FAIL_COUNT + 1))
      [ "$QUIET" -eq 0 ] && echo "$fpath:$rest"
    fi
  done < <(sort -u "$RESULTS")
fi
[ "$FAIL_COUNT" -gt 0 ] && FAIL=1

# ---- 输出 ---------------------------------------------------------------------
if [ "$QUIET" -eq 0 ]; then
  if [ "$FAIL_COUNT" -gt 0 ]; then
    echo
    echo "FAIL: 检测到上游残留(共 $FAIL_COUNT 处),详见上方清单。"
  fi
  if [ "$WARN_COUNT" -gt 0 ]; then
    echo "WARN: $WARN_COUNT 处命中位于合法引用白名单(${LEGAL_EXCEPTIONS[*]}),不计 FAIL。"
  fi
  if [ "$FAIL_COUNT" -eq 0 ] && [ "$WARN_COUNT" -eq 0 ]; then
    echo "OK: 无上游残留"
  fi
  if [ -n "$SITE_CHECKS" ]; then
    printf '%s' "$SITE_CHECKS" | sed '/^$/d'
  fi
fi

# 错误信息始终输出到 stderr,便于 --quiet 模式下排查
if [ "$FAIL" -ne 0 ]; then
  echo "check-upstream-remnants: FAILED(存在上游残留)" >&2
  exit 1
fi
echo "check-upstream-remnants: PASSED" >&2
exit 0
