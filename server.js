const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = __dirname, port = Number(process.env.PORT || 8765), host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  try {
    const decoded = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
    if (!file.startsWith(root + path.sep) || req.method !== 'GET') { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  } catch (_) { res.writeHead(400); res.end('Bad request'); }
}).listen(port, host, () => {
  console.log(`最后一家回收站：http://127.0.0.1:${port}`);
  // 局域网模式只展示真实网卡地址；手机与电脑连接同一网络即可访问。
  if (host === '0.0.0.0') {
    for (const [name, entries] of Object.entries(os.networkInterfaces())) {
      if (!/^en\d+$/.test(name)) continue;
      for (const entry of entries) if (entry.family === 'IPv4' && !entry.internal) console.log(`手机试玩：http://${entry.address}:${port}`);
    }
  }
});
