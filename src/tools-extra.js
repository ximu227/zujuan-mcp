// 扩展工具注册：试卷选题、试卷汇编、智能组卷、组卷中心编辑、个人中心、收藏、相似题、专辑等
import { z } from 'zod';
import * as ft from './features.js';
import * as ct from './center.js';

const id = z.union([z.string(), z.number()]).transform(String);
const ids = z.array(z.union([z.string(), z.number()])).min(1);

export function registerExtraTools(tool, json, text) {
  // ───────────── 试卷选题 ─────────────
  tool(
    'zujuan_list_papers',
    '试卷选题：浏览整套试卷列表（同步教学 tbjx / 阶段测试 jdcs：月考期中期末专题开学考 / 备考 bk：高考中考模拟、真题、学业考试、一二三轮复习）。返回试卷 id、名称、年级、年份、地区、题量、是否在试卷篮。可叠加筛选、翻页。',
    {
      subject: z.string().optional().describe('学科代码或名称，默认 gzsx（高中数学）'),
      section: z.enum(['tbjx', 'jdcs', 'bk']).optional().describe('tbjx=同步教学, jdcs=阶段测试(默认), bk=备考'),
      url: z.string().optional().describe('直接打开某个试卷列表地址（如筛选后的 URL 或 /gzsx/shijuan/bk/t12 高考真题）'),
      filters: z
        .array(z.object({ group: z.string(), option: z.string() }))
        .optional()
        .describe('依次应用的筛选，如 [{group:"年份",option:"2025"},{group:"地区",option:"吉林"},{group:"城市",option:"长春市"},{group:"类别/章节",option:"期末"}]。选了省份后才会出现「城市」分组'),
      page: z.number().int().min(1).optional(),
    },
    async (a) => json(await ft.listPapers(a))
  );

  tool('zujuan_get_paper_filters', '列出当前试卷列表页可用的筛选项（类别/章节、年级学期、年份、试卷等级、难度、地区、城市、排序等），当前选中项用 [ ] 标出。选中省份后会出现「城市」分组。', {}, async () =>
    json(await ft.getPaperFilters())
  );

  tool(
    'zujuan_search_schools',
    '按名称搜索学校（试卷列表可按学校筛选，选中后用 zujuan_list_papers 的 url 参数加 ?schoolId= 打开）。',
    { keyword: z.string().min(1) },
    async ({ keyword }) => json(await ft.searchSchools(keyword))
  );

  tool(
    'zujuan_get_paper_detail',
    '打开整套试卷详情：标题、地区/年级/类型、各大题下的试题（id、题型、难度、题干）、试卷分析（整体难度、考查范围）。',
    { paperId: id, bankId: z.number().int().optional().describe('学科 bankId，默认 11（高中数学）') },
    async ({ paperId, bankId }) => json(await ft.getPaperDetail(paperId, bankId))
  );

  tool(
    'zujuan_add_paper_questions_to_basket',
    '把整套试卷的全部试题一次性加入试题篮（相当于逐题点「加入试题篮」）。',
    { paperId: id, bankId: z.number().int().optional() },
    async ({ paperId, bankId }) => json(await ft.addPaperToBasket(paperId, bankId))
  );

  tool(
    'zujuan_favorite_paper',
    '收藏 / 取消收藏整套试卷（收藏的试卷进入个人题库）。',
    {
      paperId: id,
      bankId: z.number().int().optional(),
      name: z.string().describe('试卷名称（站点要求）'),
      questionCount: z.number().int().describe('试卷题量（站点要求）'),
      favorite: z.boolean().optional().describe('true=收藏(默认)，false=取消收藏'),
    },
    async (a) => json(await ft.favoritePaper({ ...a, on: a.favorite !== false }))
  );

  // ───────────── 试卷篮 / 试卷汇编 ─────────────
  tool(
    'zujuan_paper_basket_add',
    '试卷汇编第 1 步：把整套试卷加入「试卷篮」（最多 30 套）。之后用 zujuan_paper_basket_tree 查看汇总后的知识点目录，用 zujuan_open_compilation 打开汇编结果。',
    { paperIds: ids, bankId: z.number().int().optional(), subject: z.string().optional().describe('学科代码或名称，如 gzsx/高中数学；不传则用当前学科'), },
    async ({ paperIds, bankId, subject }) => json(await ft.paperBasketAdd(paperIds.map(String), bankId, subject))
  );

  tool(
    'zujuan_paper_basket_remove',
    '从试卷篮移出试卷。',
    { paperIds: ids, bankId: z.number().int().optional(), subject: z.string().optional().describe('学科代码或名称，如 gzsx/高中数学；不传则用当前学科'), },
    async ({ paperIds, bankId, subject }) => json(await ft.paperBasketRemove(paperIds.map(String), bankId, subject))
  );

  tool('zujuan_paper_basket_clear', '清空某学科的试卷篮（只影响该学科）。', { bankId: z.number().int().optional(), subject: z.string().optional().describe('学科代码或名称，如 gzsx/高中数学；不传则用当前学科'), }, async ({ bankId, subject }) =>
    json(await ft.paperBasketClear(bankId, subject))
  );

  tool(
    'zujuan_paper_basket_tree',
    '试卷汇编：试卷篮中所有试卷的试题按知识点汇总后的目录树（每个节点含题数和知识点 id）。可用 filter 按关键字查找知识点。',
    {
      subject: z.string().optional().describe('学科代码或名称，如 gzsx/高中数学；不传则用当前学科'),
      filter: z.string().optional().describe('只看名称包含关键字的知识点，多个用 | 分隔，如 "网格|格点|作图"'),
    },
    async ({ subject, filter }) => {
      const r = await ft.paperBasketTree(subject, filter);
      if (r.empty) return text('试卷篮是空的。先用 zujuan_paper_basket_add 加入试卷。');
      return text(filter ? `共 ${r.count} 个知识点节点，匹配 ${r.matched} 个\n${r.tree}` : `共 ${r.count} 个知识点节点\n${r.tree}`);
    }
  );

  tool(
    'zujuan_open_compilation',
    '打开「试卷汇编」页面：把试卷篮中各试卷的试题按知识点汇总展示。可指定知识点 id（来自 zujuan_paper_basket_tree）只看该知识点；之后可用 zujuan_apply_filter（题型/难度/年份/地区等）、zujuan_list_questions 翻页、zujuan_add_to_basket 选题。',
    { subject: z.string().optional(), knowledgeId: z.union([z.string(), z.number()]).optional() },
    async (a) => json(await ft.openCompilation(a))
  );

  // ───────────── 智能组卷 ─────────────
  tool(
    'zujuan_smart_paper',
    '智能组卷：选择章节或知识点范围，设定各题型数量，自动生成一套试卷并返回预览中的试题。节点 id 来自 zujuan_get_catalog（章节 URL 中 zj 后的数字，或知识点 zsd 后的数字）。生成后可用 zujuan_smart_paper_add_all 全部加入试题篮。',
    {
      subject: z.string().optional(),
      nodeIds: z.array(z.union([z.string(), z.number()])).min(1).describe('章节或知识点 id 列表'),
      treeType: z.number().int().optional().describe('2=章节(默认)，1=知识点'),
      quesTypes: z
        .array(z.object({ name: z.string().optional(), typeId: z.number().int().optional(), count: z.number().int().min(1) }))
        .min(1)
        .describe('各题型数量，如 [{name:"单选题",count:8},{name:"填空题",count:4},{name:"解答题",count:6}]'),
      scene: z.number().int().optional().describe('使用场景：0=课时练习(默认) 1=阶段测试 2=高考备考'),
      areaId: z.number().int().optional().describe('地区 id，0=全部(默认)，1=全国，110000=北京 等'),
      years: z.number().int().optional().describe('试题年份：0=全部 3=近3年 5=近5年'),
      difficulty: z
        .union([z.number().int(), z.object({ min: z.number(), max: z.number() })])
        .optional()
        .describe('难度：1=容易 2=适中 3=困难，或难度系数区间 {min:0.5,max:0.8}'),
    },
    async (a) => json(await ft.smartPaper(a))
  );

  tool('zujuan_smart_paper_add_all', '把智能组卷预览中的全部试题加入试题篮。', {}, async () => json(await ft.smartPaperAddAll()));

  tool(
    'zujuan_smart_paper_switch',
    '智能组卷预览页「智能换题」：把某道题换成同知识点、同题型、同难度的另一道题。',
    { id },
    async ({ id }) => json(await ft.smartPaperSwitch(id))
  );

  tool(
    'zujuan_spec_table_paper',
    '细目表组卷：逐题指定题型、考查知识点（或教材章节）、难度、分值，由站点一键选题，返回每题选中的试题 id；addToBasket=true 时直接加入试题篮。知识点 id 来自 zujuan_get_catalog（zsd 后的数字），章节 id 为 zj 后的数字。',
    {
      subject: z.string().optional(),
      title: z.string().optional(),
      by: z.enum(['knowledge', 'chapter']).optional().describe('knowledge=按知识点命题(默认)，chapter=按教材章节命题'),
      priority: z.enum(['new', 'hot', 'province']).optional().describe('选题优先：new=最新(默认) hot=最热 province=地区'),
      provinceId: z.number().int().optional().describe('priority=province 时的地区 id，如 220000=吉林'),
      addToBasket: z.boolean().optional().describe('选好后直接加入试题篮'),
      items: z
        .array(
          z.object({
            type: z.string().optional().describe('题型名称，如 单选题'),
            typeId: z.number().int().optional(),
            knowledgeIds: z.array(z.union([z.string(), z.number()])).min(1),
            difficulty: z.enum(['容易', '适中', '困难']).optional(),
            score: z.number().optional(),
          })
        )
        .min(1)
        .describe('每一项是一道题'),
    },
    async (a) => json(await ft.specTablePaper(a))
  );

  // ───────────── 组卷中心编辑 ─────────────
  tool('zujuan_paper_structure', '读取组卷中心试卷的完整结构：标题、模板、题量、总分、各卷/题型下的试题 id、分值、难度、来源。', { subject: z.string().optional().describe('学科代码或名称（试题篮/组卷中心按学科分开）；不传则用当前学科') }, async ({ subject }) =>
    json(await ct.paperStructure(subject))
  );

  tool(
    'zujuan_paper_set_title',
    '修改组卷中心试卷的主标题 / 副标题。',
    { title: z.string().optional(), subtitle: z.string().optional() },
    async (a) => json(await ct.setTitle(a))
  );

  tool(
    'zujuan_paper_set_template',
    '设置试卷模板：作业 / 测试 / 考试（改变卷头：默认标题、分卷、注意事项等）。注意：切换模板会把标题重置为该模板的默认标题，请在切换模板之后再调用 zujuan_paper_set_title；自定义标题后站点界面会把模板显示为「作业」，但卷头设置不受影响。',
    { template: z.enum(['作业', '测试', '考试']) },
    async ({ template }) => json(await ct.setTemplate(template))
  );

  tool(
    'zujuan_paper_set_order',
    '设置试卷分组与排序：按题型 / 按知识点 / 按加入顺序；easyToHard=true 时组内由易到难。',
    { groupBy: z.enum(['题型', '知识点', '加入顺序']), easyToHard: z.boolean().optional() },
    async (a) => json(await ct.setOrder(a))
  );

  tool(
    'zujuan_paper_set_scores',
    '设置试题分值。传 {试题id: 分值}，如 {"36445148": 5, "29677732": 6}。',
    { scores: z.record(z.string(), z.union([z.number(), z.string()])) },
    async ({ scores }) => json(await ct.setScores(scores))
  );

  tool(
    'zujuan_paper_question_action',
    '组卷中心内对单题操作：up=上移，down=下移，delete=从试卷删除。',
    { id, action: z.enum(['up', 'down', 'delete']) },
    async ({ id, action }) => json(await ct.questionAction(id, action))
  );

  tool(
    'zujuan_paper_switch_question',
    '组卷中心「换题」：不传 newId 时列出可替换的同类候选题；传 newId 则替换成该题。',
    { id, newId: z.union([z.string(), z.number()]).optional() },
    async ({ id, newId }) => json(await ct.switchQuestion(id, newId ? String(newId) : undefined))
  );

  tool('zujuan_paper_analysis', '组卷中心「试卷分析」：整体难度、考查范围、题型分布、难度分布、细目表、知识点分析。', {}, async () =>
    text(await ct.paperAnalysis())
  );

  tool(
    'zujuan_save_paper',
    '组卷中心「保存试卷」：保存到「我的-试卷存档」，之后可在存档中继续编辑或下载。',
    { name: z.string().optional().describe('存档名称，默认使用试卷标题') },
    async ({ name }) => json(await ct.savePaper(name))
  );

  tool(
    'zujuan_share_paper',
    '组卷中心「分享试卷」：为当前试卷生成电脑端链接、手机端链接（及二维码）。',
    {},
    async () => json(await ft.shareCurrentPaper())
  );

  tool(
    'zujuan_answer_sheet',
    '组卷中心答题卡：kind=download 打开「下载答题卡」，配套 browser_snapshot / browser_click 选择样式，browser_wait_for_download 下载。',
    { kind: z.enum(['download', 'make']).optional() },
    async ({ kind }) => json(await ct.answerSheet(kind))
  );

  // ───────────── 试题相关 ─────────────
  tool(
    'zujuan_similar_questions',
    '查找某道题的相似题（站点「相似题」功能），返回候选题 id 和题干。',
    { id, bankId: z.number().int().optional() },
    async ({ id, bankId }) => json(await ft.similarQuestions(id, bankId))
  );

  tool(
    'zujuan_knowledge_explain',
    '知识点解读（站点「解读」按钮，需要会员）。cid/cname 来自试题详情的知识点。',
    { cid: z.union([z.string(), z.number()]), cname: z.string().optional(), bankId: z.number().int().optional() },
    async ({ cid, cname, bankId }) => text(await ft.knowledgeExplain(cid, cname, bankId))
  );

  tool(
    'zujuan_favorite_question',
    '收藏 / 取消收藏试题（收藏的试题进入个人题库）。',
    { id, bankId: z.number().int().optional(), favorite: z.boolean().optional().describe('true=收藏(默认)，false=取消') },
    async ({ id, bankId, favorite }) => json(await ft.favoriteQuestion(id, bankId, favorite !== false))
  );

  // ───────────── 个人中心 ─────────────
  tool(
    'zujuan_download_history',
    '我的-下载记录：最近下载过的试卷（名称、日期、题量、格式、文件地址）。',
    { days: z.number().int().optional().describe('最近多少天，默认 90'), page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.downloadHistory(a))
  );

  tool(
    'zujuan_archives',
    '我的-试卷存档：保存过的试卷。',
    { days: z.number().int().optional().describe('最近多少天，默认 365'), page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.archives(a))
  );

  tool(
    'zujuan_favorite_papers',
    '我的-收藏的试卷。',
    { page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.favoritePapers(a))
  );

  tool(
    'zujuan_personal_questions',
    '个人题库：收藏的试题，可按关键字、题型、难度筛选。',
    {
      bankId: z.number().int().optional(),
      keyword: z.string().optional(),
      page: z.number().int().optional(),
      quesType: z.number().int().optional().describe('题型 id，如 2701=单选题'),
      quesDiff: z.number().int().optional().describe('1=容易 2=较易 3=适中 4=较难 5=困难'),
    },
    async (a) => json(await ft.personalQuestions(a))
  );

  tool(
    'zujuan_load_paper_to_center',
    '把「试卷存档」或「下载记录」中的试卷载入组卷中心继续编辑（相当于其「编辑」按钮）。组卷中心已有试题时需 overwrite=true 才会覆盖。',
    {
      kind: z.enum(['archive', 'download']).optional().describe('archive=试卷存档(默认)，download=下载记录'),
      id: z.union([z.string(), z.number()]).describe('zujuan_archives / zujuan_download_history 返回的 id'),
      overwrite: z.boolean().optional(),
    },
    async (a) => json(await ft.loadPaperToCenter(a))
  );

  tool('zujuan_delete_archive', '删除一条试卷存档。', { id }, async ({ id }) => json(await ft.deleteArchive(id)));

  tool('zujuan_delete_download_record', '删除一条下载记录。', { id }, async ({ id }) => json(await ft.deleteDownloadRecord(id)));

  tool(
    'zujuan_redownload',
    '重新下载「下载记录」中的试卷文件到本地下载目录（不重新生成、不占下载次数）。',
    { id },
    async ({ id }) => json(await ft.redownload(id))
  );

  tool(
    'zujuan_ques_use_history',
    '我的-选题记录：最近用过（加入试题篮/组卷/下载）的试题。',
    { days: z.number().int().optional().describe('默认 15'), page: z.number().int().optional(), pageSize: z.number().int().optional() },
    async (a) => json(await ft.quesUseHistory(a))
  );

  tool('zujuan_read_all_messages', '把站内消息全部标为已读。', {}, async () => json(await ft.readAllMessages()));

  tool('zujuan_messages', '站内消息：未读数量和最新一条未读消息。', {}, async () => json(await ft.messages()));

  // ───────────── 专辑 / 上好课 ─────────────
  tool(
    'zujuan_list_topics',
    '精品专辑：按学科浏览或按关键字搜索专辑（如 "真题汇编"、"高频考点"、"期末复习"）。',
    {
      subject: z.string().optional(),
      keyword: z.string().optional(),
      url: z.string().optional().describe('直接打开专辑列表的筛选地址（filters 中的 href）'),
      page: z.number().int().min(1).optional(),
    },
    async (a) => json(await ft.listTopics(a))
  );

  tool(
    'zujuan_topic_detail',
    '打开专辑详情：专辑信息、同系列子专辑、目录（各专题 URL），以及当前专题下的试题。打开某个专题 URL 可读其试题；试题可用 zujuan_add_to_basket 加入试题篮。',
    { url: z.string().describe('专辑地址，如 /thematiclist/11pt8544ct26504.html') },
    async ({ url }) => json(await ft.topicDetail(url))
  );

  tool(
    'zujuan_good_lessons',
    '上好课（同步备课）：打开学科的上好课页面并列出资源。',
    { subject: z.string().optional() },
    async (a) => json(await ft.goodLessons(a))
  );

  // ───────────── 底层 ─────────────
  tool(
    'zujuan_api',
    '高级：在已登录的组卷网页面内直接调用站内接口（/zujuan-api/...），用于专用工具没有覆盖的功能。method 默认 POST（表单格式）。',
    {
      path: z.string().regex(/^\/(zujuan-api|dialog)\//).describe('接口路径，如 /zujuan-api/user_paper/download_paged'),
      data: z.record(z.string(), z.any()).optional(),
      method: z.enum(['GET', 'POST']).optional(),
    },
    async ({ path, data, method }) => {
      const r = await ft.api(path, data || {}, method || 'POST');
      const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
      return text(s.length > 30000 ? s.slice(0, 30000) + '\n…(已截断)' : s);
    }
  );
}
