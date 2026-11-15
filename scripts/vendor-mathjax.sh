#!/usr/bin/env bash
# 下载 MathJax npm 包并校验摘要，复制到 docs/_static/js/vendor/mathjax-<版本>/，保持包内 es5/ 的目录结构。
# 用法：bash scripts/vendor-mathjax.sh <工作目录>。工作目录必须尚不存在，放在已忽略的 meta/ 下。
set -euo pipefail

VERSION=3.2.2
INTEGRITY=sha512-Bt+SSVU8eBG27zChVewOicYs7Xsdt40qm4+UpHyX7k0/O9NliPc+x77k1/FEsPsjKPZGJvtRZM1vO+geW0OhGw==

# tex-chtml.js 之外的条目都由 MathJax 在运行时按需加载：
#   output/chtml/fonts/woff-v2    CHTML 字体
#   input/tex/extensions          autoload 宏与 \require 加载的 TeX 扩展
#   a11y、input/mml、sre/mathmaps 右键菜单的无障碍功能（探索器、语义增强、语音规则）
#   output/svg.js、output/svg     右键菜单切换到 SVG 渲染器
ENTRIES=(
  tex-chtml.js
  output/chtml/fonts/woff-v2
  input/tex/extensions
  a11y
  input/mml.js
  input/mml
  sre/mathmaps
  output/svg.js
  output/svg/fonts
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$1"
mkdir -p "$(dirname "$WORK")"
mkdir "$WORK"
WORK="$(cd "$WORK" && pwd)"

npm pack "mathjax@$VERSION" --pack-destination "$WORK" --silent
TARBALL="$WORK/mathjax-$VERSION.tgz"
ACTUAL="sha512-$(openssl dgst -sha512 -binary "$TARBALL" | openssl base64 -A)"
if [ "$ACTUAL" != "$INTEGRITY" ]; then
  echo "mathjax-$VERSION.tgz 摘要不一致：$ACTUAL" >&2
  exit 1
fi
tar -xzf "$TARBALL" -C "$WORK"

SOURCE="$WORK/package"
VENDOR="$ROOT/docs/_static/js/vendor"
TARGET="$VENDOR/mathjax-$VERSION"
rm -rf "$VENDOR"/mathjax-*
mkdir -p "$TARGET"
cp "$SOURCE/LICENSE" "$TARGET/LICENSE"
for entry in "${ENTRIES[@]}"; do
  mkdir -p "$TARGET/$(dirname "$entry")"
  cp -R "$SOURCE/es5/$entry" "$TARGET/$entry"
done
