/**
 * 对话历史服务端截断(纯函数,零依赖):最近 6 轮、每轮 ≤2000 字、总 ≤12000 字。
 */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const HISTORY_MAX_TURNS = 6;
const TURN_MAX_CHARS = 2000;
const HISTORY_MAX_CHARS = 12_000;

export function truncateHistory(history: ChatTurn[]): ChatTurn[] {
  const recent = history.slice(-HISTORY_MAX_TURNS).map((t) => ({
    role: t.role,
    content: t.content.slice(0, TURN_MAX_CHARS),
  }));
  let total = recent.reduce((sum, t) => sum + t.content.length, 0);
  while (recent.length > 0 && total > HISTORY_MAX_CHARS) {
    const dropped = recent.shift()!;
    total -= dropped.content.length;
  }
  return recent;
}
