import { browser, BASE_URL } from './browser.js';
import { assertNotLogin, setSubject } from './zujuan-core.js';
import { getQuestion } from './zujuan-question.js';


export const BASKET_IDS = () => {
  const m = window.ZujuanCom?.QuestionBasketModule?.questionBasketManager;
  return m ? m.findAllQuestionIds().map(String) : null;
};

export async function basketIds(page) {
  const ids = await page.evaluate(BASKET_IDS).catch(() => null);
  if (ids === null) throw new Error('当前页面无法访问试题篮模块。请先打开组卷网的选题页面。');
  return ids;
}

export async function toggleBasket(ids, wantIn) {
  const results = [];
  for (const id of ids) {
    let page = await browser.ensure();
    let btn = page.locator(`#quesselect${id}`).first();
    if (!(await btn.count())) {
      await getQuestion(id);
      page = await browser.ensure();
      btn = page.locator(`#quesselect${id}`).first();
    }
    if (!(await btn.count())) {
      results.push({ id, ok: false, message: '页面上没有找到该题的试题篮按钮' });
      continue;
    }
    if ((await basketIds(page)).includes(id) === wantIn) {
      results.push({ id, ok: true, message: wantIn ? '已在试题篮中' : '不在试题篮中' });
      continue;
    }
    page.__dialogs.length = 0;
    // 右侧悬浮栏可能遮挡按钮，直接触发 DOM 点击
    await btn.evaluate((el) => el.click());
    let nowIn = !wantIn;
    for (let i = 0; i < 10 && nowIn !== wantIn; i++) {
      await page.waitForTimeout(400);
      page = await browser.ensure();
      assertNotLogin(page);
      nowIn = (await basketIds(page)).includes(id);
    }
    const msg = page.__dialogs.map((d) => d.message).join('; ');
    results.push({
      id,
      ok: nowIn === wantIn,
      message: msg || (nowIn === wantIn ? (wantIn ? '已加入试题篮' : '已移出试题篮') : '操作未生效'),
    });
  }
  const page = await browser.ensure();
  return { results, basketCount: (await basketIds(page)).length };
}

export const addToBasket = (ids) => toggleBasket(ids, true);

export const removeFromBasket = (ids) => toggleBasket(ids, false);

export async function getBasket(subject) {
  if (subject) await setSubject(subject);
  let page = await browser.ensure();
  const ok = await page.evaluate(() => !!window.ZujuanCom?.QuestionBasketModule).catch(() => false);
  if (!ok) page = await browser.goto('/zhangjie/');
  assertNotLogin(page);
  return page.evaluate(() => {
    const m = window.ZujuanCom?.QuestionBasketModule?.questionBasketManager;
    if (!m) return { error: '无法访问试题篮模块' };
    const groups = m.findAllQuestions();
    return {
      subjectBankId: window.currBankId || undefined,
      count: m.findAllQuestionIds().length,
      averageDifficulty: m.averageDifficulty?.(),
      byType: groups.map((g) => ({
        type: g.typeName,
        count: g.questionList.length,
        questions: g.questionList.map((q) => ({
          id: String(q.questionId),
          difficulty: q.ext?.quesDiffValue,
          source: q.ext?.title,
          category: q.ext?.categoryName,
        })),
      })),
    };
  });
}

export async function clearBasket(subject) {
  if (subject) await setSubject(subject);
  let page = await browser.ensure();
  const has = await page.evaluate(() => !!window.ZujuanCom?.QuestionBasketModule).catch(() => false);
  if (!has) page = await browser.goto('/zhangjie/');
  assertNotLogin(page);
  await page.evaluate(() => {
    const m = window.ZujuanCom.QuestionBasketModule.questionBasketManager;
    m.clearBasket(false); // false = 同步到服务器
    window.ZujuanCom.Paper?.InitToLocal?.();
  });
  await page.waitForTimeout(1500);
  await browser.goto(page.url());
  return getBasket();
}

export async function restoreChecked(checkedIds) {
  const p = await browser.backgroundPage();
  try {
    await p.goto(BASE_URL + '/zhangjie/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForFunction(() => !!window.ZujuanCom?.QuestionBasketModule?.questionBasketManager, null, { timeout: 15000 });
    await p.evaluate((l) => window.ZujuanCom.QuestionBasketModule.questionBasketManager.updateSelectStatus(l.map(Number)), checkedIds);
    await p.waitForTimeout(1500);
  } catch (e) {
    process.stderr.write(`[zujuan-mcp] 恢复试题篮勾选状态失败：${e.message}
`);
  } finally {
    await p.close().catch(() => {});
  }
}
