:+1::tada: 首先，感谢你抽出宝贵时间为 **AI-PM**（中文 AI 产品管理知识 wiki）做出贡献！ :tada::+1:

AI-PM 是协作维护的原创中文资料，覆盖 AI 产品方法论、LLM 能力与工具、提示词工程、Agent 工作流、评测与求职专题等，站点地址 <https://aipm.ac/>，仓库地址 <https://github.com/AI-PM-Wiki/aipm>。

请在提交拉取请求（Pull Request）前阅读[如何参与](https://aipm.ac/intro/htc/)，并确认[格式手册](https://aipm.ac/intro/format/)中的文档格式要求（中文全角标点、中英文之间留空格、标题从 `##` 起等）。

如果内容**尚未完成**，请考虑先新建 Issue 讨论，或本次作为 draft PR 提交。

在提交 Pull Request 的[描述](.github/pull_request_template.md)中，勾选「我已认真阅读贡献指南」，表明**你已知晓**：

+ 请在回应建议、问题或 Pull Request 之前仔细阅读，并详细说明自己的看法，以免引起不必要的误会。

+ 请跟进你的 Pull Request。如 Pull Request 长时间没有回应修改请求，可能会被直接关闭。

+ 我们欢迎你审核其他 Pull Request，但请以友好的方式发表评论。负面评论会打击社区贡献者的贡献热情，因此不建议这样做。当你在 Pull Request 中发现问题时，欢迎进一步提交 Pull Request，但不欢迎你对贡献者发表负面评价。

+ 请记住，你身处一个社区之中：需要学会接受其他人的贡献，以及他们贡献的内容，甚至可能和他们协作。如果你不同意某个观点，可以创建分支并自己进行更改；另一方面，你的想法也可能不够完善，所以需要听取别人的意见。

**提交规范**：

+ **分支**：`dev` 为集成分支，Pull Request 请以 `dev` 为 base 提交；`main` 为发布分支，只通过 Pull Request 合入。
+ **Commit 与 PR 标题**：遵循 Conventional Commits，例如 `docs(pm/xx.md): ...`、`fix(ai/xx.md): ...`。
+ **本地门禁**：提交前请确保以下命令通过：`git diff --check`、`uv run mkdocs build -q`、`python3 scripts/check-characters.py`。

如有疑问，欢迎查阅 [F.A.Q.](https://aipm.ac/intro/faq/)，或在 [Issues](https://github.com/AI-PM-Wiki/aipm/issues) 中提出。感谢你为 AI-PM 及其社区发展提供的支持和力量！:joy:
