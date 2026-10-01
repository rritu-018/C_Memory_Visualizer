import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWorkspace, runCompiled, runTerminalCommand } from './compiler.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

async function readJson(req, maxBytes = 600_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body exceeds the size limit.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body must be valid JSON.'); }
}

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    send(res, 400, 'Bad request');
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    try {
      const body = await readJson(req);
      if (pathname === '/api/compile') {
        sendJson(res, 200, await compileWorkspace(body.files));
        return;
      }
      if (pathname === '/api/run') {
        sendJson(res, 200, await runCompiled(body.compilationId, body.stdin || ''));
        return;
      }
      if (pathname === '/api/terminal') {
        sendJson(res, 200, await runTerminalCommand(body.command, body.files, body.compilationId || '', body.stdin || ''));
        return;
      }
      sendJson(res, 404, { error: 'Unknown API endpoint.' });
    } catch (error) {
      const message = error.message || 'Compiler service error.';
      const status = message.includes('size limit') || message.includes('valid JSON') ? 400 : 422;
      sendJson(res, status, { error: message });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts.some(part => part.startsWith('.'))) {
    send(res, 404, 'Not found');
    return;
  }

  let relativePath = parts.join('/');
  if (parts[0] === 'C_Memory_Visualizer') relativePath = parts.slice(1).join('/');
  let filePath = resolve(projectRoot, relativePath || 'index.html');
  if (!filePath.startsWith(projectRoot + sep) && filePath !== projectRoot) {
    send(res, 403, 'Forbidden');
    return;
  }

  try {
    if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, 'index.html');
    const body = await readFile(filePath);
    const type = mimeTypes[extname(filePath)] || 'application/octet-stream';
    const output = type.startsWith('text/html')
      ? body.toString('utf8').replaceAll('/C_Memory_Visualizer/', '/')
      : body;
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : output);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      send(res, 500, 'Unable to read requested file');
      return;
    }
    try {
      const fallback = (await readFile(resolve(projectRoot, '404.html'), 'utf8'))
        .replaceAll('/C_Memory_Visualizer/', '/');
      send(res, 200, fallback, 'text/html; charset=utf-8');
    } catch {
      send(res, 404, 'Not found');
    }
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`C Memory Visualizer ready at http://localhost:${port}`);
});
