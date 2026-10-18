静态 SVG 的 XML 声明检查使用 Saxes 6.0.0。解析器读取输入声明；未声明编码或声明 UTF-8 时继续校验，其余编码及 XML 解析错误立即拒绝。字节层面的严格 UTF-8 解码和 document 级处理指令拒绝保留在 `chart-context.js`。

在本目录使用锁文件生成本地浏览器资源：

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

产物为 `docs/_static/js/vendor/svg-xml.js`，由 `mkdocs.yml` 在 `chart-context.js` 前加载。资源随站点发布；页面运行不依赖第三方 CDN。普通站点构建直接使用已保存产物。

构建工具固定为 esbuild 0.25.10，解析依赖及传递依赖固定在 `package-lock.json`。Saxes 和 xmlchars 的许可证保存在同一 vendor 目录。修改依赖后需重新生成资源并核对摘要。
