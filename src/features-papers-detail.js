// 试卷详情与整卷加入试题篮
import { browser } from './browser.js';

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

