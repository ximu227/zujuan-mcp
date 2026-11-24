import { browser, BASE_URL } from './browser.js';
import { assertNotLogin, setSubject } from './zujuan-core.js';
import { restoreChecked } from './zujuan-basket.js';


export async function getPaper(subject) {
  if (subject) await setSubject(subject);
  let page = await browser.ensure();
  if (!/\/zujuan\/?$/.test(new URL(page.url()).pathname)) page = await browser.goto('/zujuan/', { waitMs: 3000 });
  assertNotLogin(page);
  return page.evaluate(() => {
    const text = document.body.innerText;
    const P = window.ZujuanCom?.Paper;
    let ids, types;
    try {
      ids = P?.GetQuesIDList();
      types = P?.GetQuesTypeAll?.();
    } catch {}
    return {
      url: location.href,
      title: document.querySelector('.paper-title, .paper-name, [class*=paper-title]')?.innerText.trim(),
      questionCount: (text.match(/题量[:：]\s*(\d+)/) || [])[1],
      difficulty: (text.match(/难度[:：]\s*(\S+)/) || [])[1],
      questionIds: ids,
      quesTypes: types,
    };
  });
}

export async function clearPaper(subject) {
  if (subject) await setSubject(subject);
  let page = await browser.goto('/zujuan/', { waitMs: 3000 });
  assertNotLogin(page);
  const ids = await page.evaluate(() => window.ZujuanCom?.Paper?.GetQuesIDList() || []);
  if (!ids.length) return { cleared: 0, message: '试卷本来就是空的' };
  // 站点清空试卷时会把这些题在试题篮里改为「未勾选」，先记下勾选状态以便恢复
  const checked = await page.evaluate(() => {
    const raw = localStorage.getItem('questionBasket' + (window.currBankId || Cookie.Get('bankId') || 11));
    try {
      return JSON.parse(raw || '[]').filter((q) => q.status !== 'NOCHECK').map((q) => q.questionId);
    } catch {
      return null;
    }
  });
  // 清空后站点会发 sync_version(syncFlag=1) 把空试卷同步到服务器；必须等它完成，
  // 否则浏览器过早关闭时服务器仍保留旧试卷，下次打开又会恢复
  const synced = page
    .waitForResponse((r) => /sync_version/.test(r.url()) && /syncFlag=1/.test(r.request().postData() || ''), { timeout: 15000 })
    .catch(() => null);
  await page.locator('.clear-btn').first().click();
  await page.locator('.dialog-btn.confirm-btn').first().click({ timeout: 5000 });
  await synced;
  await page.waitForTimeout(1500);
  if (checked?.length) await restoreChecked(checked);
  // 重新加载确认确实清空
  page = await browser.goto('/zujuan/', { waitMs: 2500 });
  const left = await page.evaluate(() => window.ZujuanCom?.Paper?.GetQuesIDList()?.length || 0);
  if (left) throw new Error(`清空后重新加载，组卷中心仍有 ${left} 道题，请重试 zujuan_clear_paper`);
  return { cleared: ids.length, ...(await getPaper()) };
}
