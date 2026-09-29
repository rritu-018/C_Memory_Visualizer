import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    send(res, 400, 'Bad request');
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

server.listen(port, () => {
  console.log(`C Memory Visualizer ready at http://localhost:${port}`);
});
