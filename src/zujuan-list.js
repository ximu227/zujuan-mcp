import { browser, BASE_URL } from './browser.js';
import { assertNotLogin } from './zujuan-core.js';
import { readListPage } from './zujuan-parse.js';


export async function listQuestions({ url, page: pageNum, withImages } = {}) {
  let page = url ? await browser.goto(url) : await browser.ensure();
  if (pageNum) {
    const cur = await page.evaluate(() => Number(document.querySelector('.tk-pager .pager-item.active')?.dataset.num) || 1);
    if (cur !== pageNum) {
      // 分页链接可能是真实 href，也可能是 href="javascript:void 0" + data-href
      const target = await page.evaluate((n) => {
        const linkOf = (a) => {
          const h = a.getAttribute('data-href') || a.getAttribute('href') || '';
          return h.startsWith('/') || h.startsWith('http') ? h : null;
        };
        const links = [...document.querySelectorAll('.tk-pager a')].map((a) => ({ n: Number(a.dataset.num), h: linkOf(a) }));
        const exact = links.find((l) => l.n === n && l.h);
        if (exact) return exact.h;
        const tpl = links.map((l) => l.h).find((h) => h && /p\d+\/?(\?|$)/.test(h));
        return tpl ? tpl.replace(/p\d+(\/?)(\?|$)/, `p${n}$1$2`) : null;
      }, pageNum);
      if (!target) throw new Error('当前页面没有分页信息，无法翻页。');
      page = await browser.goto(target);
    }
  }
  assertNotLogin(page);
  await page.waitForSelector('.tk-quest-item', { timeout: 10000 }).catch(() => {});
  return readListPage(page, withImages);
}

export async function getFilters() {
  const page = await browser.ensure();
  const groups = await page.evaluate(() => {
    const out = [];
    const clean = (s) => s.replace(/[：:\s]+$/g, '').trim();
    const linkOf = (a) => {
      const h = a.getAttribute('data-href') || a.getAttribute('href') || '';
      return h.startsWith('/') || h.startsWith('http') ? h : undefined;
    };
    // 场景/来源
    const src = [...document.querySelectorAll('[data-action="selectSource"]')];
    if (src.length)
      out.push({
        group: '场景',
        options: src.map((a) => ({ name: a.innerText.trim(), selected: a.classList.contains('type-item--selected') })),
      });
    document.querySelectorAll('.type-group-item').forEach((g) => {
      const name = clean(g.querySelector('.type-name')?.innerText || '');
      const opts = [...g.querySelectorAll('.type-list a, a.type-item')].map((a) => ({
        name: a.innerText.trim(),
        selected: a.classList.contains('type-item--selected'),
        href: linkOf(a),
      }));
      if (name && opts.length) out.push({ group: name, options: dedupe(opts) });
    });
    document.querySelectorAll('.more-type-select .type-menu').forEach((m) => {
      const opts = [...m.querySelectorAll('a.link-txt')].map((a) => ({
        name: a.innerText.trim(),
        selected: !!a.closest('.link-txt--selected'),
        href: linkOf(a),
      }));
      if (opts.length) out.push({ group: m.dataset.name || clean(m.innerText), options: dedupe(opts) });
    });
    const sort = [...document.querySelectorAll('.sort-ctrls a.sort-item')].map((a) => ({
      name: a.innerText.trim(),
      selected: a.classList.contains('sort-item--selected'),
      href: linkOf(a),
    }));
    if (sort.length) out.push({ group: '排序', options: sort });
    function dedupe(list) {
      const seen = new Set();
      return list.filter((o) => o.name && !seen.has(o.name) && seen.add(o.name));
    }
    return out;
  });
  if (!groups.length) throw new Error('当前页面没有筛选条件。请先打开章节/知识点选题列表页。');
  return { url: page.url(), groups };
}
