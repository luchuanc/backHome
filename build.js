const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// 图标也内嵌，独立文件离开工程目录后不需要请求任何美术资源。
html = html.replace(/<link rel="icon" href="([^"]+)">/g, (_, file) => `<link rel="icon" href="data:image/png;base64,${fs.readFileSync(path.join(root, file)).toString('base64')}">`);
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, file) => `<style>\n${fs.readFileSync(path.join(root, file), 'utf8')}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, file) => `<script>\n${fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
fs.writeFileSync(path.join(root, '最后一家回收站.html'), html);
console.log('已生成独立离线游戏：最后一家回收站.html');
// 发布平台只托管 dist，保留原有单文件离线交付方式。
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log('已生成静态发布产物：dist/index.html');
