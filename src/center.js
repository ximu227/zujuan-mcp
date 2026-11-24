// 组卷中心（/zujuan/）编辑操作：标题、模板、排序、分值、换题、上下移、删除、保存存档、试卷分析、答题卡等
import { browser } from './browser.js';
import { setSubject } from './zujuan.js';

async function centerPage(subject) {
  if (subject) await setSubject(subject);
  let page = await browser.ensure();
  if (subject || !/\/zujuan\/?$/.test(new URL(page.url()).pathname)) page = await browser.goto('/zujuan/', { waitMs: 3000 });
  if (/sso\.zxxk\.com\/login/.test(page.url())) throw new Error('组卷中心需要登录，请先调用 zujuan_login。');
  // 关闭上一次操作遗留的对话框，避免遮挡
  if (page.frames().some((f) => /\/dialog\//.test(f.url()))) await closeDialogs(page);
  return page;
}

async function quesItem(page, id) {
  const q = page.locator(`.ques-item[questionid="${id}"]`).first();
  if (!(await q.count())) throw new Error(`组卷中心试卷里没有试题 ${id}。可用 zujuan_get_paper 查看题号。`);
  await q.scrollIntoViewIfNeeded();
  await q.hover();
  return q;
}

/** 依次在当前页面打开的对话框里找到最后一个 iframe */
async function lastDialogFrame(page, urlPart, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().filter((x) => x.url().includes(urlPart)).at(-1);
    if (f) {
      await f.waitForLoadState('domcontentloaded').catch(() => {});
      return f;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`对话框 ${urlPart} 没有出现`);
}

async function closeDialogs(page) {
  for (const f of page.frames()) {
    if (f === page.mainFrame() || !/\/dialog\//.test(f.url())) continue;
    await f.evaluate(() => (document.querySelector('.close-btn, .cancel-btn, [class*=cancel]') || {}).click?.()).catch(() => {});
  }
  await page
    .evaluate(() => {
      document.querySelectorAll('.tk-dialog .close-btn, .ife-modal .close-btn').forEach((b) => b.click());
      // 仍未关闭的对话框容器直接移除
      document.querySelectorAll('.iframe-box, .tk-dialog').forEach((d) => {
        if (d.querySelector('iframe[src*="/dialog/"]')) d.remove();
      });
    })
    .catch(() => {});
  await page.waitForTimeout(500);
}

/** 读取组卷中心试卷的完整结构（含分值、题号顺序） */
export async function paperStructure(subject) {
  const page = await centerPage(subject);
  return page.evaluate(() => {
    const xml = new DOMParser().parseFromString(window.ZujuanCom.Paper.Xml(), 'text/xml');
    const head = {};
    xml.querySelectorAll('head > *').forEach((n) => {
      if (n.getAttribute('text') != null) head[n.tagName] = { display: n.getAttribute('display'), text: n.getAttribute('text') };
    });
    const parts = [...xml.querySelectorAll('body > part')].map((p) => ({
      name: p.querySelector('partHead')?.getAttribute('name'),
      quesTypes: [...p.querySelectorAll('quesType')].map((qt) => ({
        name: qt.querySelector('quesTypeHead')?.getAttribute('name'),
        questions: [...qt.querySelectorAll('ques')].map((q) => ({
          id: q.getAttribute('id'),
          type: q.getAttribute('qyname'),
          difficulty: `${q.getAttribute('qdname')} (${q.getAttribute('qdvalue')})`,
          score: q.getAttribute('score') || '',
          source: q.getAttribute('titleAbbreviation') || q.getAttribute('title'),
          category: q.getAttribute('categoryname'),
        })),
      })),
    }));
    const text = document.body.innerText;
    return {
      title: document.querySelector('#pui_maintitle')?.innerText.trim(),
      questionCount: (text.match(/题量[:：]\s*(\d+)/) || [])[1],
      difficulty: (text.match(/难度[:：]\s*(\S+)/) || [])[1],
      totalScore: (text.match(/分值[:：]\s*(\d+)/) || [])[1],
      template: document.querySelector('.type-item.radio--checked .radio-label')?.innerText.trim(),
      head,
      parts,
    };
  });
}

/** 修改试卷主标题/副标题 */
export async function setTitle({ title, subtitle }) {
  const page = await centerPage();
  await page.evaluate(
    ({ title, subtitle }) => {
      const data = [];
      if (title != null) data.push(['mainTitle', 'text', title]);
      if (subtitle != null) data.push(['subTitle', 'text', subtitle], ['subTitle', 'display', subtitle ? '1' : '0']);
      const P = window.ZujuanCom.Paper;
      P.EditHead(data);
      P.SaveXmlSync(P.Xml()); // 同步到服务器
      if (title != null) document.querySelector('#pui_maintitle').innerText = title;
    },
    { title, subtitle }
  );
  return paperStructure();
}

/** 试卷模板：作业 / 测试 / 考试 */
export async function setTemplate(name) {
  const page = await centerPage();
  const cls = { 作业: 'homework', 测试: 'test', 考试: 'exam' }[name];
  if (!cls) throw new Error('模板只能是：作业、测试、考试');
  await page.locator(`.tk-radio.type-item.${cls}`).first().click();
  await page.waitForTimeout(1500);
  return paperStructure();
}

/** 分组与排序：按题型 / 按知识点 / 按加入顺序；可选由易到难 */
export async function setOrder({ groupBy, easyToHard }) {
  const page = await centerPage();
  if (groupBy) {
    const t = { 题型: 'selectQtOrder', 知识点: 'selectKnowledgeOrder', 加入顺序: 'selectAddOrder' }[groupBy];
    if (!t) throw new Error('groupBy 只能是：题型、知识点、加入顺序');
    await page.locator(`a[data-type="${t}"]`).first().click();
    await page.waitForTimeout(1500);
  }
  if (easyToHard !== undefined) {
    const label = easyToHard ? '由易到难' : '加入顺序';
    await page.locator('.tk-radio', { hasText: label }).filter({ visible: true }).first().click();
    await page.waitForTimeout(1500);
  }
  return paperStructure();
}

/** 设置单题分值（直接写入试卷 XML，与「分值」按钮结果一致） */
export async function setScores(scores) {
  const page = await centerPage();
  const res = await page.evaluate((scores) => {
    const P = window.ZujuanCom.Paper;
    const out = [];
    for (const [id, score] of Object.entries(scores)) {
      if (!P.IsExitQues(id)) {
        out.push({ id, ok: false, msg: '不在试卷中' });
        continue;
      }
      try {
        P.SetQuesScore(id, String(score));
        out.push({ id, ok: true, score });
      } catch (e) {
        out.push({ id, ok: false, msg: String(e) });
      }
    }
    P.SaveXmlSync(P.Xml()); // 同步到服务器
    return out;
  }, scores);
  // 重新加载让界面与 XML 同步
  await browser.goto('/zujuan/', { waitMs: 2500 });
  return { results: res, paper: await paperStructure() };
}

/** 题目操作：上移 / 下移 / 删除 */
export async function questionAction(id, action) {
  const page = await centerPage();
  const q = await quesItem(page, id);
  const type = { up: 'quesItemUp', down: 'quesItemDown', delete: 'delQuesItem' }[action];
  if (!type) throw new Error('action 只能是 up / down / delete');
  page.__dialogs.length = 0;
  await q.locator(`[data-type="${type}"]`).first().click({ force: true });
  await page.waitForTimeout(800);
  // 删除可能弹出站内确认框
  const confirm = page.locator('.tk-dialog .confirm-btn, .dialog-btn.confirm-btn').filter({ visible: true }).first();
  if (await confirm.count()) await confirm.click().catch(() => {});
  await page.waitForTimeout(1200);
  return paperStructure();
}

/** 换题：打开站点的「试题替换」对话框，列出可替换的候选题；传 newId 则直接替换 */
export async function switchQuestion(id, newId) {
  const page = await centerPage();
  const q = await quesItem(page, id);
  await q.locator('[data-type="switchQues"]').first().click({ force: true });
  const f = await lastDialogFrame(page, '/dialog/question_switch');
  await f.waitForSelector('.quesroot, [questionid]', { timeout: 10000 }).catch(() => {});
  if (!newId) {
    const cands = await f.evaluate(() =>
      [...document.querySelectorAll('.quesroot[questionid]')].map((r) => ({
        id: r.getAttribute('questionid'),
        content: (r.querySelector('.exam-item__cnt')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      }))
    );
    await closeDialogs(page);
    return { id, candidates: cands, hint: '用 newId 参数指定要换成的题' };
  }
  const btn = f.locator(`.quesroot[questionid="${newId}"] a, .quesroot[questionid="${newId}"] [class*=btn]`).filter({ hasText: /替换|换/ }).first();
  if (!(await btn.count())) {
    await closeDialogs(page);
    throw new Error(`候选列表中没有试题 ${newId}`);
  }
  await btn.click();
  await page.waitForTimeout(2500);
  await closeDialogs(page);
  return paperStructure();
}

/** 试卷分析（对话框内容） */
export async function paperAnalysis() {
  const page = await centerPage();
  const btn = page.locator('#zujuanPaperAnalyze, a.fn-btn:has-text("试卷分析")').first();
  await btn.click({ force: true });
  const f = await lastDialogFrame(page, '/dialog/pop_paper_analyze', 15000);
  await f.waitForTimeout(1500);
  const text = await f.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').trim());
  await closeDialogs(page);
  return text;
}

/** 保存试卷到「我的-试卷存档」 */
export async function savePaper(name) {
  const page = await centerPage();
  await page.locator('a.fn-btn', { hasText: '保存试卷' }).first().click({ force: true });
  const f = await lastDialogFrame(page, '/dialog/tk_save_paper');
  await f.waitForSelector('#save_paper_title', { timeout: 8000 });
  if (name) await f.fill('#save_paper_title', name);
  const finalName = await f.inputValue('#save_paper_title');
  await f.locator('button.confirm-btn').first().click();
  await page.waitForTimeout(2500);
  const msg = await f.evaluate(() => document.body.innerText.trim().slice(0, 200)).catch(() => '');
  await closeDialogs(page);
  return { saved: finalName, message: msg || undefined };
}

/** 打开答题卡相关对话框，返回其中的选项文本（下载答题卡 / 制作答题卡） */
export async function answerSheet(kind = 'download') {
  const page = await centerPage();
  const label = kind === 'make' ? '制作答题卡' : '下载答题卡';
  page.__dialogs.length = 0;
  const [popup] = await Promise.all([
    browser.context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
    page.locator('a.fn-btn', { hasText: label }).first().click({ force: true }),
  ]);
  await page.waitForTimeout(2500);
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    return { openedNewTab: popup.url(), title: await popup.title() };
  }
  const f = page.frames().filter((x) => /\/dialog\/(answer_sheet|job_type)/.test(x.url())).at(-1);
  if (!f) return { message: page.__dialogs.map((d) => d.message).join('; ') || '没有出现答题卡对话框' };
  const text = await f.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').trim().slice(0, 2000));
  return {
    dialog: f.url(),
    text,
    hint: '对话框已打开，可用 browser_snapshot / browser_click 继续选择答题卡样式并下载（下载可用 browser_wait_for_download）',
  };
}

export { closeDialogs };
