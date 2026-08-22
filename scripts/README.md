# scripts

本目录存放用于构建、检查和辅助的脚本。

-   `pre-build` 运行于构建前的脚本
    - `install-theme.sh, install-theme-vendor.sh` 安装 mkdocs 主题，以及主题所需的第三方库
      （资源下载链接可通过环境变量配置，如 `MATHJAX_URL`）
    - `pre-build.sh` 在 CI 上构建生产环境站点前运行的脚本（安装主题）
-   `post-build` 运行于构建后的脚本
    - `html-postprocess.ts` 后处理任务框架：对 `site/` 下每个 HTML 文件顺序执行指定任务，
      任务目录需包含 `task-handler.ts`（当前构建仅启用 `external-links`）
    - `external-links` 处理站外链接（自动添加 `target="_blank"`，站内判定基于站点 `site_url`）
    - `commits-info` 根据 Git 历史与 GitHub API 渲染页面的更新日期与贡献者列表（需 `GITHUB_TOKEN`，
      并依赖 `authors-cache` 分支的 `authors.json`；当前构建未启用）
    - `minify-html` 压缩构建产物中的 HTML
-   `post-deploy` 部署后的辅助脚本
    - `convert-sitemap.py` 将 XML sitemap 转换为百度收录推送所需的 TXT 格式（推送脚本已移除，当前未接入构建流程）
-   `netlify` 用于 Netlify 上的预览构建（参见 `/netlify.toml`）
    - `build.sh` 在 Netlify 上的构建全过程（安装 Python/Node 依赖、安装主题、构建并做 HTML 后处理）

其他脚本：

- `check-characters.py` 扫描 Markdown 文件中的异常非可见字符，以及可替换为对应 CJK 字符的部首
  （和笔画字符）；字符数据见同目录 `char-map.json`。为仓库门禁之一。
- `gen-favicon.py` 生成站点 favicon（用法见文件头部注释）
- `utils/find_jk.py` 遗留小工具：查找源文件中非中文码位的汉字字符
