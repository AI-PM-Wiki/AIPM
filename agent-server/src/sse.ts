/**
 * SSE 帧写入 + 15s 心跳。
 * 事件格式:event: <name>\ndata: <json>\n\n;心跳为注释行 ": ping"。
 */
import type { ServerResponse } from 'node:http';

export function initSseResponse(
  res: ServerResponse,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...extraHeaders,
  });
  res.flushHeaders();
}

export function writeSseEvent(
  res: ServerResponse,
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function writeHeartbeat(res: ServerResponse): void {
  res.write(': ping\n\n');
}

/** 每 intervalMs(默认 15s)写一次心跳;返回停止函数。 */
export function startHeartbeat(
  res: ServerResponse,
  intervalMs = 15_000,
): () => void {
  const timer = setInterval(() => {
    try {
      writeHeartbeat(res);
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
