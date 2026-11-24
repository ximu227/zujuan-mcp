// 智能组卷、智能换题、细目表组卷
import { browser } from './browser.js';
import { resolveSubject, setSubject } from './zujuan.js';
import { api } from './features-core.js';

const QT_NAME = { 2701: '单选题', 2704: '多选题', 2702: '填空题', 2703: '解答题', 2706: '判断题', 2707: '概念填空' };

/**
 * 智能组卷：按章节/知识点 + 各题型数量自动出卷，返回预览中的试题。
 * quesTypes: [{typeId|name, count}]
 */
export async function smartPaper({ subject, nodeIds, treeType = 2, quesTypes, scene = 0, areaId = 0, years = 0, difficulty }) {
  const s = resolveSubject(subject || 'gzsx');
  let page = await browser.goto(`/${s.code}/zhineng/`, { waitMs: 2500 });
  // 读取当前学科的题型 id
  const typeMap = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('input')]
        .filter((i) => i.name && i.closest('[class*=ques]'))
        .map((i) => [i.name, Number(i.closest('[data-id]')?.dataset.id || i.closest('[qtid]')?.getAttribute('qtid') || 0)])
    )
  );
  const resolveType = (t) => {
    if (t.typeId) return { id: Number(t.typeId), name: t.name || QT_NAME[t.typeId] || String(t.typeId) };
    const id = typeMap[t.name] || Number(Object.entries(QT_NAME).find(([, n]) => n === t.name)?.[0]);
    if (!id) throw new Error(`未知题型「${t.name}」。当前学科题型：${Object.keys(typeMap).join('、')}`);
    return { id, name: t.name };
  };
  const tpl = quesTypes.map((t) => {
    const r = resolveType(t);
    return { qtId: r.id, qtName: r.name, c: t.count, unlimited: t.count };
  });
  const total = tpl.reduce((a, b) => a + b.c, 0);
  if (total > 100) throw new Error('题目总数不能超过 100');
  const ids = nodeIds.map(Number);
  // 难度：difficulty 为 1/2/3（容易/适中/困难）或 {min,max} 区间
  const hard = difficulty && typeof difficulty === 'object' ? { paperHard: '2', diffMin: difficulty.min, diffMax: difficulty.max } : { paperHard: '1', diffMin: 0, diffMax: 1 };
  const obj = {
    cids: ids,
    categoryIds: ids.map((id) => ({ id, treeType })),
    diffId: typeof difficulty === 'number' ? difficulty : 0,
    quesTypeTemplates: tpl,
    areaId,
    sceneId: scene,
    ...hard,
    formerYears: String(years),
  };
  await page.evaluate((o) => {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = '/zhineng-view/';
    f.target = '_self';
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = 'param';
    i.value = btoa(encodeURIComponent(JSON.stringify(o)));
    f.appendChild(i);
    document.body.appendChild(f);
    f.submit();
  }, obj);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);
  const { listQuestions } = await import('./zujuan.js');
  const res = await listQuestions({});
  return { request: { nodeIds: ids, quesTypes: tpl.map((t) => `${t.qtName}×${t.c}`) }, ...res };
}

/** 智能组卷预览页：全部加入试题篮（点击页面上的按钮） */
export async function smartPaperAddAll() {
  const page = await browser.ensure();
  if (!/zhineng-view/.test(page.url())) throw new Error('当前不是智能组卷预览页，请先调用 zujuan_smart_paper。');
  const count = () => page.evaluate(() => ZujuanCom.QuestionBasketModule.questionBasketManager.findAllQuestionIds().length);
  const before = await count();
  page.__dialogs.length = 0;
  await page.locator('a.add-all-btn').first().click({ force: true });
  await page.waitForTimeout(2500);
  return { basketBefore: before, basketAfter: await count(), dialogs: page.__dialogs.slice() };
}

/** 智能组卷预览页：对某题「智能换题」，返回换题后的题目列表 */
export async function smartPaperSwitch(quesId) {
  const page = await browser.ensure();
  if (!/zhineng-view/.test(page.url())) throw new Error('当前不是智能组卷预览页，请先调用 zujuan_smart_paper。');
  const btn = page.locator(`a.smart-switch[data-id="${quesId}"]`).first();
  if (!(await btn.count())) throw new Error(`预览中没有试题 ${quesId}`);
  page.__dialogs.length = 0;
  await btn.click({ force: true });
  await page.waitForTimeout(3000);
  const { listQuestions } = await import('./zujuan.js');
  const r = await listQuestions({});
  return { replaced: quesId, stillPresent: r.questions.some((q) => q.id === String(quesId)), dialogs: page.__dialogs.slice(), questions: r.questions };
}

// ───────────────────────── 细目表组卷 ─────────────────────────

/**
 * 细目表组卷：逐题指定题型、知识点（或章节）、难度、分值，由站点「生成试卷」一键选题。
 * items: [{ type:'单选题'|typeId, knowledgeIds:[id...], difficulty?:'容易'|'适中'|'困难', score?:5 }]
 */
export async function specTablePaper({ subject, title, items, by = 'knowledge', priority = 'new', provinceId = -1, addToBasket = false }) {
  const s = resolveSubject(subject || 'gzsx');
  await setSubject(s.code, { open: false });
  const page = await browser.goto('/basic/', { waitMs: 2500 });
  // 题型 id：从当前学科的基础数据取
  const typeMap = await page.evaluate((bankId) => {
    const out = {};
    for (const edu of window.edu || [])
      for (const b of edu.QuesBankList || [])
        if (b.ID === bankId) for (const t of b.QuesTypeList || []) out[t.Name] = t.ID;
    return out;
  }, s.bankId);
  const DIFF = { 容易: { ID: 1, Name: '容易' }, 适中: { ID: 2, Name: '适中' }, 困难: { ID: 3, Name: '困难' } };
  const treeType = by === 'chapter' ? 2 : 1;
  const groups = [];
  for (const it of items) {
    const tid = Number(it.typeId) || typeMap[it.type];
    if (!tid) throw new Error(`未知题型「${it.type}」。${s.phase}${s.name}可用题型：${Object.keys(typeMap).join('、')}`);
    const name = Object.entries(typeMap).find(([, v]) => v === tid)?.[0] || it.type;
    let g = groups.find((x) => x.ID === tid);
    if (!g) groups.push((g = { ID: tid, Name: name, QuesNum: 0, QuesList: [] }));
    if (!it.knowledgeIds?.length) throw new Error('每道题都需要 knowledgeIds（知识点或章节 id）');
    g.QuesList.push({
      ID: 0,
      QuesDif: DIFF[it.difficulty] || { ID: 0, Name: '全部' },
      ChildNum: 0,
      Category: it.knowledgeIds.map((id) => ({ ID: Number(id), Categories: '', treeType })),
      Score: [{ index: 0, score: it.score || 0 }],
      excludeQuesIds: [],
    });
    g.QuesNum++;
  }
  const PRI = { new: { ID: 1, Name: '优先最新试题' }, hot: { ID: 2, Name: '优先热门试题' }, province: { ID: 3, Name: '优先地区试题' } };
  const obj = {
    dbid: 0,
    PaperTitle: title || `${s.phase}${s.name}细目表组卷`,
    PaperType: { ID: 0, Name: '不限' },
    PriorityLevel: { ...(PRI[priority] || PRI.new), Province: { ID: priority === 'province' ? provinceId : -1, Name: '' } },
    QuestionWay: by === 'chapter' ? { ID: 2, Name: '按教材章节命题', Content: '' } : { ID: 1, Name: '按知识点命题', Content: '' },
    TotalScore: items.reduce((a, b) => a + (b.score || 0), 0),
    QuesTypeList: groups,
  };
  const res = await api('/zujuan-api/one_key_ques', { jsonObj: JSON.stringify(obj), type: 0, quesIds: '', courseType: 0, courseId: 0 });
  if (!res || typeof res !== 'object') throw new Error('一键选题失败：' + JSON.stringify(res).slice(0, 200));
  const picked = (res.QuesTypeList || []).flatMap((g) =>
    (g.QuesList || []).map((q) => ({ type: g.Name, id: q.ID ? String(q.ID) : null, difficulty: q.QuesDif?.Name, score: q.Score?.[0]?.score }))
  );
  const missing = picked.filter((q) => !q.id).length;
  let basket;
  if (addToBasket) {
    const { addToBasket: add } = await import('./zujuan.js');
    basket = await add(picked.filter((q) => q.id).map((q) => q.id));
  }
  return {
    title: obj.PaperTitle,
    picked,
    note: missing ? `${missing} 道题没有找到符合条件的试题，可放宽难度或换知识点` : undefined,
    basket,
    hint: addToBasket ? '已加入试题篮，可用 zujuan_basket_to_paper 生成试卷' : '用 zujuan_get_question 查看题目，或设置 addToBasket=true 直接加入试题篮',
  };
}
