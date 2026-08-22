# 欢迎来到 **AI-PM**！

**AI-PM**（AI Product Manager，AI 产品经理）是一个 AI 产品管理知识整合站点，提供 AI 产品方法论、模型与工具、提示词工程、Agent 与工作流、评估与迭代等方面的知识与实践，帮助大家更快更深入地学习 AI 产品设计。

* * *

## 内容

- 产品方法论：需求分析、用户研究、产品设计、项目管理
- AI 基础：大模型能力边界、提示词工程、RAG、Agent 与工作流
- 工具与平台：主流 AI 产品与平台、评测与反馈体系
- 实战案例：AI 产品拆解与复盘

* * *

## 部署

本项目基于 [MkDocs](https://github.com/mkdocs/mkdocs) 构建。（**需要安装 Python3 和 uv**）

```bash
# 安装 uv (如果尚未安装)
pip install uv

# 安装依赖
uv sync --index-url https://pypi.tuna.tsinghua.edu.cn/simple/

# 安装自定义主题（Windows 下请使用 Git Bash 执行）
# 安装主题时将连接网络下载资源，可通过以下配置项控制下载链接
# .gitmodules:
# - url
# scripts/pre-build/install-theme-vendor.sh:
# - MATHJAX_URL
# - MATERIAL_ICONS_URL
./scripts/pre-build/install-theme.sh

# 两种方法（选其一即可）：
# 1. 运行一个本地服务器，访问 http://127.0.0.1:8000 可以查看效果
uv run mkdocs serve -v

# 2. 在 site 文件夹下得到静态页面
uv run mkdocs build -v

# 获取 mkdocs 的命令行工具的说明（解释了命令和参数的含义）
uv run mkdocs --help
```

* * *

## 如何参与完善 AI-PM

我们非常欢迎你为 **AI-PM** 编写内容，将自己的所学所得与大家分享。

* * *

## 版权声明

除特别注明外，项目中除了代码部分均采用 <a rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh">(Creative Commons BY-SA 4.0) 知识共享署名 - 相同方式共享 4.0 国际许可协议</a>及附加的 [The Star And Thank Author License](https://github.com/zTrix/sata-license) 进行许可。

换言之，使用过程中您可以自由地共享、演绎，但是必须署名、以相同方式共享、分享时没有附加限制。

* * *

## 鸣谢

本项目基于 [OI Wiki](https://github.com/OI-wiki/OI-wiki) 搭建，主题、构建流程与格式规范均参考其设计，在此致以诚挚感谢！
