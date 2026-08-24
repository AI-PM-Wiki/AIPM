set -euo pipefail

VENDOR_DIR="mkdocs-material/material/templates/assets/vendor"
# 清空历史 vendor 资源:曾用于 MathJax 4.0.0 下载(全库零引用,2026-08 已移除),
# 保留 rm -rf 以清除旧构建遗留的 vendored 资源,保证干净构建
rm -rf "$VENDOR_DIR"
