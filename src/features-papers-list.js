// 试卷列表：列表查询与筛选项
import { browser } from './browser.js';
import { resolveSubject } from './zujuan.js';
import { PARSE_PAPERS, PARSE_PAPER_FILTERS } from './features-core.js';

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
