// 存档/下载记录编辑、重新下载、消息已读
import { browser } from './browser.js';
import { api, sitePage } from './features-core.js';

// ───────────────────────── 存档 / 下载记录：编辑、删除 ─────────────────────────

/**
 * 把存档或下载记录中的试卷载入组卷中心继续编辑（会覆盖组卷中心当前内容）。
 * kind: archive=试卷存档（zujuan_archives 的 id）  download=下载记录（zujuan_download_history 的 id）
 */
export async function loadPaperToCenter({ kind = 'archive', id, overwrite = false }) {
  const list =
    kind === 'download'
      ? (await api('/zujuan-api/user_paper/download_paged', { days: 1095, pageIndex: 1, pageSize: 100, startTimeStr: '', endTimeStr: '' })).list
      : (await api('/zujuan-api/user_paper/archives_paged', { days: 3650, pageIndex: 1, pageSize: 100, startTimeStr: '', endTimeStr: '', type: 1, folderId: 0 })).list;
  const item = (list || []).find((x) => String(x.id) === String(id));
  if (!item) throw new Error(`在${kind === 'download' ? '下载记录' : '试卷存档'}中没有找到 id=${id}`);
  if (!item.sfId) throw new Error(`试卷 ${id} 没有可加载的存档数据`);
  const page = await sitePage();
  const current = await page.evaluate(() => window.ZujuanCom?.Paper?.QuesCount?.() || 0).catch(() => 0);
  if (current > 0 && !overwrite) {
    throw new Error(`组卷中心当前已有 ${current} 道题，载入会覆盖它们。请先用 zujuan_save_paper 保存，或传 overwrite=true 确认覆盖。`);
  }
  const r = await api('/zujuan-api/usertk/user_paper/xml', { sfId: item.sfId });
  if (!r?.result) throw new Error(r?.errorInfo || '获取存档 XML 失败');
  const xml = decodeURIComponent(r.data);
  await page.evaluate(async (xml) => {
    // 与「编辑」按钮一致：SYNC_ALL(9) 同步到服务器并写入本地
    const op = window.ZujuanCom.quesBasketOperation;
    await op.quesBasketSyncVersion(9, null, xml);
    window.ZujuanCom.Paper.SaveXml(xml);
  }, xml);
  await page.waitForTimeout(1500);
  // 与站点一致：载入后跳转组卷中心
  await browser.goto('/zujuan/', { waitMs: 3000 });
  const { paperStructure } = await import('./center.js');
  return { loaded: item.paperName, paper: await paperStructure() };
}

export async function deleteArchive(id) {
  const r = await api('/zujuan-api/user_paper/archives_del', { paperId: id });
  return { deleted: id, result: r };
}

export async function deleteDownloadRecord(id) {
  const r = await api('/zujuan-api/user_paper/download_del', { paperId: id });
  return { deleted: id, result: r };
}

/** 重新下载下载记录中的文件（直接取 paperUrl） */
export async function redownload(id) {
  const { list } = await api('/zujuan-api/user_paper/download_paged', { days: 1095, pageIndex: 1, pageSize: 100, startTimeStr: '', endTimeStr: '' });
  const item = (list || []).find((x) => String(x.id) === String(id));
  if (!item?.paperUrl) throw new Error(`下载记录中没有 id=${id} 的文件`);
  const { getDownloadDir } = await import('./browser.js');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const page = await sitePage();
  const b64 = await page.evaluate(async (p) => {
    // 下载记录的文件在 OSS 上，站点用 window.oss_url 作前缀
    const u = /^https?:/.test(p) ? p : (window.oss_url || '') + p;
    const res = await fetch(u, { credentials: /^https?:\/\/zujuan/.test(u) || !/^https?:/.test(u) ? 'include' : 'omit' });
    if (!res.ok) return { error: res.status };
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(s) };
  }, item.paperUrl);
  if (b64.error) throw new Error(`文件下载失败（HTTP ${b64.error}）`);
  const name = `${item.paperName}.${item.wordVersion || 'docx'}`.replace(/[\/:*?"<>|]/g, '_');
  const file = path.join(getDownloadDir(), name);
  fs.writeFileSync(file, Buffer.from(b64.data, 'base64'));
  return { saved: file, size: fs.statSync(file).size };
}

/** 选题记录（用过的试题） */
export async function quesUseHistory({ days = 15, page = 1, pageSize = 20 } = {}) {
  return api('/zujuan-api/user/ques_usehistory_paged', { days, pageIndex: page, pageSize });
}

export async function readAllMessages() {
  return api('/zujuan-api/message/read_all_messages', {});
}

// ───────────────────────── 细目表组卷 ─────────────────────────

/**
 * 细目表组卷：逐题指定题型、知识点（或章节）、难度、分值，由站点「生成试卷」一键选题。
 * items: [{ type:'单选题'|typeId, knowledgeIds:[id...], difficulty?:'容易'|'适中'|'困难', score?:5 }]
 */
