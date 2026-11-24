// 组卷网扩展功能：试卷选题、试卷篮/试卷汇编、试卷详情、智能组卷、个人中心、收藏、相似题、分享等
import { browser, BASE_URL } from './browser.js';
import { resolveSubject, setSubject } from './zujuan.js';

const FORM = { headers: { 'content-type': 'application/x-www-form-urlencoded' } };

function isLoginUrl(url) {
  return /sso\.zxxk\.com\/login|\/login\?/.test(url);
}

/** 确保当前页面是已加载 tklib 的组卷网页面（站内 API 需要其 CSRF token） */
export async function sitePage(fallback = '/wode/') {
  let page = await browser.ensure();
  const ok =
    page.url().startsWith(BASE_URL) &&
    (await page.evaluate(() => !!window.tklib?.request && !window.isvisitor).catch(() => false));
  if (!ok) page = await browser.goto(fallback, { waitMs: 1500 });
  if (isLoginUrl(page.url()) || (await page.evaluate(() => window.isvisitor !== false).catch(() => true))) {
    throw new Error('该操作需要登录组卷网。请先调用 zujuan_login。');
  }
  return page;
}

/** 在页面上下文里调用站内 API（与网站自身请求完全一致，不产生页面跳转） */
export async function api(path, data = {}, method = 'POST') {
  const page = await sitePage();
  const r = await page.evaluate(
    async ({ path, data, method, FORM }) => {
      try {
        const res =
          method === 'GET' ? await tklib.request.get(path, data) : await tklib.request.post(path, data, FORM);
        return { ok: true, res };
      } catch (e) {
        return { ok: false, status: e?.response?.status, msg: String(e?.message || e) };
      }
    },
    { path, data, method, FORM }
  );
  if (!r.ok) throw new Error(`接口 ${path} 调用失败（${r.status || ''} ${r.msg}）`);
  return r.res;
}


const useSubject = (subject) => setSubject(subject);

// ───────────────────────── 试卷选题 ─────────────────────────

const PAPER_SECTIONS = {
  tbjx: '同步教学（按教材章节）',
  jdcs: '阶段测试（月考/期中/期末/专题/开学考）',
  bk: '高考/中考备考（模拟、真题、学业考试、复习）',
};

/** 解析试卷列表页 */
const PARSE_PAPERS = () => {
  const items = [...document.querySelectorAll('.exam-list li.item-td')].map((li) => {
    const a = li.querySelector('a.exam-name');
    const info = (cls) => li.querySelector(`.infos .${cls}`)?.innerText.trim();
    const dl = li.querySelector('[data-type="examDownload"]');
    const cart = li.querySelector('.paper-cart-btn');
    return {
      paperId: dl?.dataset.paperid || cart?.dataset.paperid,
      bankId: dl?.dataset.bankid,
      paperLevel: dl?.dataset.paperlevel,
      name: a?.getAttribute('title') || a?.innerText.trim(),
      type: li.querySelector('.type-name')?.innerText.trim(),
      grade: info('grade'),
      year: info('year'),
      province: info('province'),
      period: info('period'),
      views: li.querySelector('.view-sum em')?.innerText,
      questionCount: li.querySelector('.test-sum em')?.innerText,
      updated: info('update-time'),
      inPaperBasket: cart ? cart.classList.contains('remove-from-cart') : undefined,
      favorited: li.querySelector('.collectpaper')?.classList.contains('done') || undefined,
      url: a?.getAttribute('href'),
    };
  });
  const pager = document.querySelector('.tk-pager');
  return {
    url: location.href,
    total: pager?.dataset.sum,
    page: Number(pager?.querySelector('.pager-item.active')?.dataset.num) || 1,
    lastPage: Number(pager?.querySelector('#lastpage')?.getAttribute('lastid')) || undefined,
    papers: items,
  };
};

/** 试卷列表页上的筛选项（都带 data-href，可直接跳转） */
const PARSE_PAPER_FILTERS = () => {
  const groups = {};
  const label = {
    selectLearnGrades: '年级学期',
    selectYear: '年份',
    selectLevel: '试卷等级',
    selectDiff: '难度',
    selectProvince: '地区',
    selectSortType: '排序',
    selectPaperType: '试卷类型',
    selectXmpCatogorie: '分类',
    selectFreshPaper: '试卷版本',
  };
  document.querySelectorAll('[data-type][data-href]').forEach((a) => {
    if (a.dataset.type === 'switchPage') return; // 分页用 page 参数
    // 选中省份后出现的城市（data-filter-type="rightCity"）单独成组
    const g = a.dataset.filterType === 'rightCity' ? '城市' : label[a.dataset.type] || a.dataset.type;
    (groups[g] ||= []).push({
      name: a.innerText.trim(),
      href: a.dataset.href,
      selected: a.classList.contains('type-item--selected') || a.classList.contains('selected'),
    });
  });
  const tree = [...document.querySelectorAll('.tk-tree a.tree-anchor')].map((a) => ({
    name: a.title || a.innerText.trim(),
    href: a.getAttribute('href') || a.dataset.href,
  }));
  if (tree.length) groups['类别/章节'] = tree.slice(300);
  return groups;
};

export async function listPapers({ subject, section = 'jdcs', url, page: pageNum, filters } = {}) {
  let target = url;
  if (!target) {
    const s = resolveSubject(subject || 'gzsx');
    target = `/${s.code}/shijuan/${section}/`;
  }
  let page = await browser.goto(target, { waitMs: 2000 });
  if (filters) {
    // filters: [{group:'年份', option:'2025'}, ...] 依次应用
    for (const f of filters) {
      const groups = await page.evaluate(PARSE_PAPER_FILTERS);
      const g = groups[f.group] || Object.entries(groups).find(([k]) => k.includes(f.group))?.[1];
      if (!g) throw new Error(`没有筛选分组「${f.group}」。可选：${Object.keys(groups).join('、')}`);
      const o = g.find((x) => x.name === f.option) || g.find((x) => x.name.includes(f.option));
      if (!o) throw new Error(`「${f.group}」中没有「${f.option}」。可选：${g.map((x) => x.name).join('、')}`);
      page = await browser.goto(o.href, { waitMs: 2000 });
    }
  }
  if (pageNum && pageNum > 1) {
    // 分页链接形如 /czsx/shijuan/jdcs/g9_1a220100p2/（页码直接拼在筛选串后），以页面自身的链接为准
    const href = await page.evaluate((n) => {
      const links = [...document.querySelectorAll('.tk-pager a')].map((a) => ({ n: Number(a.dataset.num), h: a.dataset.href || a.getAttribute('href') || '' }));
      const hit = links.find((l) => l.n === n && l.h.startsWith('/'));
      if (hit) return hit.h;
      const tpl = links.map((l) => l.h).find((h) => /p\d+\/?$/.test(h));
      return tpl ? tpl.replace(/p\d+(\/?)$/, `p${n}$1`) : null;
    }, pageNum);
    if (!href) throw new Error('当前列表没有分页信息，无法翻页');
    page = await browser.goto(href, { waitMs: 2000 });
  }
  return page.evaluate(PARSE_PAPERS);
}

export async function getPaperFilters() {
  const page = await browser.ensure();
  const groups = await page.evaluate(PARSE_PAPER_FILTERS);
  if (!Object.keys(groups).length) throw new Error('当前页面不是试卷列表页。请先调用 zujuan_list_papers。');
  // 只返回名称和选中状态，避免输出过长
  const out = {};
  for (const [k, v] of Object.entries(groups))
    out[k] = v.map((o) => (o.selected ? `[${o.name}]` : o.name)).filter((x, i, a) => a.indexOf(x) === i);
  return { url: page.url(), groups: out };
}

/** 试卷详情：题目列表 + 试卷分析 */
export async function getPaperDetail(paperId, bankId) {
  const bid = bankId || 11;
  const page = await browser.goto(`/${bid}p${paperId}.html`, { waitMs: 2000 });
  if (/当前请求资源不存在/.test(await page.title())) throw new Error(`试卷 ${paperId} 不存在（bankId=${bid}）`);
  return page.evaluate(() => {
    const textOf = (el) => {
      if (!el) return '';
      const c = el.cloneNode(true);
      c.querySelectorAll('img').forEach((i) => i.replaceWith(document.createTextNode(/formula/.test(i.src) ? '[公式]' : '[图]')));
      c.querySelectorAll('bk').forEach((b) => b.replaceWith(document.createTextNode('____')));
      return c.innerText.replace(/[ \t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    };
    const sections = [...document.querySelectorAll('.sec-item')].map((sec) => ({
      title: sec.querySelector('.sec-title span')?.innerText.trim(),
      questions: [...sec.querySelectorAll('.tk-quest-item.quesroot')].map((q) => {
        const btn = q.querySelector('[data-btn-type="quesAdd"]');
        return {
          id: q.getAttribute('questionid'),
          type: btn?.getAttribute('qyname'),
          difficulty: btn ? `${btn.getAttribute('qdname')} (${btn.getAttribute('qdvalue')})` : undefined,
          content: textOf(q.querySelector('.exam-item__cnt')),
          inBasket: btn?.classList.contains('delques'),
        };
      }),
    }));
    const analyze = document.querySelector('.exam-analyze .info-box');
    return {
      url: location.href,
      title: document.querySelector('.exam-title .title-txt .txt')?.innerText.trim(),
      info: [...document.querySelectorAll('.exam-title .info-list .item')].map((e) => e.innerText.trim()).filter(Boolean),
      favorited: document.querySelector('.collectpaper')?.classList.contains('done'),
      analysis: analyze?.innerText.replace(/\s+\n/g, '\n').trim(),
      sections,
    };
  });
}

/** 整卷加入试题篮（站点「本页全部加入试题篮」逻辑） */
export async function addPaperToBasket(paperId, bankId) {
  const bid = bankId || 11;
  const page = await browser.goto(`/${bid}p${paperId}.html`, { waitMs: 2000 });
  const before = await page.evaluate(() => ZujuanCom.QuestionBasketModule.questionBasketManager.findAllQuestionIds().length);
  const added = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.tk-quest-item [data-btn-type="quesAdd"].addques')];
    if (!btns.length) return 0;
    window.ZujuanCom.quesBasketOperation.addQuesAll(window.jQuery(btns));
    return btns.length;
  });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ZujuanCom.QuestionBasketModule.questionBasketManager.findAllQuestionIds().length);
  return { paperId, tried: added, basketBefore: before, basketAfter: after, dialogs: page.__dialogs.slice() };
}

// ───────────────────────── 试卷篮 / 试卷汇编 ─────────────────────────

export async function paperBasketAdd(paperIds, bankId, subject) {
  const s = await useSubject(subject);
  bankId = bankId || s?.bankId;
  const out = [];
  for (const id of paperIds) {
    await api('/zujuan-api/add_paper_basket', { paperId: id, bankId: bankId || 11 });
    out.push(id);
  }
  return { added: out, tree: await paperBasketTree() };
}

export async function paperBasketRemove(paperIds, bankId, subject) {
  const s = await useSubject(subject);
  bankId = bankId || s?.bankId;
  for (const id of paperIds) await api('/zujuan-api/delete_basket', { paperId: id, bankId: bankId || 11 });
  return { removed: paperIds, tree: await paperBasketTree() };
}

export async function paperBasketClear(bankId, subject) {
  const s = await useSubject(subject);
  bankId = bankId || s?.bankId;
  await api('/zujuan-api/delete_basket', { paperId: 0, bankId: bankId || 11 });
  return { cleared: true };
}

/** 试卷篮中所有试卷的试题，按知识点汇总成的树（试卷汇编左侧目录） */
export async function paperBasketTree(subject, filter) {
  await useSubject(subject);
  const list = await api('/zujuan-api/get_paper_basket_tree', {}, 'GET');
  if (!Array.isArray(list) || !list.length) return { empty: true, nodes: [] };
  if (filter) {
    // 关键字可用 | 分隔多个，返回匹配节点及其路径
    const keys = String(filter).split(/[|｜,，\s]+/).filter(Boolean);
    const byId = Object.fromEntries(list.map((n) => [n.id, n]));
    const pathOf = (n) => {
      const names = [];
      for (let p = byId[n.parentId]; p; p = byId[p.parentId]) names.unshift(p.name);
      return names.join(' > ');
    };
    const hits = list.filter((n) => keys.some((k) => n.name.includes(k)));
    return {
      empty: false,
      count: list.length,
      matched: hits.length,
      tree: hits.map((n) => `- ${n.name}（${n.childNum}题） id=${n.id}    [${pathOf(n)}]`).join('\n') || '（没有匹配的知识点）',
    };
  }
  const byParent = {};
  list.forEach((n) => (byParent[n.parentId] ||= []).push(n));
  const lines = [];
  const walk = (pid, depth) =>
    (byParent[pid] || []).forEach((n) => {
      lines.push(`${'  '.repeat(depth)}- ${n.name}（${n.childNum}题） id=${n.id}`);
      walk(n.id, depth + 1);
    });
  walk(0, 0);
  return { empty: false, count: list.length, tree: lines.join('\n') };
}

/** 打开试卷汇编页（可指定知识点 id），返回汇总后的试题列表 */
export async function openCompilation({ subject, knowledgeId } = {}) {
  const s = (await useSubject(subject)) || resolveSubject('gzsx');
  const url = knowledgeId ? `/${s.code}/hb${knowledgeId}/` : '/huibian/';
  await browser.goto(url, { waitMs: 3500 });
  const { listQuestions } = await import('./zujuan.js');
  return listQuestions({});
}

// ───────────────────────── 智能组卷 ─────────────────────────

const QT_NAME = { 2701: '单选题', 2704: '多选题', 2702: '填空题', 2703: '解答题', 2706: '判断题', 2707: '概念填空' };

/**
 * 智能组卷：按章节/知识点 + 各题型数量自动出卷，返回预览中的试题。
 * quesTypes: [{typeId|name, count}]
 */
export async function smartPaper({ subject, nodeIds, treeType = 2, quesTypes, scene = 0, areaId = 0, years = 0, difficulty }) {
  const s = resolveSubject(subject || 'gzsx');
  let page = await browser.goto(`/${s.code}/zhineng/`, { waitMs: 2500 });
  // 读取当前学科的题型 id
  const typeMap = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('input')]
        .filter((i) => i.name && i.closest('[class*=ques]'))
        .map((i) => [i.name, Number(i.closest('[data-id]')?.dataset.id || i.closest('[qtid]')?.getAttribute('qtid') || 0)])
    )
  );
  const resolveType = (t) => {
    if (t.typeId) return { id: Number(t.typeId), name: t.name || QT_NAME[t.typeId] || String(t.typeId) };
    const id = typeMap[t.name] || Number(Object.entries(QT_NAME).find(([, n]) => n === t.name)?.[0]);
    if (!id) throw new Error(`未知题型「${t.name}」。当前学科题型：${Object.keys(typeMap).join('、')}`);
    return { id, name: t.name };
  };
  const tpl = quesTypes.map((t) => {
    const r = resolveType(t);
    return { qtId: r.id, qtName: r.name, c: t.count, unlimited: t.count };
  });
  const total = tpl.reduce((a, b) => a + b.c, 0);
  if (total > 100) throw new Error('题目总数不能超过 100');
  const ids = nodeIds.map(Number);
  // 难度：difficulty 为 1/2/3（容易/适中/困难）或 {min,max} 区间
  const hard = difficulty && typeof difficulty === 'object' ? { paperHard: '2', diffMin: difficulty.min, diffMax: difficulty.max } : { paperHard: '1', diffMin: 0, diffMax: 1 };
  const obj = {
    cids: ids,
    categoryIds: ids.map((id) => ({ id, treeType })),
    diffId: typeof difficulty === 'number' ? difficulty : 0,
    quesTypeTemplates: tpl,
    areaId,
    sceneId: scene,
    ...hard,
    formerYears: String(years),
  };
  await page.evaluate((o) => {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = '/zhineng-view/';
    f.target = '_self';
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = 'param';
    i.value = btoa(encodeURIComponent(JSON.stringify(o)));
    f.appendChild(i);
    document.body.appendChild(f);
    f.submit();
  }, obj);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);
  const { listQuestions } = await import('./zujuan.js');
  const res = await listQuestions({});
  return { request: { nodeIds: ids, quesTypes: tpl.map((t) => `${t.qtName}×${t.c}`) }, ...res };
}

/** 智能组卷预览页：全部加入试题篮（点击页面上的按钮） */
export async function smartPaperAddAll() {
  const page = await browser.ensure();
  if (!/zhineng-view/.test(page.url())) throw new Error('当前不是智能组卷预览页，请先调用 zujuan_smart_paper。');
  const count = () => page.evaluate(() => ZujuanCom.QuestionBasketModule.questionBasketManager.findAllQuestionIds().length);
  const before = await count();
  page.__dialogs.length = 0;
  await page.locator('a.add-all-btn').first().click({ force: true });
  await page.waitForTimeout(2500);
  return { basketBefore: before, basketAfter: await count(), dialogs: page.__dialogs.slice() };
}

/** 智能组卷预览页：对某题「智能换题」，返回换题后的题目列表 */
export async function smartPaperSwitch(quesId) {
  const page = await browser.ensure();
  if (!/zhineng-view/.test(page.url())) throw new Error('当前不是智能组卷预览页，请先调用 zujuan_smart_paper。');
  const btn = page.locator(`a.smart-switch[data-id="${quesId}"]`).first();
  if (!(await btn.count())) throw new Error(`预览中没有试题 ${quesId}`);
  page.__dialogs.length = 0;
  await btn.click({ force: true });
  await page.waitForTimeout(3000);
  const { listQuestions } = await import('./zujuan.js');
  const r = await listQuestions({});
  return { replaced: quesId, stillPresent: r.questions.some((q) => q.id === String(quesId)), dialogs: page.__dialogs.slice(), questions: r.questions };
}

// ───────────────────────── 个人中心 ─────────────────────────

export async function downloadHistory({ days = 90, page = 1, pageSize = 10 } = {}) {
  const r = await api('/zujuan-api/user_paper/download_paged', { days, pageIndex: page, pageSize, startTimeStr: '', endTimeStr: '' });
  return {
    total: r.total,
    list: (r.list || []).map((x) => ({
      id: x.id,
      date: x.createTimeOn,
      name: x.paperName,
      questionCount: x.quesCount,
      format: x.wordVersion,
      paperType: x.paperType,
      bankId: x.bankId,
      filePath: x.paperUrl || undefined, // 用 zujuan_redownload 下载
    })),
  };
}

export async function archives({ days = 365, page = 1, pageSize = 10 } = {}) {
  const r = await api('/zujuan-api/user_paper/archives_paged', { days, pageIndex: page, pageSize, startTimeStr: '', endTimeStr: '', type: 1, folderId: 0 });
  return r;
}

export async function favoritePapers({ page = 1, pageSize = 10 } = {}) {
  return api('/zujuan-api/user_paper/collect_paged', { pageIndex: page, pageSize });
}

export async function recentFavoriteQuestions() {
  const r = await api('/zujuan-api/usertk/collect_ques', {}, 'GET');
  if (r?.code !== 200) return { list: [], note: '最近没有收藏的试题' };
  return { html: undefined, text: String(r.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000) };
}

export async function messages() {
  const count = await api('/zujuan-api/message/message_count', {});
  const unread = await api('/zujuan-api/message/no_read_messages', {});
  return { count, latestUnread: unread };
}

// ───────────────────────── 收藏 ─────────────────────────

export async function favoriteQuestion(quesId, bankId, on = true) {
  const bid = bankId || 11;
  const r = on
    ? await api('/zujuan-api/usertk/question/collect', { quesId, bankId: bid })
    : await api('/zujuan-api/usertk/del-question', { bankId: bid, questionId: quesId }, 'GET');
  return { quesId, favorited: on, result: r };
}

export async function favoritePaper({ paperId, bankId, name, questionCount, on = true }) {
  const bid = bankId || 11;
  const data = { bankid: bid, paperid: paperId, paperName: name || '', quesCount: questionCount || 0, sourceType: 1, collectType: 0 };
  const r = await api(on ? '/zujuan-api/usertk/user_collect_paper' : '/zujuan-api/usertk/paper_cancel_collect', data);
  return { paperId, favorited: on, result: r };
}

/** 个人题库中收藏的试题 */
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
export async function goodLessons({ subject } = {}) {
  const s = resolveSubject(subject || 'gzsx');
  const page = await browser.goto(`/${s.code}/shanghaoke/`, { waitMs: 3500 });
  return page.evaluate(() => ({
    url: location.href,
    items: [...document.querySelectorAll('a[href*="/shanghaoke/"], .paper-list li, .item-td')]
      .map((a) => ({ name: (a.title || a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60), href: a.getAttribute?.('href') }))
      .filter((x) => x.name)
      .slice(0, 60),
  }));
}

/** 精品专辑列表 */
export async function listTopics({ subject, url, keyword, page: pageNum } = {}) {
  const s = resolveSubject(subject || 'gzsx');
  let target = url || `/${s.code}/thematiclist/zhuanti/${keyword ? '?keyword=' + encodeURIComponent(keyword) : ''}`;
  if (pageNum && pageNum > 1) target = target.replace(/(zhuanti\/)(p\d+\/)?/, `$1p${pageNum}/`);
  const page = await browser.goto(target, { waitMs: 2500 });
  return page.evaluate(() => {
    const topics = [...document.querySelectorAll('.item.clearfix')]
      .map((it) => {
        const a = it.querySelector('.item-info__name');
        if (!a) return null;
        return {
          name: a.innerText.trim(),
          url: a.dataset.url,
          category: it.querySelector('.item-type__title')?.innerText.trim(),
          size: it.querySelector('.item-type__sum')?.innerText.trim(),
          subTopics: [...it.querySelectorAll('.item-tags .tag')].map((t) => ({ name: t.innerText.trim(), url: t.dataset.url })),
          info: it.querySelector('.item-info__info')?.innerText.replace(/\s+/g, ' ').trim(),
          vip: it.classList.contains('vip') || undefined,
        };
      })
      .filter(Boolean);
    const filters = {};
    document.querySelectorAll('.type-group-item, .type-menu, [class*=filter] .type-list').forEach((g) => {
      const name = (g.querySelector('.type-name, .name-txt')?.innerText || g.dataset.name || '').replace(/[：:]/g, '').trim();
      const opts = [...g.querySelectorAll('a[href]')].map((a) => ({ name: a.innerText.trim(), href: a.getAttribute('href') })).filter((o) => o.name);
      if (name && opts.length) filters[name] = opts;
    });
    const pager = document.querySelector('.tk-pager');
    return {
      url: location.href,
      total: pager?.dataset.sum,
      page: Number(pager?.querySelector('.pager-item.active')?.dataset.num) || 1,
      lastPage: Number(pager?.querySelector('#lastpage')?.getAttribute('lastid')) || undefined,
      topics,
      filters,
    };
  });
}

/** 专辑详情：专辑信息、子专辑、目录（各专题），以及当前专题下的试题 */
export async function topicDetail(url) {
  const page = await browser.goto(url, { waitMs: 2500 });
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.querySelector('.info__title span')?.innerText.trim() || document.title,
    topicId: document.querySelector('.collect-btn')?.dataset.topicid,
    favorited: document.querySelector('.info__title')?.classList.contains('done') || undefined,
    meta: document.querySelector('.info__msg')?.innerText.replace(/\s+/g, ' ').trim(),
    subTopics: [...document.querySelectorAll('.topic-list .list a')].map((a) => ({ name: a.innerText.trim(), url: a.getAttribute('href'), selected: a.closest('li')?.classList.contains('selected') })),
    chapters: [...document.querySelectorAll('.tk-tree a.tree-anchor')].map((a) => ({ name: a.innerText.trim(), url: a.getAttribute('href') })),
  }));
  const { listQuestions } = await import('./zujuan.js');
  const qs = await listQuestions({});
  return { ...info, currentChapterQuestions: qs.questions, total: qs.total };
}

export { PAPER_SECTIONS };

// ───────────────────────── 存档 / 下载记录：编辑、删除 ─────────────────────────

/**
 * 把存档或下载记录中的试卷载入组卷中心继续编辑（会覆盖组卷中心当前内容）。
 * kind: archive=试卷存档（zujuan_archives 的 id）  download=下载记录（zujuan_download_history 的 id）
 */
export async function loadPaperToCenter({ kind = 'archive', id, overwrite = false }) {
  const list =
    kind === 'download'
      ? (await api('/zujuan-api/user_paper/download_paged', { days: 1095, pageIndex: 1, pageSize: 100, startTimeStr: '', endTimeStr: '' })).list
      : (await api('/zujuan-api/user_paper/archives_paged', { days: 3650, pageIndex: 1, pageSize: 100, startTimeStr: '', endTimeStr: '', type: 1, folderId: 0 })).list;
  const item = (list || []).find((x) => String(x.id) === String(id));
  if (!item) throw new Error(`在${kind === 'download' ? '下载记录' : '试卷存档'}中没有找到 id=${id}`);
  if (!item.sfId) throw new Error(`试卷 ${id} 没有可加载的存档数据`);
  const page = await sitePage();
  const current = await page.evaluate(() => window.ZujuanCom?.Paper?.QuesCount?.() || 0).catch(() => 0);
  if (current > 0 && !overwrite) {
    throw new Error(`组卷中心当前已有 ${current} 道题，载入会覆盖它们。请先用 zujuan_save_paper 保存，或传 overwrite=true 确认覆盖。`);
  }
  const r = await api('/zujuan-api/usertk/user_paper/xml', { sfId: item.sfId });
  if (!r?.result) throw new Error(r?.errorInfo || '获取存档 XML 失败');
  const xml = decodeURIComponent(r.data);
  await page.evaluate(async (xml) => {
    // 与「编辑」按钮一致：SYNC_ALL(9) 同步到服务器并写入本地
    const op = window.ZujuanCom.quesBasketOperation;
    await op.quesBasketSyncVersion(9, null, xml);
    window.ZujuanCom.Paper.SaveXml(xml);
  }, xml);
  await page.waitForTimeout(1500);
  // 与站点一致：载入后跳转组卷中心
  await browser.goto('/zujuan/', { waitMs: 3000 });
  const { paperStructure } = await import('./center.js');
  return { loaded: item.paperName, paper: await paperStructure() };
}

export async function deleteArchive(id) {
  const r = await api('/zujuan-api/user_paper/archives_del', { paperId: id });
  return { deleted: id, result: r };
}

export async function deleteDownloadRecord(id) {
  const r = await api('/zujuan-api/user_paper/download_del', { paperId: id });
  return { deleted: id, result: r };
}

/** 重新下载下载记录中的文件（直接取 paperUrl） */
export async function redownload(id) {
  const { list } = await api('/zujuan-api/user_paper/download_paged', { days: 1095, pageIndex: 1, pageSize: 100, startTimeStr: '', endTimeStr: '' });
  const item = (list || []).find((x) => String(x.id) === String(id));
  if (!item?.paperUrl) throw new Error(`下载记录中没有 id=${id} 的文件`);
  const { getDownloadDir } = await import('./browser.js');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const page = await sitePage();
  const b64 = await page.evaluate(async (p) => {
    // 下载记录的文件在 OSS 上，站点用 window.oss_url 作前缀
    const u = /^https?:/.test(p) ? p : (window.oss_url || '') + p;
    const res = await fetch(u, { credentials: /^https?:\/\/zujuan/.test(u) || !/^https?:/.test(u) ? 'include' : 'omit' });
    if (!res.ok) return { error: res.status };
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(s) };
  }, item.paperUrl);
  if (b64.error) throw new Error(`文件下载失败（HTTP ${b64.error}）`);
  const name = `${item.paperName}.${item.wordVersion || 'docx'}`.replace(/[\/:*?"<>|]/g, '_');
  const file = path.join(getDownloadDir(), name);
  fs.writeFileSync(file, Buffer.from(b64.data, 'base64'));
  return { saved: file, size: fs.statSync(file).size };
}

/** 选题记录（用过的试题） */
export async function quesUseHistory({ days = 15, page = 1, pageSize = 20 } = {}) {
  return api('/zujuan-api/user/ques_usehistory_paged', { days, pageIndex: page, pageSize });
}

export async function readAllMessages() {
  return api('/zujuan-api/message/read_all_messages', {});
}

// ───────────────────────── 细目表组卷 ─────────────────────────

/**
 * 细目表组卷：逐题指定题型、知识点（或章节）、难度、分值，由站点「生成试卷」一键选题。
 * items: [{ type:'单选题'|typeId, knowledgeIds:[id...], difficulty?:'容易'|'适中'|'困难', score?:5 }]
 */
export async function specTablePaper({ subject, title, items, by = 'knowledge', priority = 'new', provinceId = -1, addToBasket = false }) {
  const s = resolveSubject(subject || 'gzsx');
  await setSubject(s.code, { open: false });
  const page = await browser.goto('/basic/', { waitMs: 2500 });
  // 题型 id：从当前学科的基础数据取
  const typeMap = await page.evaluate((bankId) => {
    const out = {};
    for (const edu of window.edu || [])
      for (const b of edu.QuesBankList || [])
        if (b.ID === bankId) for (const t of b.QuesTypeList || []) out[t.Name] = t.ID;
    return out;
  }, s.bankId);
  const DIFF = { 容易: { ID: 1, Name: '容易' }, 适中: { ID: 2, Name: '适中' }, 困难: { ID: 3, Name: '困难' } };
  const treeType = by === 'chapter' ? 2 : 1;
  const groups = [];
  for (const it of items) {
    const tid = Number(it.typeId) || typeMap[it.type];
    if (!tid) throw new Error(`未知题型「${it.type}」。${s.phase}${s.name}可用题型：${Object.keys(typeMap).join('、')}`);
    const name = Object.entries(typeMap).find(([, v]) => v === tid)?.[0] || it.type;
    let g = groups.find((x) => x.ID === tid);
    if (!g) groups.push((g = { ID: tid, Name: name, QuesNum: 0, QuesList: [] }));
    if (!it.knowledgeIds?.length) throw new Error('每道题都需要 knowledgeIds（知识点或章节 id）');
    g.QuesList.push({
      ID: 0,
      QuesDif: DIFF[it.difficulty] || { ID: 0, Name: '全部' },
      ChildNum: 0,
      Category: it.knowledgeIds.map((id) => ({ ID: Number(id), treeType })),
      Score: [{ index: 0, score: it.score || 0 }],
      excludeQuesIds: [],
    });
    g.QuesNum++;
  }
  const PRI = { new: { ID: 1, Name: '优先最新试题' }, hot: { ID: 2, Name: '优先热门试题' }, province: { ID: 3, Name: '优先地区试题' } };
  const obj = {
    dbid: 0,
    PaperTitle: title || `${s.phase}${s.name}细目表组卷`,
    PaperType: { ID: 0, Name: '不限' },
    PriorityLevel: { ...(PRI[priority] || PRI.new), Province: { ID: priority === 'province' ? provinceId : -1, Name: '' } },
    QuestionWay: by === 'chapter' ? { ID: 2, Name: '按教材章节命题', Content: '' } : { ID: 1, Name: '按知识点命题', Content: '' },
    TotalScore: items.reduce((a, b) => a + (b.score || 0), 0),
    QuesTypeList: groups,
  };
  const res = await api('/zujuan-api/one_key_ques', { jsonObj: JSON.stringify(obj), type: 0, quesIds: '', courseType: 0, courseId: 0 });
  if (!res || typeof res !== 'object') throw new Error('一键选题失败：' + JSON.stringify(res).slice(0, 200));
  const picked = (res.QuesTypeList || []).flatMap((g) =>
    (g.QuesList || []).map((q) => ({ type: g.Name, id: q.ID ? String(q.ID) : null, difficulty: q.QuesDif?.Name, score: q.Score?.[0]?.score }))
  );
  const missing = picked.filter((q) => !q.id).length;
  let basket;
  if (addToBasket) {
    const { addToBasket: add } = await import('./zujuan.js');
    basket = await add(picked.filter((q) => q.id).map((q) => q.id));
  }
  return {
    title: obj.PaperTitle,
    picked,
    note: missing ? `${missing} 道题没有找到符合条件的试题，可放宽难度或换知识点` : undefined,
    basket,
    hint: addToBasket ? '已加入试题篮，可用 zujuan_basket_to_paper 生成试卷' : '用 zujuan_get_question 查看题目，或设置 addToBasket=true 加入试题篮',
  };
}
