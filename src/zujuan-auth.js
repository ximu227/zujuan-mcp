import { browser, BASE_URL } from './browser.js';
import { isLoginUrl, getStatus } from './zujuan-core.js';
import { listQuestions } from './zujuan-list.js';


export async function login({ timeoutSec = 180, username, password } = {}) {
  if (browser.headless) await browser.restart(false);
  let page = await browser.goto('/login?returnUrl=' + encodeURIComponent(BASE_URL + '/'), { waitMs: 1000 });
  if (!isLoginUrl(page.url())) {
    const st = await getStatus();
    if (st.loggedIn) return { loggedIn: true, message: '已处于登录状态', ...st };
  }
  if (username && password) {
    await page.getByText('账户密码/验证码登录').click().catch(() => {});
    await page.fill('#username', username);
    await page.fill('#password', password);
    await page.click('#accountLoginBtn').catch(() => {});
  }
  await page.bringToFront().catch(() => {});
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    page = await browser.ensure();
    const url = page.url();
    if (url.startsWith(BASE_URL) && !isLoginUrl(url)) {
      await page.waitForTimeout(1500);
      const st = await getStatus();
      if (st.loggedIn) return { loggedIn: true, message: '登录成功，登录态已保存到浏览器用户目录', ...st };
    }
    await page.waitForTimeout(1500);
  }
  return {
    loggedIn: false,
    message: `等待 ${timeoutSec} 秒仍未完成登录。请在弹出的浏览器窗口中扫码或输入账号密码，然后再次调用 zujuan_login。`,
  };
}

export async function logout() {
  const page = await browser.goto('/');
  await page.evaluate(() => window.logOut?.());
  await page.waitForTimeout(2500);
  return getStatus();
}

export async function collectQuestions({ url, startPage, sourceKeywords = [], contentKeywords = [], knowledgeKeywords = [], includeCitations = false, maxPages = 10, limit = 50, timeBudgetSec = 50 } = {}) {
  const deadline = Date.now() + timeBudgetSec * 1000;
  // 列表的基础地址（去掉页码），续传时从基础地址跳到 startPage
  const base = (url || (await browser.ensure()).url()).replace(/p\d+\/?(\?.*)?$/, (m, q) => (m.endsWith('/') || /\/$/.test(m) ? '/' : '') + (q || ''));
  let res = await listQuestions({ url: base });
  if (startPage && startPage > 1) res = await listQuestions({ page: startPage });
  const out = [];
  const seen = new Set();
  const match = (q) => {
    // 默认只看试题原始出处；includeCitations 时也匹配「N卷引用：…」中引用过该题的试卷
    const src = includeCitations ? `${q.source || ''} ${q.meta || ''}` : q.source || '';
    if (sourceKeywords.length && !sourceKeywords.some((k) => src.includes(k))) return false;
    if (contentKeywords.length && !contentKeywords.some((k) => (q.content || '').includes(k))) return false;
    if (knowledgeKeywords.length && !knowledgeKeywords.some((k) => (q.knowledge || []).some((n) => n.includes(k)))) return false;
    return true;
  };
  let pagesRead = 0;
  for (let p = startPage || res.page || 1; ; ) {
    pagesRead++;
    if (!res.questions.length && !res.total) {
      // 读不到题目：多半是被站点风控（安全验证）拦下了，停止并告知
      return { url: res.url, listUrl: base, pagesRead, lastPage: res.lastPage, matched: out.length, nextPage: p, note: `第 ${p} 页没有读到题目（可能触发了站点安全验证或已到末页）。请稍后传 url 和 startPage=${p} 继续`, questions: out.slice(0, limit) };
    }
    for (const q of res.questions) {
      if (!seen.has(q.id) && match(q)) {
        seen.add(q.id);
        out.push(q);
      }
    }
    if (out.length >= limit || pagesRead >= maxPages || !res.lastPage || p >= res.lastPage) break;
    // MCP 客户端一般有 60 秒超时：时间快用完时先返回，并告诉调用方从哪一页继续
    if (Date.now() > deadline) {
      return { url: res.url, listUrl: base, total: res.total, pagesRead, lastPage: res.lastPage, matched: out.length, nextPage: p + 1, note: `已读到第 ${p} 页，未读完。再次调用并传 url="${base}"、startPage=${p + 1} 继续`, questions: out.slice(0, limit) };
    }
    p++;
    res = await listQuestions({ page: p });
  }
  return { url: res.url, listUrl: base, total: res.total, pagesRead, lastPage: res.lastPage, matched: out.length, done: true, questions: out.slice(0, limit) };
}
