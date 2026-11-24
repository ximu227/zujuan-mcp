export const PARSE_QUESTIONS = (withImages) => {
  const textOf = (el, imgs) => {
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
    return clone.innerText.replace(/[ \t ]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  };
  return [...document.querySelectorAll('.tk-quest-item.quesroot')].map((q) => {
    const id = q.getAttribute('questionid');
    const bankId = q.getAttribute('bankid');
    const infos = [...q.querySelectorAll('.ques-additional .info-cnt')].map((e) => e.innerText.trim());
    const btn = q.querySelector('[data-btn-type="quesAdd"]');
    const imgs = [];
    const item = {
      id,
      // 不同页面 questionindex 起点不同（0 或 1），以题干前的题号为准
      index: Number((q.querySelector('.exam-item__cnt')?.innerText.match(/^\s*(\d+)\s*[.．、]/) || [])[1]) || Number(q.getAttribute('questionindex')) + 1,
      type: btn?.getAttribute('qyname') || infos[0],
      typeDetail: infos[0],
      difficulty: infos[1],
      knowledge: [...q.querySelectorAll('.knowledge-list .knowledge-item')].map((a) => a.title || a.innerText.trim()),
      source: btn?.getAttribute('questitle') || undefined,
      content: textOf(q.querySelector('.exam-item__cnt'), imgs),
      // 已加入时按钮文字不变，只是 class 从 addques 变为 delques
      inBasket: btn ? btn.classList.contains('delques') : undefined,
      meta: q.querySelector('.exam-item__info .info-msgs')?.innerText.replace(/\s+/g, ' ').trim(),
      detailUrl: `/${bankId}q${id}.html`,
    };
    if (withImages && imgs.length) item.images = imgs;
    return item;
  });
};

export async function readListPage(page, withImages) {
  const questions = await page.evaluate(PARSE_QUESTIONS, !!withImages);
  const extra = await page.evaluate(() => {
    const pager = document.querySelector('.tk-pager');
    const active = pager?.querySelector('.pager-item.active');
    const last = pager?.querySelector('#lastpage');
    return {
      total:
        document.querySelector('#questioncount')?.innerText.trim() ||
        (document.querySelector('.count-box, .count')?.innerText.match(/\d+/) || [])[0],
      page: active ? Number(active.dataset.num) : 1,
      lastPage: last ? Number(last.getAttribute('lastid')) : undefined,
    };
  });
  return { url: page.url(), ...extra, questions };
}
