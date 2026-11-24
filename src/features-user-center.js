// 个人中心：下载/存档/收藏试卷、消息
import { api } from './features-core.js';

export async function downloadHistory({ days = 90, page = 1, pageSize = 10 } = {}) {
  const r = await api('/zujuan-api/user_paper/download_paged', { days, pageIndex: page, pageSize, startTimeStr: '', endTimeStr: '' });
  return {
    total: r.total,
    list: (r.list || []).map((x) => ({
      id: x.id,
      date: x.createTimeOn,
      name: x.paperName,
      questionCount: x.quesCount,
      format: x.wordVersion,
      paperType: x.paperType,
      bankId: x.bankId,
      filePath: x.paperUrl || undefined, // 用 zujuan_redownload 下载
    })),
  };
}

export async function archives({ days = 365, page = 1, pageSize = 10 } = {}) {
  const r = await api('/zujuan-api/user_paper/archives_paged', { days, pageIndex: page, pageSize, startTimeStr: '', endTimeStr: '', type: 1, folderId: 0 });
  return r;
}

export async function favoritePapers({ page = 1, pageSize = 10 } = {}) {
  return api('/zujuan-api/user_paper/collect_paged', { pageIndex: page, pageSize });
}

export async function recentFavoriteQuestions() {
  const r = await api('/zujuan-api/usertk/collect_ques', {}, 'GET');
  if (r?.code !== 200) return { list: [], note: '最近没有收藏的试题' };
  return { html: undefined, text: String(r.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000) };
}

export async function messages() {
  const count = await api('/zujuan-api/message/message_count', {});
  const unread = await api('/zujuan-api/message/no_read_messages', {});
  return { count, latestUnread: unread };
}

// ───────────────────────── 收藏 ─────────────────────────

export async function favoriteQuestion(quesId, bankId, on = true) {
  const bid = bankId || 11;
  const r = on
    ? await api('/zujuan-api/usertk/question/collect', { quesId, bankId: bid })
    : await api('/zujuan-api/usertk/del-question', { bankId: bid, questionId: quesId }, 'GET');
  return { quesId, favorited: on, result: r };
}

export async function favoritePaper({ paperId, bankId, name, questionCount, on = true }) {
  const bid = bankId || 11;
  const data = { bankid: bid, paperid: paperId, paperName: name || '', quesCount: questionCount || 0, sourceType: 1, collectType: 0 };
  const r = await api(on ? '/zujuan-api/usertk/user_collect_paper' : '/zujuan-api/usertk/paper_cancel_collect', data);
  return { paperId, favorited: on, result: r };
}

/** 个人题库中收藏的试题 */
