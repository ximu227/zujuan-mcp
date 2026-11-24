// 个人题库、相似题、知识点解读、分享
import { browser } from './browser.js';
import { api, sitePage, FORM } from './features-core.js';

export async function personalQuestions({ bankId = 11, page = 1, keyword = '', quesType = 0, quesDiff = 0 } = {}) {
  const r = await api('/zujuan-api/usertk/questions', { bankId, categoryId: 0, quesDiff, quesType, pageIndex: page, keyword, pageName: '' });
  if (!r?.data?.html) return { total: 0, questions: [] };
  const page$ = await sitePage();
  return page$.evaluate((html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return {
      questions: [...d.querySelectorAll('.quesroot')].map((q) => ({
        id: q.getAttribute('questionid'),
        content: (q.querySelector('.exam-item__cnt')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      })),
    };
  }, r.data.html);
}

// ───────────────────────── 试题相关 ─────────────────────────

/** 相似题（站点「相似题」弹窗的内容） */
export async function similarQuestions(quesId, bankId) {
  const bid = bankId || 11;
  const page = await sitePage();
  const html = await page.evaluate(async (u) => (await fetch(u, { credentials: 'include' })).text(), `/dialog/similarity?bankId=${bid}&quesId=${quesId}&pageNo=1&variantType=`);
  return page.evaluate((html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    const qs = [...d.querySelectorAll('.quesroot,[questionid]')].map((q) => {
      const c = q.querySelector('.exam-item__cnt') || q;
      const cl = c.cloneNode(true);
      cl.querySelectorAll('img').forEach((i) => i.replaceWith(document.createTextNode(/formula/.test(i.getAttribute('src') || '') ? '[公式]' : '[图]')));
      return { id: q.getAttribute('questionid'), content: cl.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) };
    });
    const seen = new Set();
    return { questions: qs.filter((q) => q.id && !seen.has(q.id) && seen.add(q.id)) };
  }, html);
}

/** 知识点解读 */
export async function knowledgeExplain(cid, cname, bankId) {
  const page = await sitePage();
  const html = await page.evaluate(async (u) => (await fetch(u, { credentials: 'include' })).text(), `/dialog/knowledge_unscramble?cid=${cid}&cname=${encodeURIComponent(cname || '')}&bankid=${bankId || 11}`);
  return page.evaluate((html) => {
    const d = document.createElement('div');
    d.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
    return d.textContent.replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, 6000);
  }, html);
}

/** 分享组卷中心当前试卷：生成 PC 链接、手机链接和二维码（与「分享试卷」按钮一致） */
export async function shareCurrentPaper() {
  let page = await browser.ensure();
  if (!/\/zujuan\/?$/.test(new URL(page.url()).pathname)) page = await browser.goto('/zujuan/', { waitMs: 2500 });
  const r = await page.evaluate(async (FORM) => {
    const P = window.ZujuanCom?.Paper;
    if (!P || !P.GetQuesIDList().length) return { error: '组卷中心的试卷是空的' };
    const xml = P.Xml();
    let res = await tklib.request.post('/zujuan-api/share_paper/get_url', { paperXml: xml }, FORM);
    if (res?.code == 404) res = await tklib.request.post('/zujuan-api/share_paper/create_url', { paperXml: xml }, FORM);
    if (!res || res.code != 0) return { error: res?.msg || '生成分享链接失败', raw: res };
    let qr;
    try {
      qr = await tklib.request.post('/zujuan-api/qrcode', { url: res.content.m_url, enableShartUrl: true }, FORM);
    } catch {}
    return { pcUrl: res.content.pc_url, mobileUrl: res.content.m_url, qrcode: typeof qr === 'string' ? qr.slice(0, 200) : qr };
  }, FORM);
  if (r.error) throw new Error(r.error);
  return r;
}

/** 搜索学校（试卷列表的学校筛选） */
export async function searchSchools(keyword) {
  const r = await api(`/zujuan-api/schools?1=1&keyword=${encodeURIComponent(keyword)}`, {}, 'GET');
  return r?.data || [];
}

/** 上好课：同步备课资源列表 */
