#!/usr/bin/env bash

set -e

# Install uv if not available (Netlify should have it via pip install uv)
if ! command -v uv &> /dev/null; then
    # 锁定本地已验证版本;CI 的 setup-uv@v8.1.0 action 未锁 uv 小版本,此处选已验证版本保证 Netlify 构建行为可预测
    pip install "uv==0.11.26"
fi

# Install dependencies
uv sync --frozen --index-url ${PYPI_MIRROR:-https://pypi.org/simple/}
yarn --frozen-lockfile --production

# Install themes and etc.
PREBUILD_NETLIFY=1 scripts/pre-build/pre-build.sh

uv run mkdocs build -v

# Post-build scripts
export NODE_OPTIONS="--max_old_space_size=3072"
node --loader ts-node/esm scripts/post-build/html-postprocess.ts external-links
