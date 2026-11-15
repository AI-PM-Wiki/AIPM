# scripts

本目录存放用于构建、检查和辅助的脚本。

-   `pre-build` 运行于构建前的脚本
    - `install-theme.sh, install-theme-vendor.sh` 安装 mkdocs 主题，并清理主题的第三方 vendor 资源
      （主题克隆来源由 `.gitmodules` 的 `url` 配置；vendored 资源下载已随 MathJax 移除，见 2026-08 清理）
    - `pre-build.sh` 在 CI 上构建生产环境站点前运行的脚本（安装主题）
-   `post-build` 运行于构建后的脚本
    - `html-postprocess.ts` 后处理任务框架：对 `site/` 下每个 HTML 文件顺序执行指定任务，
      任务目录需包含 `task-handler.ts`（当前构建仅启用 `external-links`）
    - `external-links` 处理站外链接（自动添加 `target="_blank"`，站内判定基于站点 `site_url`）
    - `commits-info` 根据 Git 历史与 GitHub API 渲染页面的更新日期与贡献者列表（需 `GITHUB_TOKEN`，
      并依赖 `authors-cache` 分支的 `authors.json`；当前构建未启用）
    - `minify-html` 压缩构建产物中的 HTML
- `hooks/on_env.py` 的 `on_post_build` 另做三件构建后优化(2026-09-22,issue #91):
  - 压缩 `site/_static/{css,js}` 的 CSS/JS(`_minify_static_assets`,依赖 `rcssmin`/`rjsmin`;
    压缩器缺失或自检不通过时保留原文件并告警,不会把可疑产物发上线;`_static/js/vendor/`
    的第三方文件按原样发布,保留其中的许可证声明)
  - 把页面里 `_static` 引用的 `?v=` 换成产物内容哈希(`_optimize_pages`),
    `mkdocs.yml` 里的版本号因此不再是缓存击穿的必要条件
  - 把 Google Fonts 样式表改成非阻塞加载(`media=print` + `onload` 切换,附 `<noscript>` 兜底)
  顺序固定:先压缩再算哈希,哈希必须对应文件最终字节
-   `post-deploy` 部署后的辅助脚本
    - `convert-sitemap.py` 将 XML sitemap 转换为百度收录推送所需的 TXT 格式（推送脚本已移除，当前未接入构建流程）
-   `netlify` 用于 Netlify 上的预览构建（参见 `/netlify.toml`）
    - `build.sh` 在 Netlify 上的构建全过程（安装 Python/Node 依赖、安装主题、构建并做 HTML 后处理）

其他脚本：

- `check-characters.py` 扫描 Markdown 文件中的异常非可见字符，以及可替换为对应 CJK 字符的部首
  （和笔画字符）；字符数据见同目录 `char-map.json`。为仓库门禁之一。
- `check-doc-links.py` 扫描 `docs/**/*.md` 的站内 Markdown/HTML 链接与标题锚点（外链跳过，
  与 CI htmltest 的 `skip_external` 一致）。实现见 `doc_links.py`。为仓库门禁之一。
- `gen-favicon.py` 生成站点 favicon（用法见文件头部注释）
- `vendor-mathjax.sh` 下载 MathJax npm 包，校验 sha512 摘要后复制到
  `docs/_static/js/vendor/mathjax-<版本>/`。除 `tex-chtml.js` 外，还包含 MathJax 运行时按需加载的
  CHTML 字体、TeX 扩展、右键菜单的无障碍组件与语音规则数据、SVG 输出，均按 npm 包 `es5/` 的目录结构
  存放，MathJax 根据 `tex-chtml.js` 自身的地址推算这些文件的路径。目录名带版本号：service worker 对
  `_static/` 使用缓存优先策略，Netlify 对 `_static/js/` 设置一年缓存，升级后所有文件的地址随版本号一起变化。
  升级时修改脚本中的 `VERSION` 与 `INTEGRITY`（取自 `npm view mathjax@<版本> dist.integrity`），执行
  `bash scripts/vendor-mathjax.sh meta/mathjax-vendor-<版本>`，再把 `mkdocs.yml` 的 `extra_javascript`
  改为新目录。MathJax 使用 Apache-2.0 许可，许可证保存在同一目录
- `utils/find_jk.py` 遗留小工具：查找源文件中非中文码位的汉字字符
