export const SUBJECTS = [
  { phase: '小学', name: '语文', bankId: 24, code: 'xxyw' },
  { phase: '小学', name: '数学', bankId: 23, code: 'xxsx' },
  { phase: '小学', name: '英语', bankId: 25, code: 'xxyy' },
  { phase: '小学', name: '科学', bankId: 32, code: 'xxkx' },
  { phase: '小学', name: '道德与法治', bankId: 31, code: 'xxzz' },
  { phase: '初中', name: '语文', bankId: 1, code: 'czyw' },
  { phase: '初中', name: '数学', bankId: 2, code: 'czsx' },
  { phase: '初中', name: '英语', bankId: 3, code: 'czyy' },
  { phase: '初中', name: '物理', bankId: 4, code: 'czwl' },
  { phase: '初中', name: '化学', bankId: 5, code: 'czhx' },
  { phase: '初中', name: '生物', bankId: 6, code: 'czsw' },
  { phase: '初中', name: '地理', bankId: 9, code: 'czdl' },
  { phase: '初中', name: '历史', bankId: 8, code: 'czls' },
  { phase: '初中', name: '科学', bankId: 26, code: 'czkx' },
  { phase: '初中', name: '道德与法治', bankId: 7, code: 'czzz' },
  { phase: '初中', name: '历史与社会', bankId: 30, code: 'czlsysh' },
  { phase: '初中', name: '信息科技', bankId: 29, code: 'czxxjs' },
  { phase: '高中', name: '语文', bankId: 10, code: 'gzyw' },
  { phase: '高中', name: '数学', bankId: 11, code: 'gzsx' },
  { phase: '高中', name: '英语', bankId: 12, code: 'gzyy' },
  { phase: '高中', name: '物理', bankId: 13, code: 'gzwl' },
  { phase: '高中', name: '化学', bankId: 14, code: 'gzhx' },
  { phase: '高中', name: '生物', bankId: 15, code: 'gzsw' },
  { phase: '高中', name: '政治', bankId: 16, code: 'gzzz' },
  { phase: '高中', name: '历史', bankId: 17, code: 'gzls' },
  { phase: '高中', name: '地理', bankId: 18, code: 'gzdl' },
  { phase: '高中', name: '信息技术', bankId: 27, code: 'gzxxjs' },
  { phase: '高中', name: '通用技术', bankId: 28, code: 'gztyjs' },
  { phase: '高中', name: '日语', bankId: 33, code: 'gzry' },
  { phase: '中职', name: '语文', bankId: 41, code: 'zzyw' },
  { phase: '中职', name: '数学', bankId: 42, code: 'zzsx' },
  { phase: '中职', name: '英语', bankId: 43, code: 'zzyy' },
];

export function resolveSubject(s) {
  const key = String(s).trim();
  const hit =
    SUBJECTS.find((x) => x.code === key || String(x.bankId) === key) ||
    SUBJECTS.find((x) => x.phase + x.name === key || x.phase.slice(0, 1) + x.name === key) ||
    SUBJECTS.find((x) => key.includes(x.phase.slice(0, 1)) && key.includes(x.name));
  if (!hit) throw new Error(`未知学科：${s}。可用 zujuan_list_subjects 查看学科代码（如 gzsx=高中数学）。`);
  return hit;
}
