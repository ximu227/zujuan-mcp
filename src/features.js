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
  if (tree.length) groups['类别/章节'] = tree.slice(0, 300);
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
  for (const [k, v] ofObject.entries(groups))
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

  tool(
    'zujuan_answer_sheet',
    '组卷中心答题卡：kind=download 打开「下载答题卡」，kind=make 打开「制作答题卡」。返回对话框内容，之后可用 browser_snapshot / browser_click 选择样式，browser_wait_for_download 下载。',
    { kind: z.enum(['download', 'make']).optional() },
    async ({ kind }) => json(await ct.answerSheet(kind))
  );

  // ───────────── 试题相关 ─────────────
  tool(
    'zujuan_similar_questions',
    '查找某道题的相似题（站点「相似题」功能），返回候选题 id 和题干。',
    { id, bankId: z.number().int().optional() },
    async ({ id, bankId }) => json(await ft.similarQuestions(id, bankId))
  );

  tool(
    'zujuan_knowledge_explain',
    '知识点解读（站点「解读」按钮，需要会员）。cid/cname 来自试题详情的知识点。',
    { cid: z.union([z.string(), z.number()]), cname: z.string().optional(), bankId: z.number().int().optional() },
    async ({ cid, cname, bankId }) => text(await ft.knowledgeExplain(cid, cname, bankId))
  );

  tool(
    'zujuan_favorite_question',
    '收藏 / 取消收藏试题（收藏的试题进入个人题库）。',
    { id, bankId: z.number().int().optional(), favorite: z.boolean().optional().describe('true=收藏(默认)，false=取消') },
    async ({ id, bankId, favorite }) => json(await ft.favoriteQuestion(id, bankId, favorite !== false))
  );

  // ───────────── 个人中心 ─────────────
  tool(
    'zujuan_download_history',
    '我的-下载记录：最近下载过的试卷（名称、日期、题量、格式、文件地址）。',
    { days: z.number().int().optional().describe('最近多少天，默认 90'), page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.downloadHistory(a))
  );

  tool(
    'zujuan_archives',
    '我的-试卷存档：保存过的试卷。',
    { days: z.number().int().optional().describe('最近多少天，默认 365'), page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.archives(a))
  );

  tool(
    'zujuan_favorite_papers',
    '我的-收藏的试卷。',
    { page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.favoritePapers(a))
  );

  tool(
    'zujuan_personal_questions',
    '个人题库：收藏的试题，可按关键字、题型、难度筛选。',
    {
      bankId: z.number().int().optional(),
      keyword: z.string().optional(),
      page: z.number().int().optional(),
      quesType: z.number().int().optional().describe('题型 id，如 2701=单选题'),
      quesDiff: z.number().int().optional().describe('1=容易 2=较易 3=适中 4=较难 5=困难'),
    },
    async (a) => json(await ft.personalQuestions(a))
  );

  tool(
    'zujuan_load_paper_to_center',
    '把「试卷存档」或「下载记录」中的试卷载入组卷中心继续编辑（相当于其「编辑」按钮）。组卷中心已有试题时需 overwrite=true 才会覆盖。',
    {
      kind: z.enum(['archive', 'download']).optional().describe('archive=试卷存档(默认)，download=下载记录'),
      id: z.union([z.string(), z.number()]).describe('zujuan_archives / zujuan_download_history 返回的 id'),
      overwrite: z.boolean().optional(),
    },
    async (a) => json(await ft.loadPaperToCenter(a))
  );

  tool('zujuan_delete_archive', '删除一条试卷存档。', { id }, async ({ id }) => json(await ft.deleteArchive(id)));

  tool('zujuan_delete_download_record', '删除一条下载记录。', { id }, async ({ id }) => json(await ft.deleteDownloadRecord(id)));

  tool(
    'zujuan_redownload',
    '重新下载「下载记录」中的试卷文件到本地下载目录（不重新生成、不占下载次数）。',
    { id },
    async ({ id }) => json(await ft.redownload(id))
  );

  tool(
    'zujuan_ques_use_history',
    '我的-选题记录：最近用过（加入试题篮/组卷/下载）的试题。',
    { days: z.number().int().optional().describe('默认 15'), page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.quesUseHistory(a))
  );

  tool('zujuan_read_all_messages', '把站内消息全部标为已读。', {}, async () => json(await ft.readAllMessages()));

  tool('zujuan_messages', '站内消息：未读数量和最新一条未读消息。', {}, async () => json(await ft.messages()));

  // ───────────── 专辑 / 上好课 ─────────────
  tool(
    'zujuan_list_topics',
    '精品专辑：按学科浏览或按关键字搜索专辑（如 "真题汇编"、"高频考点"、"期末复习"）。',
    {
      subject: z.string().optional(),
      keyword: z.string().optional(),
      url: z.string().optional().describe('直接打开专辑列表的筛选地址（filters 中的 href）'),
      page: z.number().int().min(1).optional(),
    },
    async (a) => json(await ft.listTopics(a))
  );

  tool(
    'zujuan_topic_detail',
    '打开专辑详情：专辑信息、同系列子专辑、目录（各专题 URL），以及当前专题下的试题。打开某个专题 URL 可读其试题；试题可用 zujuan_add_to_basket 加入试题篮。',
    { url: z.string().describe('专辑地址，如 /thematiclist/11pt8544ct26504.html') },
    async ({ url }) => json(await ft.topicDetail(url))
  );

  tool(
    'zujuan_good_lessons',
    '上好课（同步备课）：打开学科的上好课页面并列出资源。',
    { subject: z.string().optional() },
    async (a) => json(await ft.goodLessons(a))
  );

  // ───────────── 底层 ─────────────
  tool(
    'zujuan_api',
    '高级：在已登录的组卷网页面内直接调用站内接口（/zujuan-api/...），用于专用工具没有覆盖的功能。method 默认 POST（表单格式）。',
    {
      path: z.string().regex(/^\/(zujuan-api|dialog)\//).describe('接口路径，如 /zujuan-api/user_paper/download_paged'),
      data: z.record(z.string(), z.any()).optional(),
      method: z.enum(['GET', 'POST']).optional(),
    },
    async ({ path, data, method }) => {
      const r = await ft.api(path, data || {}, method || 'POST');
      const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
      return text(s.length > 30000 ? s.slice(0, 30000) + '\n…(已截断)' : s);
    }
  );
}
