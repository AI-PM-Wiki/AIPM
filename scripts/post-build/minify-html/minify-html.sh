#!/usr/bin/env bash

set -eo pipefail

# 说明(2026-08):本脚本仅在 CI Linux 构建中执行(ubuntu-latest,自带 wget):
# - 下载的是 x86_64-unknown-linux-gnu 预编译二进制,其他平台(如 macOS/Windows
#   本地构建)不可用,请勿直接运行;
# - 校验与人工核验路径:文件 SHA256 见 GitHub release 页
#   https://github.com/wilsonzlin/minify-html/releases/tag/v0.16.4
#   (linux-gnu 产物对应 minhtml-0.16.4-x86_64-unknown-linux-gnu);
# - Netlify 预览构建不执行 HTML 压缩(见 scripts/netlify/build.sh),
#   生产站点压缩以本脚本在 CI 中完成。

shopt -s globstar
wget https://github.com/wilsonzlin/minify-html/releases/download/v0.16.4/minhtml-0.16.4-x86_64-unknown-linux-gnu -O /tmp/minify-html
chmod +x /tmp/minify-html
/tmp/minify-html --keep-closing-tags --minify-css ./site/**/*.html
