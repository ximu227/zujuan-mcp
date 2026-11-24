#!/usr/bin/env node
// 组卷网 → 豆包 网关
//
// 不修改原有 MCP 服务器（src/index.js）：把它作为子进程（stdio）启动，再对外提供：
//   /mcp        Streamable HTTP MCP，原样暴露全部工具（豆包「新建自定义连接器」→ 传输类型 HTTP 填这个地址）
//   /mcp/lite   Streamable HTTP MCP，只暴露 3 个元工具（查找工具 / 查看参数 / 执行），工具多时更省上下文
//   /api/...    简单 JSON 接口，给 doubao/skill 里的命令行脚本 zj.mjs 用（豆包「技能」走这条路）
//
// 所有工具调用排队串行执行（原服务器只控制一个浏览器页面，并发调用会互相干扰）。
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ORIGINAL_SERVER = path.join(ROOT, 'src', 'index.js');

const HOST = process.env.ZUJUAN_GATEWAY_HOST || '127.0.0.1';
const PORT = Number(process.env.ZUJUAN_GATEWAY_PORT || 8765);
const TOKEN = process.env.ZUJUAN_GATEWAY_TOKEN || '';
// 单次工具调用的最长时间（下载 + 人工滑块验证可能要好几分钟）
const CALL_TIMEOUT_MS = Number(process.env.ZUJUAN_GATEWAY_CALL_TIMEOUT_SEC || 900) * 1000;

const INSTRUCTIONS = `组卷网（zujuan.xkw.com）工具：通过本机真实浏览器操作组卷网，完成选题、组卷、下载试卷等。
要点：
- 先调用 zujuan_status 看登录状态和当前学科；未登录时调用 zujuan_login，用户在弹出的浏览器窗口里扫码/输入密码。
- 试题篮、组卷中心、试卷篮都按学科分开，相关工具传 subject（如 "czsx" 或 "初中数学"）。
- 典型流程：zujuan_open_subject → zujuan_get_catalog → zujuan_list_questions / zujuan_apply_filter / zujuan_collect_questions → zujuan_add_to_basket → zujuan_basket_to_paper → zujuan_paper_set_template / _set_title / _set_scores → zujuan_download_paper。
- 站点有风控：出现滑动验证时工具会弹出浏览器窗口等待用户手动完成，请提醒用户去窗口里拖动滑块，不要反复重试。
- 请合理控制频率，不要批量抓取题库。`;

// ───────────────────────── 子进程（原 MCP 服务器） ─────────────────────────

let client = null;
let connecting = null;
let tools = [];

async function upstream() {
  if (client) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [ORIGINAL_SERVER],
      cwd: ROOT,
      // 默认只会透传少量环境变量，这里全部透传，ZUJUAN_* 配置才能生效
      env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')),
      stderr: 'inherit',
    });
    const c = new Client({ name: 'zujuan-doubao-gateway', version: '1.0.0' });
    transport.onclose = () => {
      if (client === c) client = null;
      log('原 MCP 服务器进程已退出，下次调用时会自动重启');
    };
    await c.connect(transport);
    tools = (await c.listTools()).tools;
    client = c;
    log(`已连接原 MCP 服务器，共 ${tools.length} 个工具`);
    return c;
  })().finally(() => (connecting = null));
  return connecting;
}

let queue = Promise.resolve();
let pending = 0;

/** 串行执行工具调用 */
function callTool(name, args, { onTick } = {}) {
  pending++;
  const run = async () => {
    const c = await upstream();
    if (!tools.some((t) => t.name === name)) {
      return { isError: true, content: [{ type: 'text', text: `错误：没有名为 ${name} 的工具。可先调用 zujuan_find_tools 查找。` }] };
    }
    const started = Date.now();
    const timer = onTick && setInterval(() => onTick(Math.round((Date.now() - started) / 1000)), 15000);
    try {
      return await c.callTool({ name, arguments: args ?? {} }, undefined, { timeout: CALL_TIMEOUT_MS });
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `错误：${e?.message || e}` }] };
    } finally {
      if (timer) clearInterval(timer);
    }
  };
  const p = queue.then(run, run).finally(() => pending--);
  queue = p.catch(() => {});
  return p;
}

// ───────────────────────── 精简模式的 3 个元工具 ─────────────────────────

const firstLine = (s = '') => s.split(/[。\n]/)[0];

const LITE_TOOLS = [
  {
    name: 'zujuan_find_tools',
    description:
      '查找组卷网工具（共 80 多个：选题、筛选、试题篮、组卷中心、下载、存档、收藏、浏览器操作等）。不传 keyword 列出全部工具名和一句话说明；传 keyword（空格分隔多个词，任一匹配）按名称/说明筛选。找到后用 zujuan_tool_schema 看参数，再用 zujuan_run 执行。',
    inputSchema: {
      type: 'object',
      properties: { keyword: { type: 'string', description: '如 "下载"、"试题篮"、"筛选 地区"' } },
    },
  },
  {
    name: 'zujuan_tool_schema',
    description: '查看某个组卷网工具的完整说明和参数（JSON Schema）。',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: '工具名，如 zujuan_list_questions' } }, required: ['name'] },
  },
  {
    name: 'zujuan_run',
    description: '执行一个组卷网工具。name 为工具名，arguments 为参数对象（按 zujuan_tool_schema 返回的参数填写）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工具名' },
        arguments: { type: 'object', description: '参数对象，无参数时传 {}', additionalProperties: true },
      },
      required: ['name'],
    },
  },
];

function findTools(keyword) {
  const words = String(keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = words.length ? tools.filter((t) => words.some((w) => `${t.name} ${t.description}`.toLowerCase().includes(w))) : tools;
  return hit.map((t) => `${t.name} — ${firstLine(t.description)}`).join('\n') || '没有匹配的工具，换个关键字或不传 keyword 查看全部。';
}

const textResult = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

async function callLite(name, args, opts) {
  await upstream();
  if (name === 'zujuan_find_tools') return textResult(findTools(args?.keyword));
  if (name === 'zujuan_tool_schema') {
    const t = tools.find((x) => x.name === args?.name);
    if (!t) return textResult(`没有名为 ${args?.name} 的工具。\n\n可用工具：\n${findTools('')}`, true);
    return textResult(JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }, null, 2));
  }
  if (name === 'zujuan_run') return callTool(String(args?.name || ''), args?.arguments || {}, opts);
  return textResult(`未知工具 ${name}`, true);
}

// ───────────────────────── MCP over HTTP ─────────────────────────

function buildServer(mode) {
  const server = new Server({ name: mode === 'lite' ? 'zujuan-lite' : 'zujuan', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (mode === 'lite') return { tools: LITE_TOOLS };
    await upstream();
    return { tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args } = req.params;
    const progressToken = req.params._meta?.progressToken;
    // 长时间调用（等待登录、滑块验证、下载）时定期发送进度通知，避免客户端超时
    const onTick =
      progressToken !== undefined
        ? (sec) =>
            extra
              .sendNotification({ method: 'notifications/progress', params: { progressToken, progress: sec, message: `仍在执行 ${name}，已用 ${sec} 秒` })
              .catch(() => {})
        : undefined;
    return mode === 'lite' ? callLite(name, args, { onTick }) : callTool(name, args, { onTick });
  });
  return server;
}

async function handleMcp(req, res, mode, body) {
  if (req.method !== 'POST') return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed（本网关为无状态模式，只接受 POST）' }, id: null });
  // 无状态模式：每个请求新建 Server + Transport，共享同一个子进程和调用队列
  const server = buildServer(mode);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// ───────────────────────── HTTP 服务 ─────────────────────────

function log(msg) {
  process.stderr.write(`[${new Date().toLocaleString()}] ${msg}\n`);
}

function sendJson(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    const end = () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s) return resolve(undefined);
      try {
        resolve(JSON.parse(s));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    };
    req.on('end', end);
    req.on('error', reject);
  });
}

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

/** 安全检查：防 DNS 重绑定、防网页跨站调用、可选令牌 */
function rejectReason(req, url) {
  if (LOOPBACK.includes(HOST) || HOST === '::1') {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!LOOPBACK.includes(host)) return [403, `Host 不允许：${req.headers.host}`];
  }
  // 浏览器网页跨站发 application/json 必须先预检，本服务不响应 CORS，网页就无法调用
  if (req.method === 'POST' && !/application\/json/i.test(req.headers['content-type'] || '')) return [415, '需要 Content-Type: application/json'];
  if (TOKEN) {
    const auth = String(req.headers.authorization || '');
    const given = auth.replace(/^Bearer\s+/i, '') || req.headers['x-zujuan-token'] || url.searchParams.get('token');
    if (given !== TOKEN) return [401, '令牌错误：请在请求头 Authorization: Bearer <令牌> 中提供 ZUJUAN_GATEWAY_TOKEN'];
  }
  return null;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (p === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, name: 'zujuan-doubao-gateway', connected: !!client, tools: tools.length, pending, pid: process.pid });
    }
    const bad = rejectReason(req, url);
    if (bad) return sendJson(res, bad[0], { error: bad[1] });

    if (p === '/mcp' || p === '/mcp/lite') {
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      return await handleMcp(req, res, p === '/mcp/lite' ? 'lite' : 'full', body);
    }
    if (p === '/api/tools' && req.method === 'GET') {
      await upstream();
      return sendJson(res, 200, { tools });
    }
    if (p === '/api/call' && req.method === 'POST') {
      const body = (await readBody(req)) || {};
      if (!body.name) return sendJson(res, 400, { error: '缺少 name' });
      return sendJson(res, 200, await callTool(String(body.name), body.arguments || {}));
    }
    if (p === '/api/shutdown' && req.method === 'POST') {
      sendJson(res, 200, { ok: true });
      return setTimeout(shutdown, 100);
    }
    sendJson(res, 404, { error: 'Not found', endpoints: ['/mcp', '/mcp/lite', '/health', '/api/tools', '/api/call'] });
  } catch (e) {
    log(`请求出错 ${req.method} ${p}: ${e?.stack || e}`);
    sendJson(res, e?.status || 500, { error: String(e?.message || e) });
  }
});

// 工具调用可能持续十几分钟，关闭 Node 默认的请求超时
httpServer.requestTimeout = 0;
httpServer.headersTimeout = 0;
httpServer.timeout = 0;

httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') log(`端口 ${PORT} 已被占用：网关可能已经在运行（访问 http://127.0.0.1:${PORT}/health 确认），或设置 ZUJUAN_GATEWAY_PORT 换一个端口。`);
  else log(String(e?.stack || e));
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  const base = `http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${PORT}`;
  log(`组卷网网关已启动：
  MCP（全部工具）：${base}/mcp
  MCP（精简 3 个元工具）：${base}/mcp/lite
  健康检查：${base}/health${TOKEN ? '\n  已启用令牌：请求头 Authorization: Bearer <ZUJUAN_GATEWAY_TOKEN>' : ''}`);
  // 预先连接原服务器（只启动 Node 子进程，浏览器仍按需启动）
  upstream().catch((e) => log(`连接原 MCP 服务器失败：${e?.message || e}`));
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  log('网关正在退出…');
  httpServer.close();
  await client?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
