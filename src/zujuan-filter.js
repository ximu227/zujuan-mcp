import { browser, BASE_URL } from './browser.js';
import { assertNotLogin, isLoginUrl } from './zujuan-core.js';
import { readListPage } from './zujuan-parse.js';
import { getFilters } from './zujuan-list.js';


export async function applyFilter(group, option, withImages) {
  const { groups } = await getFilters();
  const g = groups.find((x) => x.group === group) || groups.find((x) => x.group.includes(group) || group.includes(x.group));
  if (!g) throw new Error(`未找到筛选分组「${group}」。可用分组：${groups.map((x) => x.group).join('、')}`);
  const o = g.options.find((x) => x.name === option) || g.options.find((x) => x.name.includes(option));
  if (!o) throw new Error(`分组「${g.group}」中没有「${option}」。可选：${g.options.map((x) => x.name).join('、')}`);
  let page = await browser.ensure();
  if (o.href) {
    page = await browser.goto(o.href);
  } else {
    // 场景等筛选为前端 JS + Ajax
    await page.evaluate(
      ({ group, name }) => {
        const sel = group === '场景' ? '[data-action="selectSource"]' : group === '排序' ? '.sort-ctrls a' : '.type-group-item a, .type-menu a';
        const a = [...document.querySelectorAll(sel)].find((x) => x.innerText.trim() === name);
        a?.click();
      },
      { group: g.group, name: o.name }
    );
    await page.waitForTimeout(2500);
    // Ajax 筛选后页面上其他筛选链接/分页仍是旧的，按新 URL 重新加载以保持一致
    page = await browser.goto(page.url());
  }
  assertNotLogin(page);
  return readListPage(page, withImages);
}

export async function searchInResults(keyword, withImages) {
  const page = await browser.ensure();
  if (!(await page.locator('#searchResult').count())) {
    throw new Error('当前页面没有「在结果中搜索」框。请先打开章节/知识点选题列表页。');
  }
  await page.fill('#searchResult', keyword);
  await page.press('#searchResult', 'Enter');
  await page.waitForTimeout(3000);
  assertNotLogin(page);
  return readListPage(page, withImages);
}

export async function globalSearch(keyword, withImages) {
  let page = await browser.ensure();
  if (!page.url().startsWith(BASE_URL) || isLoginUrl(page.url())) page = await browser.goto('/');
  const input = page.locator('.header .search-box input[type=text], input[placeholder*="请输入"]').first();
  await input.fill(keyword);
  await input.press('Enter');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3500);
  page = await browser.ensure();
  assertNotLogin(page);
  return readListPage(page, withImages);
}
