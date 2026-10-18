import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve('docs');
const evidence = resolve('meta/review/recorder-isolated.jsonl');
const websiteId = '15cfb770-15be-4652-b3d7-bc9409c7a5fa';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
  '.woff2': 'font/woff2' };
const recorded = [];

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1:18981').pathname;
  if (path === '/api/send') {
    for await (const chunk of request) void chunk;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ cache: 'isolated-recorder', disabled: false }));
    return;
  }
  if (path === `/api/websites/${websiteId}/recorder`) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ enabled: true, replayEnabled: true,
      heatmapEnabled: false, sampleRate: 1, maskLevel: 'moderate' }));
    return;
  }
  if (path === '/api/record') {
    let body = '';
    for await (const chunk of request) body += chunk;
    await appendFile(evidence, `${body}\n`);
    recorded.push(JSON.parse(body));

    response.setHeader('content-type', 'application/json');
    response.end('{}');
    return;
  }
  if (path === '/review/records') {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(recorded));
    return;
  }

  if (path === '/review/fixture/') {
    response.setHeader('content-type', 'text/html');
    response.end(await readFile('test/confirmation-recorder-fixture.html'));
    return;
  }

  const source = path === '/review/script.js' || path === '/review/recorder.js'
    ? resolve('meta/review', path.slice('/review/'.length))
    : resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  if (!source.startsWith(root + '/') && !source.startsWith(resolve('meta/review') + '/')) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(source);
    response.setHeader('content-type', mime[extname(source)] || 'application/octet-stream');
    response.end(bytes);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    response.writeHead(404).end();
  }
});

server.listen(18981, '127.0.0.1', () => console.log('isolated recorder receiver 18981'));
