#!/usr/bin/env bash

set -eo pipefail

# 说明(2026-08):本脚本仅在 CI Linux 构建中执行(ubuntu-latest,自带 wget 与 sha256sum):
# - 下载的是 x86_64-unknown-linux-gnu 预编译二进制,其他平台(如 macOS/Windows
#   本地构建)不可用,请勿直接运行;
# - 完整性校验:下载后先校验固定 SHA-256 再执行,校验失败立即退出(防下载劫持或
#   release 被篡改植入恶意二进制);
# - 校验值来源:v0.16.4 对应 linux-gnu 产物 minhtml-0.16.4-x86_64-unknown-linux-gnu,
#   2026-08-25 由仓库维护者从官方 release 下载并计算(16,616,816 字节);
#   人工核验路径:https://github.com/wilsonzlin/minify-html/releases/tag/v0.16.4
# - 升级版本流程 = 换下载 URL + 换 SHA-256 校验值 + 对新二进制重算 SHA-256,缺一不可;
# - Netlify 预览构建不执行 HTML 压缩(见 scripts/netlify/build.sh),
#   生产站点压缩以本脚本在 CI 中完成。

shopt -s globstar
# 先删除可能残留的旧文件,防止陈旧/被篡改的缓存绕过校验(CI runner 虽干净,防御性处理)
rm -f /tmp/minify-html
wget https://github.com/wilsonzlin/minify-html/releases/download/v0.16.4/minhtml-0.16.4-x86_64-unknown-linux-gnu -O /tmp/minify-html
# 固定 SHA-256 校验(来源见文件头注释);sha256sum -c 校验失败返回非零,配合 set -eo pipefail 立即中止
echo "631d9a07fa18a1d772492952dd690a09852bea845d5ec1b4d17b44536becd808  /tmp/minify-html" | sha256sum -c -
chmod +x /tmp/minify-html
/tmp/minify-html --keep-closing-tags --minify-css ./site/**/*.html
