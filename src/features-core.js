// 组卷网扩展功能 · 共享基础：页面就绪、站内 API、试卷列表解析等
import { browser, BASE_URL } from './browser.js';
import { resolveSubject, setSubject } from './zujuan.js';

export const FORM = { headers: { 'content-type': 'application/x-www-form-urlencoded' } };

export function isLoginUrl(url) {
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


export const useSubject = (subject) => setSubject(subject);

// ───────────────────────── 试卷选题 ─────────────────────────

export const PAPER_SECTIONS = {
  tbjx: '同步教学（按教材章节）',
  jdcs: '阶段测试（月考/期中/期末/专题/开学考）',
  bk: '高考/中考备考（模拟、真题、学业考试、复习）',
};

/** 解析试卷列表页 */
export const PARSE_PAPERS = () => {
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
export const PARSE_PAPER_FILTERS = () => {
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
