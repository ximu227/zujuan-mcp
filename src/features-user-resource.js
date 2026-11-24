// 上好课与精品专辑
import { browser } from './browser.js';
import { resolveSubject } from './zujuan.js';

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
      if (name && opts.length) filters[name] = [];
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

