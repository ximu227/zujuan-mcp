// 试卷选题、试卷详情、试卷篮 / 试卷汇编
import { browser } from './browser.js';
import { resolveSubject } from './zujuan.js';
import { api, useSubject, PARSE_PAPERS, PARSE_PAPER_FILTERS } from './features-core.js';

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
  if (!Array.is(list) || !list.length) return { empty: true, nodes: [] };
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
