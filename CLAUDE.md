# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI-PM** is a Chinese AI product management knowledge wiki built with MkDocs, using a customized Material for MkDocs theme. It is a collaborative educational resource covering AI product methodology, LLM capabilities and tools, prompt engineering, agent workflows, and evaluation.

## 信息源与外部资料

- 需要外部资料时,先读 `docs/case/info-sources.md`(信息源索引):校内 CC98、中文社区(linux.do、知乎)、
  微信公众号检索、国内外产品经理博客与 Newsletter、X 与海外社区、教程类(人人都是产品经理、GitHub 教程),
  每类注明访问方式(含登录墙等门槛)与 Agent 使用提示。
- **CC98**(浙大校内论坛,高质量一手信息:实习/校招、课程、技术讨论):本机已配置 CC98 MCP
  (`mcp__cc98__*` 工具),直接搜索、读帖;访问需校内网络或 WebVPN。
- **微信公众号文章**检索用搜狗微信搜索,模板 `https://weixin.sogou.com/weixin?type=2&query=%s`
  (`%s` 替换为 URL 编码后的关键词),不要用通用网页搜索代替。
- **linux.do 等论坛**:用浏览器访问(Playwright MCP)。
- **登录墙**(X、知乎等):只能读公开页面;登录态内容请用户协助。
- 本地门禁以 `.claude/workflow.json` 的 `gates` 为准(`git diff --check` / `uv run mkdocs build -q` /
  `python3 scripts/check-characters.py`);package.json 的 yarn 脚本依赖 node_modules(当前未装,不可用);
  外链完整性由 CI 的 htmltest 校验(排除 `/aipm/` 前缀)。

## Architecture & Structure

### Documentation Structure
- **docs/**: 主要文档内容,按主题分为:
  - `intro/`:简介(关于、产品经理黑话速查、FAQ、能力模型等)
  - `pm/`:产品方法论(需求、用户研究、设计、项目管理、AI 生命周期、PRD、商业化)
  - `ai/`:AI 基础(LLM 能力、多模态、提示词、RAG、Agent、评测、架构)
  - `practice/`:AI 产品实战(聊天机器人、知识库问答、Agent 产品、Copilot、工作流、合规)
  - `tools/`:工具与平台(LLM API、成本、框架、提示词工具、数据、效率工具)
  - `case/`:案例与资源(产品拆解、自学、学习路线、学习资源、信息源索引、面试)
  - `job/`:求职专题(如存在)
  - `_static/` 与站点文件(favicon、manifest 等)

### Build System
- **MkDocs** with custom Material theme (in `mkdocs-material/`)
- **Python dependencies**: Managed via uv (`pyproject.toml`)
- **Node.js dependencies**: Managed via Yarn (`package.json`)
- **Build pipeline**: Multi-stage process with pre/post build scripts

## Development Commands

### Local Development
```bash
# Install dependencies
uv sync --index-url https://pypi.tuna.tsinghua.edu.cn/simple/
yarn install

# Install theme and assets
./scripts/pre-build/install-theme.sh

# Start local development server
uv run mkdocs serve -v

# Build static site
uv run mkdocs build -v
```

> 注意:本地门禁以 `.claude/workflow.json` 的 `gates` 为准;`yarn run docs:format:check` 等脚本需先
> `yarn install`(当前 node_modules 未安装,不可用)。

### Code Quality & Checking
```bash
# Check documentation formatting
yarn run docs:format:check

# Format documentation
yarn run docs:format:remark

# TypeScript code formatting
yarn run scripts:format
yarn run scripts:format:check

# Run comprehensive markdown checks
node --loader ts-node/esm scripts/checker/checker.ts

# Check for problematic characters
python3 scripts/check-characters.py
```

### Production Build
```bash
# Full production build (used in CI/CD)
scripts/netlify/build.sh
```

## File Types & Conventions

### Documentation Files
- **Markdown**: `.md` files with MkDocs extensions
- **Images**: `.png`, `.svg`, `.jpg` in `images/` subdirectories
- **Code examples**: Inline code blocks and separate files in `code/` dirs
- **Configuration**: YAML frontmatter in markdown files

### Build Configuration
- **mkdocs.yml**: Main MkDocs configuration
- **pyproject.toml**: Python dependencies
- **package.json**: Node.js dependencies and scripts
- **netlify.toml**: Netlify deployment configuration

### Scripts & Automation
- **TypeScript**: Build and quality checking scripts in `scripts/`
- **Python**: Utility scripts for content validation
- **Bash**: Build and deployment scripts

## Key Development Workflows

### Content Contribution
1. Edit/add `.md` files in appropriate `docs/` subdirectories
2. Add images to corresponding `images/` directories
3. Run format checking: `yarn run docs:format:check`
4. Test locally: `uv run mkdocs serve`
5. Build and verify: `uv run mkdocs build`

### Adding New Topics
1. Create new `.md` file in appropriate directory
2. Add to `mkdocs.yml` navigation structure
3. Include code examples in `code/` subdirectory if needed
4. Add supporting images in `images/` subdirectory
5. Follow existing formatting conventions

### Code Quality Checks
- **Markdown linting**: Uses remark with custom rules
- **Character validation**: Checks for problematic Unicode characters
- **Link validation**: Verifies internal/external links
- **Math rendering**: Validates LaTeX math expressions

## Environment Setup

### Requirements
- **Python**: 3.10+ (via uv)
- **Node.js**: 20+ (via Yarn)
- **Git**: For submodule management

### Development Environment
```bash
# Clone with submodules (推送到你自己的仓库后替换下方地址)
git clone https://github.com/Hi-Yincan/aipm.git --depth=1
cd AIPM

# Install Python dependencies
uv sync

# Install Node.js dependencies
yarn install

# Install theme assets
./scripts/pre-build/install-theme.sh
```

## Common Issues & Solutions

### Build Failures
- **Missing dependencies**: Ensure both `uv sync` and `yarn install` complete successfully
- **Theme issues**: Run `./scripts/pre-build/install-theme.sh` to reinstall theme assets
- **Python version**: Use Python 3.10+ as specified in pyproject.toml

### Content Issues
- **Broken links**: Run link validation checks
- **Math rendering**: Check LaTeX syntax in mathematical content
- **Image paths**: Ensure images are in correct `images/` subdirectories

### Performance
- **Large builds**: Use incremental builds during development (`mkdocs serve`)
- **Memory issues**: Increase Node.js memory limit if needed (`NODE_OPTIONS="--max_old_space_size=3072"`)

## CI/CD Pipeline

### GitHub Actions Workflows
The project uses comprehensive GitHub Actions for continuous integration and deployment:

#### Main Build Workflow (`build.yml`)
- **Triggers**: Push to master, PR to master, manual dispatch
- **Environment**: Ubuntu-latest, Python 3.10, Node.js 20
- **Steps**:
  1. Install Python dependencies via uv
  2. Install Node.js dependencies via yarn
  3. Pre-build setup (theme installation)
  4. MkDocs build with verbose output
  5. HTML post-processing (commits info, math rendering, external links)
  6. HTML minification
  7. Redirect generation
  8. Link validation (internal links only)
  9. Deploy to gh-pages (on push events)
  10. Baidu search submission (production only)

#### Code Quality Workflows
- **Format checking** (`check-format.yml`): Markdown formatting, C++ code formatting
- **Code testing** (`test.yml`): C++ code compilation and correctness testing
- **Character validation** (`check-characters.yml`): Unicode character checks
- **Quote validation** (`check-quotes.yml`): Chinese punctuation validation
- **Script validation** (`check-scripts.yml`): TypeScript formatting and linting

#### Specialized Builds
- **PDF generation** (`build-pdf.yml`): LaTeX-based PDF builds using xelatex
- **Typst PDF** (`build-pdf-typst.yml`): Modern PDF generation with Typst
- **Author cache** (`build-authors-cache.yml`): Contributor statistics caching

#### Cross-Platform Testing
The test workflow runs C++ code validation across multiple platforms:
- Ubuntu (x86_64)
- macOS (ARM64)
- Windows (x86_64)
- Alpine Linux (x86_64)
- RISC-V Ubuntu (via Docker)

### Pre-commit Checks
Before pushing changes, ensure:
```bash
# Format checking
yarn docs:format:check -a

# Code compilation (if adding C++ examples)
python3 scripts/correctness_check.py

# Character validation
python3 scripts/check-characters.py

# Link validation (local)
node --loader ts-node/esm scripts/checker/checker.ts
```

### Deployment Strategy
- **Production**: Automatic deployment from master branch to GitHub Pages
- **Preview**: Netlify builds for PR previews
- **Mirror**: Automatic sync to Gitee (Chinese mirror)
- **CDN**: Multi-region deployment with status monitoring

### Environment Variables
Key environment variables used in CI/CD:
- `GITHUB_TOKEN`: GitHub API access
- `BAIDU_TOKEN`: Chinese search engine submission
- `NODE_OPTIONS="--max_old_space_size=3072"`: Memory optimization
- `PYTHONIOENCODING=UTF-8`: UTF-8 encoding for Python scripts

## Testing Content

### Local Testing
- Use `mkdocs serve` for live reloading during development
- Test on multiple browsers for MathJax compatibility
- Verify responsive design on mobile devices

### Link Validation
- Check internal links between documents
- Verify external links are accessible
- Test anchor links within documents

### Content Quality
- Follow established markdown formatting conventions
- Ensure mathematical notation renders correctly
- Verify code examples compile and run as expected

### Cross-Platform Compatibility
- Test C++ code examples on different compilers (GCC, Clang, MSVC)
- Validate UTF-8 encoding across platforms
- Check LaTeX math rendering in different environments