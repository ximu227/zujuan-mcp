#!/usr/bin/env node
// 组卷网 (zujuan.xkw.com) MCP 服务器：让 AI 通过 Playwright 浏览器操控组卷网
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { browser, BASE_URL, PROFILE_DIR, getDownloadDir, saveDownload } from './browser.js';
import * as zj from './zujuan.js';
import { registerExtraTools } from './tools-extra.js';

const server = new McpServer({ name: 'zujuan-mcp', version: '0.1.0' });

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const text = (t) => ({ content: [{ type: 'text', text: t }] });

/** 统一错误处理：错误以文本返回给模型，而不是让 MCP 调用崩溃 */
function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return await handler(args ?? {});
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `错误：${e?.message || e}` }] };
    }
  });
}

const withImages = z
  .boolean()
  .optional()
  .describe('为 true 时返回题干中的公式/插图图片 URL（题干里以 [公式n]/[图n] 占位）');

// ───────────────────────── 组卷网专用工具 ─────────────────────────

tool('zujuan_status', '查看浏览器当前页面、是否已登录组卷网、试题篮数量等状态。', {}, async () =>
  json({ ...(await zj.getStatus()), profileDir: PROFILE_DIR })
);

tool(
  'zujuan_login',
  '登录组卷网。会打开一个可见的浏览器窗口，用户可扫码或输入账号密码登录；登录态保存在本地浏览器用户目录，后续无需重复登录。加入试题篮、全站搜索、查看答案解析、下载试卷等都需要登录。',
  {
    timeoutSec: z.number().int().min(10).max(600).optional().describe('等待用户完成登录的秒数，默认 180'),
    username: z.string().optional().describe('可选：账号（手机号/邮箱/用户名），提供则自动填写'),
    password: z.string().optional().describe('可选：密码，提供则自动填写并点击登录（可能仍需人工完成验证码）'),
  },
  async (a) => json(await zj.login(a))
);

tool('zujuan_logout', '退出组卷网登录。', {}, async () => json(await zj.logout()));

tool('zujuan_list_subjects', '列出组卷网全部学段学科及代码（如 gzsx=高中数学、czwl=初中物理）。', {}, async () =>
  json(zj.SUBJECTS.map((s) => ({ subject: s.phase + s.name, code: s.code, bankId: s.bankId })))
);

tool(
  'zujuan_open_subject',
  '切换学科并打开该学科的章节选题或知识点选题页面。打开后可用 zujuan_get_catalog 查看目录、zujuan_list_questions 读取题目。',
  {
    subject: z.string().describe('学科代码或名称，如 "gzsx"、"高中数学"、"初中物理"'),
    mode: z.enum(['zhangjie', 'zhishidian', 'home']).optional().describe('zhangjie=章节选题(默认)，zhishidian=知识点选题，home=学科首页'),
  },
  async ({ subject, mode }) => json(await zj.openSubject(subject, mode))
);

tool(
  'zujuan_list_textbooks',
  '在章节选题页列出可选的教材版本（人教版、北师大版等）和该版本下的教材册次；传入 version 可切换版本。切换册次请把返回的 textbooks[].url 传给 zujuan_list_questions 或 zujuan_get_catalog。',
  { version: z.string().optional().describe('要切换到的教材版本名称，如 "北师大版"') },
  async ({ version }) => json(await zj.listTextbooks(version))
);

tool(
  'zujuan_get_catalog',
  '读取当前页（或指定 URL）左侧的章节目录树/知识点树，返回每个节点的名称和 URL。节点 URL 可传给 zujuan_list_questions 查看该章节/知识点下的题目。',
  {
    url: z.string().optional().describe('可选：先打开该地址（如 "/gzsx/zj135303/"）'),
    maxDepth: z.number().int().min(1).max(6).optional().describe('最多显示的层级深度，默认 3'),
    filter: z.string().optional().describe('只返回名称包含该关键字的节点（忽略 maxDepth，搜索全部层级）'),
  },
  async (a) => text(Object.entries(await zj.getCatalog(a)).map(([k, v]) => (k === 'tree' ? v : `${k}: ${v}`)).join('\n'))
);

tool(
  'zujuan_list_questions',
  '读取题目列表（每页 10 题）：题号 id、题型、难度、知识点、来源、题干文本、是否已在试题篮。可传入章节/知识点 URL，或翻页。',
  {
    url: z.string().optional().describe('可选：列表页地址，如 "/gzsx/zj135316/" 或目录树中节点的 URL；不传则读取当前页'),
    page: z.number().int().min(1).optional().describe('可选：跳到第几页'),
    withImages,
  },
  async (a) => json(await zj.listQuestions(a))
);

tool(
  'zujuan_collect_questions',
  '在当前（或指定）题目列表上自动翻页，按「来源/题干/知识点」关键字收集试题。用于站点筛选不支持的条件，例如只要长春市（或某所学校）的题：地区筛选只到省，先用 zujuan_apply_filter 选「吉林」，再用 sourceKeywords:["长春"]。',
  {
    url: z.string().optional().describe('列表页地址；不传则从当前页开始'),
    startPage: z.number().int().min(1).optional().describe('从第几页开始（上次返回 nextPage 时用）'),
    sourceKeywords: z.array(z.string()).optional().describe('试题来源（试卷名）须包含其中之一，如 ["长春"]'),
    contentKeywords: z.array(z.string()).optional().describe('题干须包含其中之一，如 ["网格","格点"]'),
    knowledgeKeywords: z.array(z.string()).optional().describe('知识点须包含其中之一'),
    includeCitations: z.boolean().optional().describe('来源关键字是否也匹配引用过该题的其他试卷（默认只匹配原始出处）'),
    maxPages: z.number().int().min(1).max(30).optional().describe('最多翻多少页，默认 10（每页 10 题）'),
    limit: z.number().int().min(1).max(200).optional().describe('最多返回多少题，默认 50'),
  },
  async (a) => json(await zj.collectQuestions(a))
);

tool(
  'zujuan_get_filters',
  '列出当前题目列表页可用的筛选条件（场景、题型、难度、分类、年份、地区、年级、学期、排序等）及当前选中项。',
  {},
  async () => json(await zj.getFilters())
);

tool(
  'zujuan_apply_filter',
  '在当前题目列表页应用一个筛选条件，返回筛选后的第一页题目。可多次调用叠加不同分组的筛选。',
  {
    group: z.string().describe('筛选分组名，如 "题型"、"难度"、"场景"、"年份"、"排序"'),
    option: z.string().describe('选项名，如 "单选题"、"困难"、"高考真题"、"2025"、"最热"'),
    withImages,
  },
  async ({ group, option, withImages }) => json(await zj.applyFilter(group, option, withImages))
);

tool(
  'zujuan_search_in_results',
  '在当前章节/知识点题目列表中按关键字搜索（"在结果中搜索"）。',
  { keyword: z.string().min(1), withImages },
  async ({ keyword, withImages }) => json(await zj.searchInResults(keyword, withImages))
);

tool(
  'zujuan_search',
  '使用组卷网顶部搜索框进行全站试题搜索（需要登录）。',
  { keyword: z.string().min(1).describe('搜索关键字或题干片段'), withImages },
  async ({ keyword, withImages }) => json(await zj.globalSearch(keyword, withImages))
);

tool(
  'zujuan_get_question',
  '打开试题详情页，返回题干、题型难度、知识点、来源、是否在试题篮。答案解析是图片，请用 zujuan_screenshot_question 的 part="answer" 查看。',
  {
    id: z.union([z.string(), z.number()]).describe('试题 id（列表中的 id 字段）'),
    bankId: z.number().int().optional().describe('题库 id（即学科 bankId），默认取当前页面的学科'),
    withImages,
  },
  async ({ id, bankId, withImages }) => json(await zj.getQuestion(String(id), { bankId, withImages }))
);

tool(
  'zujuan_screenshot_question',
  '截取某道题的图片（组卷网的公式多以图片呈现，截图可让模型准确看到题目）。part="answer" 时截取答案与解析（组卷网的答案解析只以图片形式提供，需登录）。',
  {
    id: z.union([z.string(), z.number()]),
    part: z.enum(['question', 'answer']).optional().describe('question=题目(默认)，answer=答案与解析'),
  },
  async ({ id, part }) => {
    const buf = await zj.screenshotQuestion(String(id), part);
    return { content: [{ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' }] };
  }
);

tool(
  'zujuan_add_to_basket',
  '把试题加入试题篮（需要登录）。题目在当前列表页上则直接点击，否则打开详情页后加入。',
  { ids: z.array(z.union([z.string(), z.number()])).min(1).describe('试题 id 列表') },
  async ({ ids }) => json(await zj.addToBasket(ids.map(String)))
);

tool(
  'zujuan_remove_from_basket',
  '把试题从试题篮移除（需要登录）。',
  { ids: z.array(z.union([z.string(), z.number()])).min(1) },
  async ({ ids }) => json(await zj.removeFromBasket(ids.map(String)))
);

tool('zujuan_get_basket', '查看试题篮：题目总数、平均难度、按题型分组的题目 id/难度/来源。试题篮按学科分开。', { subject: z.string().optional().describe('学科代码或名称（试题篮/组卷中心按学科分开）；不传则用当前学科') }, async ({ subject }) => json(await zj.getBasket(subject)));

tool('zujuan_clear_basket', '清空某学科的试题篮。', { subject: z.string().optional().describe('学科代码或名称（试题篮/组卷中心按学科分开）；不传则用当前学科') }, async ({ subject }) => json(await zj.clearBasket(subject)));

tool(
  'zujuan_basket_to_paper',
  '试题篮「去组卷」：把试题篮中的试题送入组卷中心生成试卷。不传 ids 则送入试题篮全部试题；传 ids 则只送这些题（完成后恢复试题篮原勾选状态）。之后可用 zujuan_get_paper 查看试卷。',
  { overwrite: z.boolean().optional().describe('组卷中心已有草稿时是否清空并新建（默认否，会报错提示）'), ids: z.array(z.union([z.string(), z.number()])).optional().describe('可选：只送入这些试题 id（必须已在试题篮中）'), subject: z.string().optional().describe('学科代码或名称（试题篮/组卷中心按学科分开）；不传则用当前学科') },
  async ({ ids, subject, overwrite }) => json(await zj.sendBasketToPaper(ids?.map(String), subject, { overwrite }))
);

tool('zujuan_get_paper', '读取组卷中心当前试卷：题量、难度、试题 id 列表、题型结构。组卷中心按学科分开。', { subject: z.string().optional().describe('学科代码或名称（试题篮/组卷中心按学科分开）；不传则用当前学科') }, async ({ subject }) => json(await zj.getPaper(subject)));

tool(
  'zujuan_clear_paper',
  '清空组卷中心当前试卷中的全部试题（试题仍保留在试题篮中，可在【我的-选题记录】找回近 15 天记录）。',
  { subject: z.string().optional().describe('学科代码或名称（试题篮/组卷中心按学科分开）；不传则用当前学科') },
  async ({ subject }) => json(await zj.clearPaper(subject))
);

tool(
  'zujuan_download_paper',
  '下载试卷（Word/PDF）到本地。source=center 下载组卷中心当前试卷（默认）；source=paper 下载整套原卷（需 paperId）；source=topic 整卷下载专辑/专题（需 url）。可设置标题、答案位置、解析内容、纸张、格式、公式格式等。站点可能弹出滑块验证码：此时会弹出可见浏览器窗口，需要用户手动拖动滑块，工具等待验证通过后保存文件。默认不从试题篮删除本次用题。',
  {
    title: z.string().optional().describe('试卷标题'),
    answerPosition: z.enum(['卷尾', '题后', '不显示']).optional().describe('答案位置，默认卷尾；"不显示"即学生版'),
    includeAnalysis: z.boolean().optional().describe('附带解析，默认是'),
    includeKnowledge: z.boolean().optional().describe('附带知识点'),
    includeDifficulty: z.boolean().optional().describe('附带难度系数'),
    includeQrCode: z.boolean().optional().describe('附带讲题二维码'),
    source: z.enum(['不显示', '题文前', '答案处']).optional().describe('试题来源显示位置'),
    removeFromBasket: z.boolean().optional().describe('下载后从试题篮删除本次用题，默认否'),
    paperSize: z.enum(['A4', '16K', 'A4H', 'A3H', 'B4H', '8KH']).optional().describe('纸张：A4H/A3H/B4H/8KH 为横向双栏'),
    format: z.enum(['docx', 'doc', 'pdf']).optional().describe('文件格式，默认 docx'),
    formula: z.enum(['png', 'mathtype', 'officemath']).optional().describe('公式格式：高清图片 / MathType / 微软公式(可在 Word 直接编辑)'),
    answerArea: z.boolean().optional().describe('添加主观题作答区域'),
    fontSize: z.enum(['五号', '四号', '小四', '三号']).optional(),
    useScene: z.array(z.enum(['日常作业', '课堂讲义', '阶段小测', '正式考试', '自主练习', '其他'])).optional().describe('组卷用途'),
    timeoutSec: z.number().int().min(30).max(600).optional().describe('等待下载（含人工验证）的秒数，默认 180'),
    subject: z.string().optional().describe('学科代码或名称（试题篮/组卷中心按学科分开）；不传则用当前学科'),
    source: z.enum(['center', 'paper', 'topic']).optional().describe('center=组卷中心(默认) paper=整套原卷 topic=专辑/专题'),
    paperId: z.union([z.string(), z.number()]).optional().describe('source=paper 时的试卷 id'),
    bankId: z.number().int().optional().describe('source=paper 时的学科 bankId，默认 11'),
    url: z.string().optional().describe('source=topic 时的专辑/专题地址'),
  },
  async (a) => json(await zj.downloadPaper(a))
);

tool(
  'zujuan_open_paper_editor',
  '打开组卷中心（试卷编辑/预览页），可在此调整试卷、下载试卷。打开后可用 browser_snapshot 查看页面，再用 browser_click 操作。',
  {},
  async () => {
    const page = await browser.goto('/zujuan/', { waitMs: 3000 });
    if (/sso\.zxxk\.com\/login/.test(page.url())) throw new Error('组卷中心需要登录，请先调用 zujuan_login。');
    return json({ url: page.url(), title: await page.title() });
  }
);

registerExtraTools(tool, json, text);

// ───────────────────────── 通用浏览器工具 ─────────────────────────

tool(
  'browser_navigate',
  `打开网址。相对路径会补全为 ${BASE_URL} 下的地址。`,
  { url: z.string() },
  async ({ url }) => {
    const page = await browser.goto(url);
    return json({ url: page.url(), title: await page.title() });
  }
);

tool('browser_back', '浏览器后退。', {}, async () => {
  const page = await browser.ensure();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  return json({ url: page.url(), title: await page.title() });
});

tool(
  'browser_snapshot',
  '获取当前页面的可访问性快照（ARIA 树，含元素角色与文本），用于理解页面结构并决定点击哪个元素。',
  { selector: z.string().optional().describe('可选：只取该 CSS 选择器范围内的快照') },
  async ({ selector }) => {
    const page = await browser.ensure();
    const snap = await page.locator(selector || 'body').first().ariaSnapshot({ timeout: 10000 });
    const max = 40000;
    return text(`URL: ${page.url()}\nTITLE: ${await page.title()}\n\n` + (snap.length > max ? snap.slice(0, max) + '\n…(已截断，可传 selector 缩小范围)' : snap));
  }
);

tool(
  'browser_get_text',
  '获取页面（或某个 CSS 选择器）内的可见文本。',
  {
    selector: z.string().optional(),
    maxLength: z.number().int().optional().describe('最大返回字符数，默认 20000'),
  },
  async ({ selector, maxLength = 20000 }) => {
    const page = await browser.ensure();
    const t = await page.locator(selector || 'body').first().innerText({ timeout: 10000 });
    return text(t.length > maxLength ? t.slice(0, maxLength) + '\n…(已截断)' : t);
  }
);

tool(
  'browser_click',
  '点击元素。可用 CSS 选择器，或用可见文本（text）定位；同名元素多时可用 nth 指定第几个（从 0 开始）。',
  {
    selector: z.string().optional(),
    text: z.string().optional().describe('按可见文本定位元素'),
    exact: z.boolean().optional().describe('文本是否精确匹配，默认 false'),
    nth: z.number().int().min(0).optional(),
  },
  async ({ selector, text: t, exact, nth = 0 }) => {
    if (!selector && !t) throw new Error('需要提供 selector 或 text');
    const page = await browser.ensure();
    page.__dialogs.length = 0;
    const loc = (selector ? page.locator(selector) : page.getByText(t, { exact: !!exact })).nth(nth);
    try {
      await loc.click({ timeout: 8000 });
    } catch (e) {
      // 被悬浮层遮挡时回退为 DOM 点击
      if (/intercepts pointer events|not visible|Timeout/i.test(String(e))) await loc.evaluate((el) => el.click());
      else throw e;
    }
    await page.waitForTimeout(1500);
    const cur = await browser.ensure();
    return json({ url: cur.url(), title: await cur.title(), dialogs: page.__dialogs.slice() });
  }
);

tool(
  'browser_type',
  '在输入框中输入文本（会先清空）。',
  {
    selector: z.string(),
    text: z.string(),
    submit: z.boolean().optional().describe('输入后按回车'),
  },
  async ({ selector, text: t, submit }) => {
    const page = await browser.ensure();
    await page.fill(selector, t, { timeout: 8000 });
    if (submit) {
      await page.press(selector, 'Enter');
      await page.waitForTimeout(2000);
    }
    const cur = await browser.ensure();
    return json({ url: cur.url(), title: await cur.title() });
  }
);

tool(
  'browser_press_key',
  '按下键盘按键，如 Enter、Escape、PageDown。',
  { key: z.string() },
  async ({ key }) => {
    const page = await browser.ensure();
    await page.keyboard.press(key);
    await page.waitForTimeout(800);
    return json({ url: page.url() });
  }
);

tool(
  'browser_screenshot',
  '截取当前页面截图。',
  {
    fullPage: z.boolean().optional(),
    selector: z.string().optional().describe('可选：只截该元素'),
  },
  async ({ fullPage, selector }) => {
    const page = await browser.ensure();
    const buf = selector
      ? await page.locator(selector).first().screenshot({ type: 'png' })
      : await page.screenshot({ type: 'png', fullPage: !!fullPage });
    return { content: [{ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' }] };
  }
);

tool(
  'browser_evaluate',
  '在当前页面执行一段 JavaScript 表达式并返回结果（JSON 序列化）。可用于读取站点全局对象，如 window.ZujuanCom.Paper.GetQuesIDList()。',
  { expression: z.string().describe('JS 表达式或立即执行函数，如 "document.title"') },
  async ({ expression }) => {
    const page = await browser.ensure();
    const result = await page.evaluate((src) => {
      // eslint-disable-next-line no-eval
      const r = (0, eval)(src);
      return Promise.resolve(r).then((v) => {
        try {
          return JSON.parse(JSON.stringify(v ?? null));
        } catch {
          return String(v);
        }
      });
    }, expression);
    return json(result);
  }
);

tool(
  'browser_wait_for_download',
  '点击一个下载按钮并等待文件下载完成，保存到本地下载目录。',
  {
    selector: z.string().optional(),
    text: z.string().optional().describe('按可见文本定位下载按钮'),
    timeoutSec: z.number().int().optional().describe('默认 60'),
  },
  async ({ selector, text: t, timeoutSec = 60 }) => {
    if (!selector && !t) throw new Error('需要提供 selector 或 text');
    const page = await browser.ensure();
    const loc = (selector ? page.locator(selector) : page.getByText(t)).first();
    const [dl] = await Promise.all([
      browser.context.waitForEvent('download', { timeout: timeoutSec * 1000 }),
      loc.click({ timeout: 8000 }).catch(() => loc.evaluate((el) => el.click())),
    ]);
    const file = await saveDownload(dl, { timeoutSec: Math.max(60, timeoutSec) });
    return json({ saved: file, size: fs.statSync(file).size });
  }
);

tool(
  'browser_tabs',
  '列出所有标签页，或切换/关闭某个标签页。',
  {
    action: z.enum(['list', 'select', 'close']).optional(),
    index: z.number().int().min(0).optional(),
  },
  async ({ action = 'list', index }) => {
    await browser.ensure();
    const pages = browser.context.pages();
    if (action !== 'list') {
      const p = pages[index ?? -1];
      if (!p) throw new Error('标签页序号无效');
      if (action === 'select') {
        browser.page = p;
        await p.bringToFront();
      } else await p.close();
    }
    const cur = browser.page;
    return json(
      await Promise.all(
        browser.context.pages().map(async (p, i) => ({ index: i, url: p.url(), title: await p.title().catch(() => ''), current: p === cur }))
      )
    );
  }
);

tool(
  'browser_set_visible',
  '切换浏览器为可见窗口（visible=true）或无头模式（visible=false）。会重启浏览器，保留登录态并重新打开当前页面。',
  { visible: z.boolean() },
  async ({ visible }) => {
    await browser.restart(!visible);
    return json(await zj.getStatus());
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async () => {
  await browser.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
