import { browser } from './browser.js';
import { currentBankId } from './zujuan-core.js';


export async function getQuestion(id, { bankId, withImages } = {}) {
  let page = await browser.ensure();
  const bid = bankId || (await currentBankId(page)) || 11;
  page = await browser.goto(`/${bid}q${id}.html`);
  if (/当前请求资源不存在/.test(await page.title())) throw new Error(`试题 ${id} 不存在（bankId=${bid}）。`);
  return page.evaluate((withImages) => {
    const imgs = [];
    const textOf = (el) => {
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        const isFormula = /formula/.test(src);
        let ph = isFormula ? '[公式]' : '[图]';
        if (withImages) {
          imgs.push(src);
          ph = `[${isFormula ? '公式' : '图'}${imgs.length}]`;
        }
        img.replaceWith(document.createTextNode(ph));
      });
      clone.querySelectorAll('bk').forEach((b) => b.replaceWith(document.createTextNode('____')));
      return clone.innerText.replace(/[ \t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    };
    const root = document.querySelector('.quest-content .quesroot');
    const answerBox = document.querySelector('.answer-box');
    let answer;
    if (answerBox) {
      const c = answerBox.cloneNode(true);
      c.querySelector('.knowledges')?.remove();
      c.querySelector('.copyright-msg')?.remove();
      const ansImgs = [...c.querySelectorAll('.answer-txt img')].map((i) => i.getAttribute('src'));
      answer = textOf(c) || undefined;
      if (c.querySelector('.need-login') || /未登录/.test(answer || '')) {
        answer = '（未登录，无法查看答案和解析。请先调用 zujuan_login）';
      } else if (ansImgs.length && !answer?.replace(/\[图\d*\]/g, '').trim()) {
        // 组卷网的答案解析以图片形式下发，需用 zujuan_screenshot_question 的 part=answer 查看
        answer = '（答案解析为图片，调用 zujuan_screenshot_question 并设置 part="answer" 查看）';
      }
    }
    const btn = root?.querySelector('[data-btn-type="quesAdd"]');
    const out = {
      id: root?.getAttribute('questionid'),
      bankId: root?.getAttribute('bankid'),
      info: [...document.querySelectorAll('.info-list .info-item')].map((e) => e.innerText.trim()),
      breadcrumb: [...document.querySelectorAll('.bread-nav-item')].map((a) => a.innerText.trim()),
      content: textOf(root?.querySelector('.quest-cnt')),
      knowledge: [...document.querySelectorAll('.knowledges .knowledge-name')].map((a) => a.innerText.trim()),
      source: btn?.getAttribute('questitle'),
      inBasket: btn ? btn.classList.contains('delques') : undefined,
      answerAndAnalysis: answer,
      url: location.href,
    };
    if (withImages && imgs.length) out.images = imgs;
    return out;
  }, !!withImages);
}

export async function screenshotQuestion(id, part = 'question') {
  let page = await browser.ensure();
  if (part === 'answer') {
    if (!(await page.locator(`.quest-content .quesroot[questionid="${id}"]`).count())) await getQuestion(id);
    page = await browser.ensure();
    const box = page.locator('.answer-box').first();
    if (!(await box.count())) throw new Error('详情页没有答案解析区域。');
    if (await box.locator('.need-login').count()) throw new Error('未登录，无法查看答案和解析。请先调用 zujuan_login。');
    // 等待答案图片加载完成
    await box
      .locator('.answer-txt img')
      .first()
      .evaluate((img) => img.complete || new Promise((r) => (img.onload = img.onerror = r)))
      .catch(() => {});
    await box.scrollIntoViewIfNeeded();
    return box.screenshot({ type: 'png' });
  }
  let loc = page.locator(`.quesroot[questionid="${id}"]`).first();
  if (!(await loc.count())) {
    await getQuestion(id);
    loc = (await browser.ensure()).locator('.quest-content .quesroot').first();
  }
  await loc.scrollIntoViewIfNeeded();
  return loc.screenshot({ type: 'png' });
}
