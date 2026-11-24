import { browser } from './browser.js';
import { assertNotLogin, setSubject, currentSubject } from './zujuan-core.js';
import { restoreChecked } from './zujuan-basket.js';


export async function sendBasketToPaper(ids, subject, { overwrite = false } = {}) {
  if (subject) await setSubject(subject);
  let page = await browser.ensure();
  const has = await page.evaluate(() => !!window.ZujuanCom?.QuestionBasketModule).catch(() => false);
  if (!has || /\/zujuan\/?$/.test(new URL(page.url()).pathname)) page = await browser.goto('/zhangjie/');
  assertNotLogin(page);
  const state = await page.evaluate(() => {
    const m = window.ZujuanCom.QuestionBasketModule.questionBasketManager;
    return {
      all: m.findAllQuestionIds().map(String),
      checked: m.findCheckedQuestions().map((q) => String(q.questionId)),
      paper: window.ZujuanCom.Paper.GetQuesIDList(-1, window.ZujuanCom.Paper.StorageDefault).length,
      max: window.usergroup?.MaxQuesNumInPaper,
    };
  });
  if (!state.all.length) {
    const cur = await currentSubject();
    throw new Error(`当前学科（${cur?.subject || '未知'}）的试题篮是空的。试题篮按学科分开，可传 subject 参数切换学科，或先用 zujuan_add_to_basket 加题。`);
  }
  const want = ids?.length ? ids.map(String) : state.all;
  const missing = want.filter((id) => !state.all.includes(id));
  if (missing.length) throw new Error(`这些试题不在试题篮中：${missing.join(', ')}`);
  if (state.max && want.length > state.max) throw new Error(`一份试卷最多 ${state.max} 道题，本次选了 ${want.length} 道`);
  if (state.paper && !overwrite) {
    throw new Error(`组卷中心已有 ${state.paper} 道题的组卷草稿。去组卷会清空并新建；请先用 zujuan_save_paper 保存，或传 overwrite=true 确认覆盖。`);
  }
  const changed = want.length !== state.checked.length || want.some((id) => !state.checked.includes(id));
  try {
    // 与站点「去组卷」按钮的处理完全一致：用勾选的试题新建试卷并同步到服务器
    const r = await page.evaluate(
      (want) =>
        new Promise((resolve) => {
          const m = window.ZujuanCom.QuestionBasketModule.questionBasketManager;
          const P = window.ZujuanCom.Paper;
          m.updateSelectStatus(want.map(Number));
          const list = m.findCheckedQuestList();
          P.InitToLocal();
          P.AddQuesList(list, P.StorageDefault);
          Cookie.Del('CurPaperType');
          Cookie.Del('CurSortType');
          P.setDbId(0);
          Cookie.Del('ai_down_mode');
          Cookie.Del('ai_down_ques');
          const n = P.GetQuesIDList().length;
          let done = false;
          window.ZujuanCom.quesBasketOperation.quesBasketSyncVersion(1, null, decodeURIComponent(P.Xml()), () => {
            done = true;
            resolve({ inPaper: n, synced: true });
          });
          setTimeout(() => !done && resolve({ inPaper: n, synced: false }), 30000);
        }),
      want
    );
    if (!r.synced) throw new Error('同步组卷中心超时，请稍后重试');
    page = await browser.goto('/zujuan/', { waitMs: 2500 });
    const info = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      questionCount: (document.body.innerText.match(/题量[:：]\s*(\d+)/) || [])[1],
    }));
    return { sent: want.length, ...info };
  } finally {
    if (changed && state.checked.length) {
      // 恢复用户原来的勾选状态（必须在加载了试题篮模块的页面上执行，组卷中心页不行）
      await restoreChecked(state.checked);
    }
  }
}
