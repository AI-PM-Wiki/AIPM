#!/usr/bin/env node
/**
 * CLI 壳:验证 runAgent 端到端行为。
 *
 *   node dist/cli.js [--prompt "问题"]     真跑一轮 agent(需 ANTHROPIC_API_KEY)
 *   node dist/cli.js --check-config       无 key 的配置断言:tools:[] + MCP-only +
 *                                          strictMcpConfig 等组装正确性
 *
 * 真跑模式会打印:init 工具清单(断言只剩 mcp__wiki__*)、MCP 服务器状态、
 * 回答前 200 字、成本/轮数/耗时。
 */
import { existsSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { WikiIndex } from './search.ts';
import { runAgent, buildAgentOptions, SYSTEM_PROMPT } from './agent.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

function parseArgs(argv: string[]): { mode: 'run' | 'check-config'; prompt: string } {
  let mode: 'run' | 'check-config' = 'run';
  let prompt = '什么是 RAG?它在 AI 产品里怎么用?';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--check-config') mode = 'check-config';
    else if (arg === '--prompt') prompt = argv[++i] ?? prompt;
  }
  return { mode, prompt };
}

function checkConfig(): number {
  const config = loadConfig({ ...process.env, ANTHROPIC_API_KEY: 'test-key' });
  const index = WikiIndex.fromDocs([
    { location: 'ai/', title: 'AI 基础', text: 'RAG 知识库问答 RAG 评估' },
  ]);
  const { options } = buildAgentOptions({
    config,
    index,
    callbacks: { onDelta: () => {}, onThinking: () => {}, onSources: () => {} },
  });
  const checks: Array<[string, boolean]> = [
    ['tools 为空数组(禁用全部内置工具)', Array.isArray(options.tools) && options.tools.length === 0],
    ['disallowedTools 包含 9 个纵深防御项', (options.disallowedTools ?? []).length >= 9],
    ['mcpServers 仅含 wiki(sdk 进程内)', Object.keys(options.mcpServers ?? {}).join(',') === 'wiki'],
    ['strictMcpConfig = true', options.strictMcpConfig === true],
    ['settingSources 为空数组', Array.isArray(options.settingSources) && options.settingSources.length === 0],
    ['persistSession = false', options.persistSession === false],
    ['permissionMode = bypassPermissions', options.permissionMode === 'bypassPermissions'],
    ['allowDangerouslySkipPermissions = true', options.allowDangerouslySkipPermissions === true],
    ['maxTurns 生效', options.maxTurns === config.maxTurns],
    ['maxBudgetUsd 生效', options.maxBudgetUsd === config.maxBudgetUsd],
    ['effort 生效', options.effort === config.effort],
    ['model 生效', options.model === config.model],
    ['系统提示词含检索流程约束', SYSTEM_PROMPT.includes('search_wiki') && SYSTEM_PROMPT.includes('read_wiki_page')],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
  return failed === 0 ? 0 : 1;
}

async function run(prompt: string): Promise<number> {
  let config: ReturnType<typeof loadConfig> | null = null;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[cli] ${err instanceof Error ? err.message : err}`);
    console.error('[cli] 缺 ANTHROPIC_API_KEY 或环境变量不合法,无法真跑;可用 --check-config 做无 key 断言。');
    return 1;
  }

  const index = new WikiIndex(config.searchIndexUrl, 0, config.siteBase);
  console.log(`[cli] 加载索引: ${config.searchIndexUrl}`);
  await index.load();
  console.log(`[cli] 条目数: ${index.getStats().docCount},模型: ${config.model},预算: $${config.maxBudgetUsd}`);

  let tools: string[] = [];
  let mcpServers: { name: string; status: string }[] = [];
  let answer = '';
  let thinkingChars = 0;
  let sourcesSeen = 0;

  const outcome = await runAgent({
    message: prompt,
    history: [],
    config,
    index,
    callbacks: {
      onDelta: (text) => {
        answer += text;
        if (answer.length <= 200) process.stdout.write(text);
      },
      onThinking: (text) => {
        thinkingChars += text.length;
      },
      onSources: () => {
        sourcesSeen++;
      },
      onInit: (info) => {
        tools = info.tools;
        mcpServers = info.mcpServers;
      },
      onStderr: (line) => console.error(`[sdk] ${line.slice(0, 200)}`),
    },
  });

  console.log('\n\n===== init 工具面(应只剩 mcp__wiki__*) =====');
  console.log('tools:', JSON.stringify(tools));
  console.log('mcp_servers:', JSON.stringify(mcpServers));
  const foreign = tools.filter((t) => !t.startsWith('mcp__wiki__'));
  console.log(foreign.length === 0 ? 'PASS  工具面仅 mcp__wiki__*' : `FAIL  存在内置工具: ${foreign.join(', ')}`);

  console.log('\n===== 回答(前 200 字) =====');
  console.log(answer.slice(0, 200));

  console.log('\n===== 结果 =====');
  console.log(JSON.stringify(
    { ok: outcome.ok, code: outcome.code, costUsd: outcome.costUsd, numTurns: outcome.numTurns, durationMs: outcome.durationMs, answerChars: answer.length, thinkingChars, sourcesSeen },
    null,
    2,
  ));

  if (!outcome.ok && outcome.message !== 'aborted') {
    console.error(`[cli] 失败: ${outcome.code} ${outcome.message}`);
  }
  return outcome.ok ? 0 : 1;
}

const { mode, prompt } = parseArgs(process.argv.slice(2));
const code = mode === 'check-config' ? checkConfig() : await run(prompt);
process.exit(code);
