---
title: AI-PM
---

<!--
  hero 区(2026-09-21 起不再走主题子模块的 template: home.html,改为本文件直接输出)
  - 两版引擎 [ 2D | 3D ],默认 3D,控件在 banner 右上角;选择记在 localStorage
    ("pm-home-engine"),无 WebGL 时自动回退 2D 并禁用 3D 按钮
  - 两块 canvas 都在这里,可见性只由 CSS 决定(html[data-pm-engine] 放行其一),
    所以无 JS 时两块都不显示,由 .pm-banner 的静态底图 + 下方品牌文案兜底
  - 结构与类名的样式在 docs/_static/css/extra.css 第 13 节;
    调度/切换在 docs/_static/js/home-engine.js,两版视觉在
    docs/_static/js/home-engine-2d.js、home-engine-3d.js

  注意:site-name / tagline 原先取自 {{ config.site_name }} / {{ config.site_description }},
  改为内联字面量后,若 mkdocs.yml 改了站点名或描述,这里要同步改。
-->
<section class="pm-hero">
  <p class="pm-hero__eyebrow" aria-hidden="true">AI Product Manager Knowledge Base</p>
  <div class="pm-banner">
    <div class="pm-banner__stage" role="img" aria-label="AI-PM 生成式网格:一张被平滑场顶歪的方格纸,一条绘图笔左右扫过并点亮所经的列,5 枚信号方块沿同一个场漂移">
      <canvas class="pm-banner__canvas pm-banner__canvas--2d" aria-hidden="true"></canvas>
      <canvas class="pm-banner__canvas pm-banner__canvas--3d" aria-hidden="true"></canvas>
    </div>
    <span class="pm-banner__id" aria-hidden="true">AIPM ▸ GRID</span>
    <span class="pm-banner__stat" data-pm-stat aria-hidden="true">ENGINE 3D ▸ 16×9×7 SHEAF ▸ SCAN 9s</span>
    <div class="pm-banner__switch" role="group" aria-label="首页视觉引擎">
      <button type="button" class="pm-switch" data-pm-set="2d" aria-pressed="false">2D</button>
      <button type="button" class="pm-switch is-on" data-pm-set="3d" aria-pressed="true">3D</button>
    </div>
  </div>
  <div class="pm-hero__brand">
    <h1 class="site-name">AI-PM</h1>
    <p class="tagline">AI-PM 是一个 AI 产品经理知识整合站点，提供有趣又实用的 AI 产品、模型、工具与工作流知识，帮助广大 AI 产品从业者更快更深入地学习与实践</p>
  </div>
  <div class="pm-hero__cta">
    <a class="pm-btn pm-btn--primary" href="#pm-home-body">开始学习</a>
    <a class="pm-btn pm-btn--ghost" href="intro/about/">关于项目</a>
  </div>
  <div class="pm-hero__search">
    <button class="pm-btn pm-btn--search" type="button" onclick='var t=document.getElementById("__search");t&&!t.checked&&t.click(),document.querySelector(".md-search__input")?.focus()'>搜索整个知识库</button>
  </div>
</section>

<!-- #pm-home-body 必须是**自闭合**的独立 HTML 块:
     本项目没有开 md_in_html 扩展,块级标签的原始 HTML 块会一路吞到配对的
     </div> —— 把 Markdown 写在 <div> 里会原样输出成字面文本(踩过)。
     所以这里只放一个空标记 div 作锚点,下面两节 Markdown 与它**同级**,
     extra.css 第 11.9 节用 `.pm-home-body ~ h2` / `~ ul` 兄弟选择器限定作用域。 -->
<div class="pm-home-body" id="pm-home-body"></div>

<div class="pm-card-grid">
  <a class="pm-card" href="pm/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"/></svg>
    <span class="pm-card__title">产品方法论</span>
    <span class="pm-card__desc">需求分析、用户研究、产品设计与原型、项目管理与迭代、商业化与增长</span>
  </a>
  <a class="pm-card" href="tech/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M9 9h6v6H9z"/></svg>
    <span class="pm-card__title">工程与架构</span>
    <span class="pm-card__desc">开发流程、系统架构、工程术语与 AI-Native 研发流程</span>
  </a>
  <a class="pm-card" href="management/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 21c.5-4 2.5-6 6-6s5.5 2 6 6M15 15c3 0 5 2 6 6"/></svg>
    <span class="pm-card__title">工商管理</span>
    <span class="pm-card__desc">组织与决策、市场与消费者、战略创新、项目与财务</span>
  </a>
  <a class="pm-card" href="business/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M6 21v-6M11 21V8M16 21v-11"/></svg>
    <span class="pm-card__title">商业与财会</span>
    <span class="pm-card__desc">金融学、会计学、公司金融、计量经济学等 19 门课</span>
  </a>
  <a class="pm-card" href="ai/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3"/></svg>
    <span class="pm-card__title">AI 基础</span>
    <span class="pm-card__desc">机器学习地基、大模型、多模态、提示词、RAG、Agent、评估安全与前沿</span>
  </a>
  <a class="pm-card" href="practice/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6"/><path d="M10 3v5.5L4.7 18a2 2 0 001.8 3h11a2 2 0 001.8-3L14 8.5V3"/><path d="M7.5 15h9"/></svg>
    <span class="pm-card__title">AI 产品实战</span>
    <span class="pm-card__desc">对话助手、知识库问答、Agent、Copilot、工作流自动化</span>
  </a>
  <a class="pm-card" href="tools/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h9M17 8h3"/><circle cx="15" cy="8" r="2"/><path d="M4 16h3M11 16h9"/><circle cx="9" cy="16" r="2"/></svg>
    <span class="pm-card__title">工具与平台</span>
    <span class="pm-card__desc">LLM API、开源框架、提示词与评测工具、数据标注</span>
  </a>
  <a class="pm-card" href="case/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 010-5H20"/></svg>
    <span class="pm-card__title">学习资源</span>
    <span class="pm-card__desc">信息源、读书笔记与播客笔记</span>
  </a>
  <a class="pm-card" href="job/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
    <span class="pm-card__title">求职专题</span>
    <span class="pm-card__desc">产品经理岗位类别、协作团队与岗位、真实 JD 样本与求职发展</span>
  </a>
  <a class="pm-card" href="vertical/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>
    <span class="pm-card__title">垂直领域</span>
    <span class="pm-card__desc">网络安全、金融、法律、教育、地球科学、医疗与企业服务的对象、规则与 AI 切入点</span>
  </a>
  <a class="pm-card" href="intro/about/">
    <svg class="pm-card__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <span class="pm-card__title">关于</span>
    <span class="pm-card__desc">项目介绍、更新原则、如何参与、格式手册与 FAQ</span>
  </a>
</div>

## 本站的原则

-   **免费开放**：内容免费阅读，任何人可以参与贡献
-   **持续更新**：稳定方法沉淀为框架，变化较快的事实注明核验日期
-   **知识自由**：本站源于社区，提倡知识自由，不商业化
-   **可验证与可复用**：尽量给出来源、判断标准、评测方法和可执行产出

## 现在适合从哪里开始

-   想补产品基本功：从[产品方法论](pm/index.md)开始，再按[自学路线](intro/self-study-roadmap.md)推进
-   想理解 AI 产品：阅读[AI 基础](ai/index.md)与[AI 产品实战](practice/index.md)，同步练习评测与失败分析
-   想补工程协作：阅读[工程与架构](tech/index.md)，重点关注系统边界、上线流程和 AI-Native 研发
-   想准备求职：先看[AI 产品经理能力模型](intro/capability.md)，再进入[求职专题](job/index.md)
-   想补行业知识：进入[垂直领域](vertical/index.md)，按网络安全、金融、法律、教育、地球科学、医疗健康或企业服务进入对应领域
-   想贡献内容：阅读[如何参与](intro/htc.md)，通过 GitHub Issues 或 Pull Request 反馈和提交
