import { browser } from './browser.js';


export async function listTextbooks(version) {
  const page = await browser.ensure();
  if (!(await page.locator('#chapter_textbook_version').count())) {
    throw new Error('当前页面不是章节选题页。请先调用 zujuan_open_subject（mode=zhangjie）。');
  }
  if (version) {
    const ok = await page.evaluate((v) => {
      const items = [...document.querySelectorAll('#chapter_textbook_version a')];
      const a = items.find((x) => x.innerText.trim() === v) || items.find((x) => x.innerText.includes(v));
      if (!a) return false;
      a.click();
      return true;
    }, version);
    if (!ok) throw new Error(`未找到教材版本：${version}`);
    await page.waitForTimeout(2000);
  }
  return page.evaluate(() => {
    const versions = [...document.querySelectorAll('#chapter_textbook_version a')].map((a) => ({
      name: a.innerText.trim(),
      versionId: a.getAttribute('versionid'),
      selected: a.classList.contains('selected'),
    }));
    const textbooks = [...document.querySelectorAll('#chapter_textbooks a')].map((a) => ({
      name: a.innerText.trim(),
      url: a.getAttribute('href'),
      selected: a.classList.contains('selected'),
    }));
    return { versions, textbooks };
  });
}

export async function getCatalog({ url, maxDepth = 3, filter } = {}) {
  const page = url ? await browser.goto(url) : await browser.ensure();
  await page.waitForSelector('.tk-tree a.tree-anchor', { timeout: 15000 }).catch(() => {});
  const nodes = await page.evaluate(() =>
    [...document.querySelectorAll('.tk-tree li.tree-node')].map((li) => {
      const a = li.querySelector(':scope > .tree-node-name a.tree-anchor');
      return {
        level: Number(li.dataset.level) || 1,
        name: a?.title || a?.innerText.trim(),
        url: a?.dataset.href,
        selected: li.classList.contains('tree-selected') || !!li.querySelector(':scope > .tree-node-name.selected'),
      };
    })
  );
  if (!nodes.length) throw new Error('当前页面没有找到章节/知识点目录树。请先打开章节选题或知识点选题页。');
  let out = nodes.filter((n) => n.level <= maxDepth);
  if (filter) out = nodes.filter((n) => n.name?.includes(filter));
  const lines = out.map((n) => `${'  '.repeat(n.level - 1)}- ${n.name}  ${n.url}`);
  return { url: page.url(), total: nodes.length, shown: out.length, tree: lines.join('\n') };
}
