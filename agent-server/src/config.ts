/**
 * 环境变量解析与校验。
 * 缺 ANTHROPIC_API_KEY 时快速失败(zod parse 抛错,启动即退出)。
 * .env 的加载由入口模块(server.ts / cli.ts)负责,这里保持纯净、可单测。
 */
import { z } from 'zod';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Config {
  port: number;
  anthropicApiKey: string;
  model: string;
  effort: EffortLevel;
  maxBudgetUsd: number;
  maxTurns: number;
  siteBase: string;
  searchIndexUrl: string;
  indexRefreshMs: number;
  allowedOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  concurrencyLimit: number;
  bodyLimitBytes: number;
  trustProxy: boolean;
  scratchDir: string;
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  ANTHROPIC_API_KEY: z.string().min(1),
  MODEL: z.string().min(1).default('claude-opus-5'),
  EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  MAX_BUDGET_USD: z.coerce.number().positive().default(0.3),
  MAX_TURNS: z.coerce.number().int().min(1).max(100).default(8),
  SITE_BASE: z.string().url().default('https://hyc.ac/aipm'),
  SEARCH_INDEX_URL: z
    .string()
    .url()
    .default('https://hyc.ac/aipm/search/search_index.json'),
  INDEX_REFRESH_MS: z.coerce.number().int().min(10_000).default(1_800_000),
  ALLOWED_ORIGINS: z
    .string()
    .default('https://hyc.ac,http://localhost:8000,http://127.0.0.1:8000'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(600_000),
  CONCURRENCY_LIMIT: z.coerce.number().int().min(1).max(64).default(4),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).default(65_536),
  TRUST_PROXY: z.string().default('false'),
  SCRATCH_DIR: z.string().min(1).default('/tmp/aipm-agent-scratch'),
});

function parseBool(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`环境变量校验失败: ${problems}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    model: e.MODEL,
    effort: e.EFFORT,
    maxBudgetUsd: e.MAX_BUDGET_USD,
    maxTurns: e.MAX_TURNS,
    siteBase: e.SITE_BASE.replace(/\/+$/, ''),
    searchIndexUrl: e.SEARCH_INDEX_URL,
    indexRefreshMs: e.INDEX_REFRESH_MS,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitWindowMs: e.RATE_LIMIT_WINDOW_MS,
    concurrencyLimit: e.CONCURRENCY_LIMIT,
    bodyLimitBytes: e.BODY_LIMIT_BYTES,
    trustProxy: parseBool(e.TRUST_PROXY),
    scratchDir: e.SCRATCH_DIR,
  };
}
