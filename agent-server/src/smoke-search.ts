#!/usr/bin/env node
/**
 * 检索冒烟测试:下载线上 search_index.json,对若干查询跑 BM25 top-5,打印相关性供目检。
 * 零依赖(只 import search.ts),可用 `node src/smoke-search.ts` 直接跑(node ≥22 类型剥离),
 * 也可 `npm run smoke`(tsx)。
 *
 * 用法: node src/smoke-search.ts [--index-url <url>] [--top <n>] [查询词...]
 * 默认查询:「RAG」「提示词工程」「Agent 工作流」
 */
import { WikiIndex } from './search.ts';

const DEFAULT_INDEX_URL = 'https://hyc.ac/aipm/search/search_index.json';

function parseArgs(argv: string[]): { indexUrl: string; topN: number; queries: string[] } {
  let indexUrl = process.env['SEARCH_INDEX_URL'] ?? DEFAULT_INDEX_URL;
  let topN = 5;
  const queries: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--index-url') {
      indexUrl = argv[++i] ?? DEFAULT_INDEX_URL;
    } else if (arg === '--top') {
      topN = Number(argv[++i] ?? 5);
    } else {
      queries.push(arg);
    }
  }
  if (queries.length === 0) queries.push('RAG', '提示词工程', 'Agent 工作流');
  return { indexUrl, topN, queries };
}

async function main(): Promise<void> {
  const { indexUrl, topN, queries } = parseArgs(process.argv.slice(2));
  console.log(`下载索引: ${indexUrl}`);
  const index = new WikiIndex(indexUrl, 0, 'https://hyc.ac/aipm');
  await index.load();
  const stats = index.getStats();
  console.log(`条目数: ${stats.docCount}`);

  for (const query of queries) {
    console.log(`\n===== 查询: ${query} =====`);
    const hits = index.search(query, topN);
    if (hits.length === 0) {
      console.log('(无结果)');
      continue;
    }
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i]!;
      console.log(`${i + 1}. [${h.score.toFixed(3)}] ${h.title}`);
      console.log(`   ${h.url}`);
      console.log(`   ${h.snippet}`);
    }
  }
}

main().catch((err) => {
  console.error('smoke 失败:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
