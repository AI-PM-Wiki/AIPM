/**
 * 站内搜索:search_index.json 抓取/缓存、中文分词、BM25 检索、页面定位。
 * 零依赖(仅用全局 fetch / Date / timers),可被 node 类型剥离直接执行。
 *
 * 索引结构(2026-08 核实):{config, docs:[{location, title, text}]}。
 * location 形如 "ai/" 整页条目 或 "ai/#锚点" 分节条目;解析器对新增字段宽容(忽略未知键)。
 */
export interface IndexDoc {
  location: string;
  title: string;
  text: string;
}

export interface SearchHit {
  /** 页面标题(分节条目取所属页面标题,见 resolvePage) */
  title: string;
  /** 完整 URL(基于 SITE_BASE 拼接) */
  url: string;
  /** 命中 token 附近 ±60 字的摘要,≤300 字 */
  snippet: string;
  /** BM25 得分(仅调试/排序用) */
  score: number;
  location: string;
}

export interface ResolvedPage {
  title: string;
  url: string;
  text: string;
  /** 由多少个分节条目合并(整页条目为 1) */
  sectionCount: number;
}

export interface IndexStats {
  docCount: number;
  stale: boolean;
  lastLoadedAt: number | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// 分词
// ---------------------------------------------------------------------------

const LATIN_RUN_RE = /^[a-z0-9]$/;
const CJK_CHAR_RE =
  /^[⺀-⻿぀-ヿ㐀-䶿一-鿿豈-﫿]$/;

/** 全角 → 半角(ASCII 区),再转小写;中文标点保持(作分隔符)。 */
export function normalizeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000) {
      out += ' ';
    } else {
      out += text[i];
    }
  }
  return out.toLowerCase();
}

function emitCjkRun(run: string, out: string[]): void {
  if (run.length === 0) return;
  // unigram
  for (let i = 0; i < run.length; i++) out.push(run[i]!);
  // 字符 bigram
  for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
}

/** 归一化 → 拉丁/数字 token → CJK 连续段拆 unigram + bigram。
 * 「提示词工程」→ 提/示/词/工/程/提示/示词/词工/工程 */
export function tokenize(text: string): string[] {
  const norm = normalizeText(text);
  const tokens: string[] = [];
  let latin = '';
  let cjk = '';
  const flushLatin = () => {
    if (latin) {
      tokens.push(latin);
      latin = '';
    }
  };
  const flushCjk = () => {
    emitCjkRun(cjk, tokens);
    cjk = '';
  };
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i]!;
    if (LATIN_RUN_RE.test(ch)) {
      if (cjk) flushCjk();
      latin += ch;
    } else if (CJK_CHAR_RE.test(ch)) {
      if (latin) flushLatin();
      cjk += ch;
    } else {
      flushLatin();
      flushCjk();
    }
  }
  flushLatin();
  flushCjk();
  return tokens;
}

// ---------------------------------------------------------------------------
// BM25
// ---------------------------------------------------------------------------

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const TF_CAP = 3;

/** 单字 token 的 df 占比超过此值视为无信息虚词(是/的/了…),查询端剔除。 */
const DROP_COMMON_DF_FRAC = 0.4;
/** 二字 token 的构成单字 df 占比均超过此值 → 虚词组合(什么/么是/怎么…),剔除。 */
const DROP_COMPOSITE_DF_FRAC = 0.3;

/**
 * 查询端停用词过滤(纯数据驱动,无手工词表):
 *  - 单字 token df/N > DROP_COMMON_DF_FRAC → 剔除(如 是/的/了,几无区分度)
 *  - 二字 token df/N > DROP_COMMON_DF_FRAC 或由两个超高频单字组成 → 剔除
 *    (「什么是 X」的 什么/么是/是什 这类虚词组合会靠标题命中反杀真正主题词;
 *     内容词如 产品/经理 的构成字通常达不到 0.3,不受影响)
 * 全部被剔除时回退原 token,退化查询保底旧行为。
 */
export function filterQueryTokens(
  tokens: string[],
  docFreq: Map<string, number>,
  docCount: number,
): string[] {
  const filtered = tokens.filter((tok) => {
    const df = docFreq.get(tok) ?? 0;
    if (df / docCount > DROP_COMMON_DF_FRAC) return false;
    if (tok.length === 2) {
      const dfA = docFreq.get(tok[0]!) ?? 0;
      const dfB = docFreq.get(tok[1]!) ?? 0;
      if (dfA / docCount > DROP_COMPOSITE_DF_FRAC && dfB / docCount > DROP_COMPOSITE_DF_FRAC) {
        return false;
      }
    }
    return true;
  });
  return filtered.length > 0 ? filtered : tokens;
}

export function bm25Score(
  queryTokens: string[],
  docFreq: Map<string, number>,
  docCount: number,
  avgDocLen: number,
  docTokens: string[],
): number {
  const docLen = docTokens.length;
  const tfMap = new Map<string, number>();
  for (const tok of docTokens) tfMap.set(tok, (tfMap.get(tok) ?? 0) + 1);
  let score = 0;
  for (const tok of queryTokens) {
    const df = docFreq.get(tok) ?? 0;
    if (df === 0) continue;
    const tf = Math.min(tfMap.get(tok) ?? 0, TF_CAP);
    if (tf === 0) continue;
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    score += (idf * tf * (BM25_K1 + 1)) / denom;
  }
  return score;
}

// ---------------------------------------------------------------------------
// 摘要
// ---------------------------------------------------------------------------

const SNIPPET_HALF_WINDOW = 60;
const SNIPPET_MAX_LEN = 300;

function collapseWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 命中 token 附近 ±60 字摘要;优先出现位置最靠前的 query token,长 token 优先。 */
export function makeSnippet(text: string, queryTokens: string[], maxLen = SNIPPET_MAX_LEN): string {
  let best: { idx: number; len: number } | null = null;
  for (const tok of queryTokens) {
    if (tok.length < 2) continue;
    const idx = text.indexOf(tok);
    if (idx < 0) continue;
    if (best === null || idx < best.idx || (idx === best.idx && tok.length > best.len)) {
      best = { idx, len: tok.length };
    }
  }
  let snippet: string;
  if (best === null) {
    snippet = text.slice(0, maxLen);
  } else {
    const start = Math.max(0, best.idx - SNIPPET_HALF_WINDOW);
    const end = Math.min(
      text.length,
      best.idx + best.len + SNIPPET_HALF_WINDOW,
    );
    snippet = text.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < text.length) snippet = snippet + '…';
    if (snippet.length > maxLen) snippet = snippet.slice(0, maxLen - 1) + '…';
  }
  return collapseWs(snippet);
}

// ---------------------------------------------------------------------------
// 索引存储
// ---------------------------------------------------------------------------

interface RawIndexPayload {
  config?: Record<string, unknown>;
  docs?: unknown[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const BLOCK_END_RE = /<\/(?:p|div|li|h[1-6]|tr|blockquote)>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]*>/g;
const ENTITY_RE = /&(amp|lt|gt|quot|#39|nbsp);/g;

function decodeEntities(text: string): string {
  return text.replace(ENTITY_RE, (m) => {
    switch (m) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&#39;':
        return "'";
      default:
        return ' ';
    }
  });
}

/**
 * 去除 mkdocs 搜索索引 text 字段里的 HTML 标记(2026-08 线上索引含 <p> 等块级标签)。
 * 块级闭合标签先换成换行,保住段落边界,便于摘要与整页阅读。
 */
export function stripHtml(text: string): string {
  return decodeEntities(
    text.replace(BLOCK_END_RE, '\n').replace(BR_RE, '\n').replace(TAG_RE, ''),
  );
}

/** 宽容解析:只要求 location 字符串;title/text 缺失时给空串;忽略未知字段。 */
export function parseIndexPayload(payload: unknown): IndexDoc[] {
  if (!isRecord(payload) || !Array.isArray(payload.docs)) {
    throw new Error('search_index.json 结构异常:缺少 docs 数组');
  }
  const docs: IndexDoc[] = [];
  for (const raw of payload.docs) {
    if (!isRecord(raw)) continue;
    const location = raw['location'];
    if (typeof location !== 'string') continue;
    docs.push({
      location,
      title: typeof raw['title'] === 'string' ? raw['title'] : '',
      text: typeof raw['text'] === 'string' ? stripHtml(raw['text']) : '',
    });
  }
  return docs;
}

const FETCH_TIMEOUT_MS = 30_000;

export async function fetchIndexJson(url: string): Promise<IndexDoc[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`抓取 search index 失败: HTTP ${res.status} (${url})`);
  }
  return parseIndexPayload(await res.json());
}

export class WikiIndex {
  private docs: IndexDoc[] = [];
  private docTokens: string[][] = [];
  private docFreq = new Map<string, number>();
  private avgDocLen = 0;
  private lastLoadedAt: number | null = null;
  private lastError: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly indexUrl: string;
  private readonly refreshMs: number;
  private readonly siteBase: string;

  constructor(indexUrl: string, refreshMs: number, siteBase: string) {
    this.indexUrl = indexUrl;
    this.refreshMs = refreshMs;
    this.siteBase = siteBase;
  }

  /** 直接由解析后的条目构建(测试 / CLI 配置检查用)。 */
  static fromDocs(docs: IndexDoc[], siteBase = 'https://hyc.ac/aipm'): WikiIndex {
    const stub = new WikiIndex('', 0, siteBase);
    stub.replace(docs);
    return stub;
  }

  private replace(docs: IndexDoc[]): void {
    const docTokens: string[][] = new Array(docs.length);
    const docFreq = new Map<string, number>();
    let totalLen = 0;
    for (let i = 0; i < docs.length; i++) {
      // 标题 token ×3 并入正文(标题命中是「RAG」这类专名页最强的召回信号;
      // tf 上限 3 使标题 token 天然顶格,正文重复不计入更多)
      const titleToks = tokenize(docs[i]!.title);
      const toks = [...titleToks, ...titleToks, ...titleToks, ...tokenize(docs[i]!.text)];
      docTokens[i] = toks;
      totalLen += toks.length;
      const seen = new Set<string>();
      for (const tok of toks) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
      }
    }
    this.docs = docs;
    this.docTokens = docTokens;
    this.docFreq = docFreq;
    this.avgDocLen = docs.length > 0 ? totalLen / docs.length : 0;
    this.lastLoadedAt = Date.now();
    this.lastError = null;
  }

  /** 首次加载;失败抛出 → 启动失败。 */
  async load(): Promise<void> {
    const docs = await fetchIndexJson(this.indexUrl);
    this.replace(docs);
  }

  /** 后台刷新;失败保留旧索引并记录 lastError(stale 标记)。 */
  async refresh(): Promise<void> {
    try {
      await this.load();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  startAutoRefresh(): void {
    if (this.refreshTimer !== null || this.refreshMs <= 0) return;
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, this.refreshMs);
  }

  stop(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getStats(): IndexStats {
    return {
      docCount: this.docs.length,
      stale: this.lastError !== null,
      lastLoadedAt: this.lastLoadedAt,
      lastError: this.lastError,
    };
  }

  get siteUrl(): string {
    return this.siteBase;
  }

  /** BM25 top-N 检索,只求召回(agent 会再读全文)。 */
  search(query: string, topN = 8): SearchHit[] {
    if (this.docs.length === 0) return [];
    const queryTokens = filterQueryTokens(
      [...new Set(tokenize(query))],
      this.docFreq,
      this.docs.length,
    );
    if (queryTokens.length === 0) return [];
    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < this.docs.length; i++) {
      const score = bm25Score(
        queryTokens,
        this.docFreq,
        this.docs.length,
        this.avgDocLen,
        this.docTokens[i]!,
      );
      if (score > 0) scored.push({ idx: i, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN).map(({ idx, score }) => {
      const doc = this.docs[idx]!;
      return {
        title: doc.title || doc.location || '(未命名页面)',
        url: this.docUrl(doc.location),
        snippet: makeSnippet(doc.text, queryTokens),
        score,
        location: doc.location,
      };
    });
  }

  private docUrl(location: string): string {
    if (location === '') return this.siteBase + '/';
    return this.siteBase + '/' + location.replace(/^\/+/, '');
  }

  /**
   * read_wiki_page 定位:去 origin/base → 精确匹配整页条目;
   * 缺整页条目时合并 path/# 下所有分节条目;补斜杠兜底。纯内存,不发活 HTML 请求。
   */
  resolvePage(urlOrPath: string): ResolvedPage | null {
    const base = new URL(this.siteBase);
    let input = urlOrPath.trim();
    if (input === '') input = '/';
    // 去掉 origin 与 base path
    if (/^https?:\/\//i.test(input)) {
      try {
        const u = new URL(input);
        input = u.pathname + u.hash;
      } catch {
        return null;
      }
    }
    const basePath = base.pathname.replace(/\/+$/, '');
    if (basePath !== '' && input.startsWith(basePath + '/')) {
      input = input.slice(basePath.length);
    } else if (basePath !== '' && input === basePath) {
      input = '/';
    }
    input = input.replace(/^\/+/, '');

    const candidates: string[] = [];
    const add = (loc: string) => {
      if (!candidates.includes(loc)) candidates.push(loc);
    };
    add(input);
    const hashIdx = input.indexOf('#');
    const pagePath = hashIdx >= 0 ? input.slice(0, hashIdx) : input;
    const anchor = hashIdx >= 0 ? input.slice(hashIdx) : '';
    // 精确整页条目
    add(pagePath);
    // 无锚点输入时也试尾部补斜杠(如 "ai/agent" → "ai/agent/")
    if (!pagePath.endsWith('/') && pagePath !== '') add(pagePath + '/');
    // 带锚点时,锚点版本 + 无锚点版本 + 补斜杠
    if (anchor !== '') {
      add(anchor === '#' ? pagePath : pagePath + anchor);
      if (!pagePath.endsWith('/')) add(pagePath + '/' + anchor);
    }

    for (const candidate of candidates) {
      const exact = this.findLocation(candidate);
      if (exact !== null) {
        return {
          title: exact.title || exact.location || '(未命名页面)',
          url: this.docUrl(exact.location),
          text: truncateText(exact.text),
          sectionCount: 1,
        };
      }
    }

    // 锚点带百分号编码(如 %E5%9F%BA...)时解码再试一次
    if (input.includes('%')) {
      try {
        const decoded = decodeURIComponent(input);
        const viaDecoded = this.resolvePage(decoded);
        if (viaDecoded !== null) return viaDecoded;
      } catch {
        // 非法编码,忽略
      }
    }

    // 合并分节:pagePath 或 pagePath/ 下所有 location 以 "#" 开头(或恰好 pagePath+anchor)的条目
    for (const baseLoc of [...new Set([pagePath, pagePath + '/'])]) {
      const merged = this.mergeSections(baseLoc);
      if (merged !== null) return merged;
    }
    return null;
  }

  private findLocation(location: string): IndexDoc | null {
    return this.docs.find((d) => d.location === location) ?? null;
  }

  /** 合并 baseLoc 下所有分节条目(location === baseLoc 或 baseLoc#...),按 location 排序。 */
  private mergeSections(baseLoc: string): ResolvedPage | null {
    const prefix = baseLoc + '#';
    const sections = this.docs
      .filter(
        (d) => d.location === baseLoc || d.location.startsWith(prefix),
      )
      .sort((a, b) => a.location.localeCompare(b.location, 'zh'));
    if (sections.length === 0) return null;
    const title = sections.find((s) => s.title)?.title || baseLoc;
    let text = '';
    for (const s of sections) {
      if (text.length > 0) text += '\n\n';
      if (s.title) text += `## ${s.title}\n\n`;
      text += s.text;
    }
    return {
      title,
      url: this.docUrl(baseLoc),
      text: truncateText(text),
      sectionCount: sections.length,
    };
  }
}

const PAGE_TEXT_MAX = 12_000;

function truncateText(text: string): string {
  if (text.length <= PAGE_TEXT_MAX) return text;
  return text.slice(0, PAGE_TEXT_MAX) + '\n\n…(超出 12000 字,已截断)';
}
