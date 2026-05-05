/**
 * 本地代理：浏览器只访问本机，由 Node 转发到火山方舟，避免 CORS。
 * 密钥优先读环境变量 VOLC_ARK_API_KEY（或 ARK_API_KEY），未设置则用内置默认值（仅本地开发）。
 *
 * PowerShell（勿用 &&）：cd 目录; node proxy-server.mjs   或   npm start
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PROXY_PORT || '8787', 10);
/** 方舟 OpenAI 兼容接口（api.volcengine.com/api/v1/... 实测返回 404，请用控制台文档中的地址或通过 ARK_UPSTREAM_URL 覆盖） */
const UPSTREAM =
    (process.env.ARK_UPSTREAM_URL || '').trim() || 'https://ark.cn-beijing.volces.com/api/v1/chat/completions';
const HTML_FILE = path.join(__dirname, 'diabetes_app_preview.html');

const DEFAULT_VOLC_KEY = 'ark-c57baae3-ab80-4c0b-90e9-9e2b463df676-bab0c';
const envKey = (process.env.VOLC_ARK_API_KEY || process.env.ARK_API_KEY || '').trim();

function corsHeaders(extra = {}) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        ...extra
    };
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        if (!fs.existsSync(HTML_FILE)) {
            res.writeHead(404, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
            res.end('未找到 diabetes_app_preview.html');
            return;
        }
        const html = fs.readFileSync(HTML_FILE, 'utf8');
        res.writeHead(200, corsHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
        res.end(html);
        return;
    }

    const isChat =
        url.pathname === '/api/v1/chat/completions' ||
        url.pathname === '/chat/completions';

    if (req.method !== 'POST' || !isChat) {
        res.writeHead(404, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
        res.end(JSON.stringify({ error: '仅支持 GET / 与 POST /api/v1/chat/completions' }));
        return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyBuf = Buffer.concat(chunks.length ? chunks : [Buffer.alloc(0)]);

    let bearer = envKey;
    const auth = req.headers.authorization;
    if (!bearer && auth && /^Bearer\s+\S+/i.test(auth)) {
        bearer = auth.replace(/^Bearer\s+/i, '').trim();
    }
    if (!bearer) bearer = DEFAULT_VOLC_KEY;
    if (!bearer) {
        res.writeHead(401, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
        res.end(JSON.stringify({ error: '请设置环境变量 VOLC_ARK_API_KEY，或在设置里填写密钥' }));
        return;
    }

    try {
        const upstreamRes = await fetch(UPSTREAM, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + bearer
            },
            body: bodyBuf.length ? bodyBuf : undefined
        });
        const text = await upstreamRes.text();
        const ct = upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8';
        res.writeHead(upstreamRes.status, corsHeaders({ 'Content-Type': ct }));
        res.end(text);
    } catch (e) {
        res.writeHead(502, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
        res.end(JSON.stringify({ error: '上游请求失败：' + String(e.message || e) }));
    }
});

server.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE') {
        console.error('端口 ' + PORT + ' 已被占用。请结束已运行的 node proxy-server，或执行：');
        console.error('  PowerShell: $env:PROXY_PORT="8788"; node proxy-server.mjs');
        process.exit(1);
    }
    throw err;
});

server.listen(PORT, () => {
    console.log('');
    console.log('  糖糖管家 · 火山方舟代理已启动');
    console.log('  页面:  http://localhost:' + PORT + '/');
    console.log('  转发:  POST /api/v1/chat/completions → ' + UPSTREAM);
    console.log('  上游:  环境变量 ARK_UPSTREAM_URL 可覆盖；未设置则用北京地域 v3 地址');
    console.log('');
});
