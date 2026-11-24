export const DL_OPTIONS = {
  answerPosition: { 卷尾: 'normal', 题后: 'teacher', 不显示: 'student' },
  source: { 不显示: 'notShowOrigin', 题文前: 'isShowOrigin-quesbody', 答案处: 'isShowOrigin-quesanwser' },
  formula: { png: 'png', mathtype: 'mathtype', officemath: 'microsoft' },
  fontSize: { 五号: '5', 四号: '4', 小四: '41', 三号: '3' },
  useScene: { 日常作业: 'tag1', 课堂讲义: 'tag2', 阶段小测: 'tag3', 正式考试: 'tag4', 自主练习: 'tag5', 其他: 'tag6' },
};

export async function fillDownloadOptions(frame, o) {
  // 只操作可见选项（整卷下载对话框里「试题篮删除本次用题」等选项是隐藏的）
  const radio = async (id) => {
    const r = frame.locator(`.tk-radio:has(input#${id})`).filter({ visible: true }).first();
    if (await r.count()) await r.click({ timeout: 5000 }).catch(() => r.evaluate((el) => el.click()));
  };
  const checkbox = async (id, want) => {
    const box = frame.locator(`.tklabel-checkbox:has(input#${id})`).filter({ visible: true }).first();
    if (!(await box.count())) return;
    const on = await box.evaluate((el) => el.classList.contains('checked'));
    if (on !== want) await box.locator('label').click();
  };
  const select = async (name, id) => {
    const sel = frame.locator(`.tk-selector:has(select[name=${name}])`).filter({ visible: true }).first();
    if (!(await sel.count())) return;
    await sel.locator('.selector__current').click();
    await sel.locator(`li[data-id="${id}"]`).click();
  };
  if (o.title && (await frame.locator('input[name=paperTitle]').count())) await frame.fill('input[name=paperTitle]', o.title);
  if (o.answerPosition) await radio(DL_OPTIONS.answerPosition[o.answerPosition]);
  if (o.includeAnalysis !== undefined) await checkbox('downParse', o.includeAnalysis);
  if (o.includeKnowledge !== undefined) await checkbox('downKnowledge', o.includeKnowledge);
  if (o.includeDifficulty !== undefined) await checkbox('downDifficulty', o.includeDifficulty);
  if (o.includeQrCode !== undefined) await checkbox('downExplainQrCode', o.includeQrCode);
  if (o.source) await radio(DL_OPTIONS.source[o.source]);
  // 默认不从试题篮删除本次用题（仅组卷中心下载有此选项）
  if (!o.source || o.source === 'center') await radio(o.removeFromBasket ? 'isIs' : 'isNo');
  if (o.paperSize) await select('papersize', o.paperSize);
  if (o.format) await select('docversion', o.format);
  if (o.formula) await select('formula', DL_OPTIONS.formula[o.formula]);
  if (o.answerArea !== undefined) await select('answerArea', o.answerArea ? 'needAnswerArea' : 'noAnswerArea');
  if (o.fontSize) await select('artFontSize', DL_OPTIONS.fontSize[o.fontSize]);
  for (const sc of o.useScene || []) await checkbox(DL_OPTIONS.useScene[sc], true);
  return frame.evaluate(() => ({
    title: document.querySelector('input[name=paperTitle]')?.value,
    answerPosition: document.querySelector('.answer-pos .radio--checked')?.innerText.trim(),
    analysis: [...document.querySelectorAll('.parse-content .tklabel-checkbox.checked')].map((e) => e.innerText.trim()),
    source: document.querySelector('.ques-from .radio--checked')?.innerText.trim(),
    removeFromBasket: document.querySelector('.clear-bag .radio--checked')?.innerText.trim(),
    paperSize: document.querySelector('.paper-size .selector__current')?.innerText.trim(),
    format: document.querySelector('.word-version .selector__current')?.innerText.trim(),
    formula: document.querySelector('.formulas .selector__current')?.innerText.trim(),
    answerArea: document.querySelector('.answer-area .selector__current')?.innerText.trim(),
    fontSize: document.querySelector('.art-font-size .selector__current')?.innerText.trim(),
    price: document.querySelector('a.confirm-btn')?.innerText.replace(/\s+/g, ''),
  }));
}

export const CAPTCHA_VISIBLE = () =>
  [...document.querySelectorAll('[class*=geetest]')].some(
    (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 50
  );
