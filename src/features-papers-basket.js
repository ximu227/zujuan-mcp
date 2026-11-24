// 试卷篮 / 试卷汇编
import { browser } from './browser.js';
import { resolveSubject } from './zujuan.js';
import { api, useSubject } from './features-core.js';

export async function paperBasketAdd(paperIds, bankId, subject) {
  const s = await useSubject(subject);
  bankId = bankId || s?.bankId;
  const out = [];
  for (const id of paperIds) {
    await api('/zujuan-api/add_paper_basket', { paperId: id, bankId: bankId || 11 });
    out.push(id);
  }
  return { added: out, tree: await paperBasketTree() };
}

export async function paperBasketRemove(paperIds, bankId, subject) {
  const s = await useSubject(subject);
  bankId = bankId || s?.bankId;
  for (const id of paperIds) await api('/zujuan-api/delete_basket', { paperId: id, bankId: bankId || 11 });
  return { removed: paperIds, tree: await paperBasketTree() };
}

export async function paperBasketClear(bankId, subject) {
  const s = await useSubject(subject);
  bankId = bankId || s?.bankId;
  await api('/zujuan-api/delete_basket', { paperId: 0, bankId: bankId || 11 });
  return { cleared: true };
}

/** 试卷篮中所有试卷的试题，按知识点汇总成的树（试卷汇编左侧目录） */
export async function paperBasketTree(subject, filter) {
  await useSubject(subject);
  const list = await api('/zujuan-api/get_paper_basket_tree', {}, 'GET');
  if (!Array.isArray(list) || !list.length) return { empty: true, nodes: [] };
  if (filter) {
    // 关键字可用 | 分隔多个，返回匹配节点及其路径
    const keys = String(filter).split(/[|｜,，\s]+/).filter(Boolean);
    const byId = Object.fromEntries(list.map((n) => [n.id, n]));
    const pathOf = (n) => {
      const names = [];
      for (let p = byId[n.parentId]; p; p = byId[p.parentId]) names.unshift(p.name);
      return names.join(' > ');
    };
    const hits = list.filter((n) => keys.some((k) => n.name.includes(k)));
    return {
      empty: false,
      count: list.length,
      matched: hits.length,
      tree: hits.map((n) => `- ${n.name}（${n.childNum}题） id=${n.id}    [${pathOf(n)}]`).join('\n') || '（没有匹配的知识点）',
    };
  }
  const byParent = {};
  list.forEach((n) => (byParent[n.parentId] ||= []).push(n));
  const lines = [];
  const walk = (pid, depth) =>
    (byParent[pid] || []).forEach((n) => {
      lines.push(`${'  '.repeat(depth)}- ${n.name}（${n.childNum}题） id=${n.id}`);
      walk(n.id, depth + 1);
    });
  walk(0, 0);
  return { empty: false, count: list.length, tree: lines.join('\n') };
}

/** 打开试卷汇编页（可指定知识点 id），返回汇总后的试题列表 */
export async function openCompilation({ subject, knowledgeId } = {}) {
  const s = (await useSubject(subject)) || resolveSubject('gzsx');
  const url = knowledgeId ? `/${s.code}/hb${knowledgeId}/` : '/huibian/';
  await browser.goto(url, { waitMs: 3500 });
  const { listQuestions } = await import('./zujuan.js');
  return listQuestions({});
}

// ───────────────────────── 智能组卷 ─────────────────────────

