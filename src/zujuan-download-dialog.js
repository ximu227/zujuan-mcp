import { browser, saveDownload } from './browser.js';
import fs from 'node:fs';
import { assertNotLogin, setSubject } from './zujuan-core.js';
import { fillDownloadOptions, CAPTCHA_VISIBLE } from './zujuan-download-options.js';


export async function openDownloadDialog({ source = 'center', paperId, bankId, url } = {}) {
  let page, count, trigger;
  if (source === 'paper') {
    if (!paperId) throw new Error('source=paper 需要 paperId');
    page = await browser.goto(`/${bankId || 11}p${paperId}.html`, { waitMs: 2500 });
    assertNotLogin(page);
    count = await page.locator('.tk-quest-item.quesroot').count();
    trigger = page.locator('.btnTestDown, [data-btn-type="paperDownload"]').first();
  } else if (source === 'topic') {
    if (!url) throw new Error('source=topic 需要专辑地址 url');
    page = await browser.goto(url, { waitMs: 2500 });
    assertNotLogin(page);
    count = await page.locator('.tk-quest-item.quesroot').count();
    trigger = page.locator('[data-btn-type="topicDownload"], .download-exam').first();
  } else {
    page = await browser.goto('/zujuan/', { waitMs: 2500 });
    assertNotLogin(page);
    count = await page.evaluate(() => window.ZujuanCom?.Paper?.GetQuesIDList()?.length || 0);
    if (!count) throw new Error('组卷中心的试卷是空的。请先用 zujuan_basket_to_paper 把试题送入组卷中心。');
    // 题多时试题要分批加载，加载完之前下载按钮不响应
    await page
      .waitForFunction(() => !document.querySelector('.ques-item .init-msg') && document.querySelectorAll('.ques-item').length > 0, null, { timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    trigger = page.locator('a.download-btn').first();
  }
  if (!(await trigger.count())) throw new Error('页面上没有找到下载按钮（可能没有下载权限）');
  page.__dialogs.length = 0;
  await trigger.click({ force: true });
  let frame;
  for (let i = 0; i < 60 && !frame; i++) {
    await page.waitForTimeout(500);
    frame = page.frames().find((f) => /\/dialog\/(downloadword|download_topic_word)/.test(f.url()));
    if (i === 20 && !frame) await trigger.click({ force: true }).catch(() => {}); // 10 秒没反应再点一次
  }
  if (!frame) {
    const msg = page.__dialogs.map((d) => d.message).join('; ') ||
      (await page.evaluate(() => [...document.querySelectorAll('.tk-dialog, .ife-modal')].map((d) => d.innerText.trim()).join(' ').slice(0, 300)).catch(() => ''));
    throw new Error('下载对话框没有出现。' + (msg || ''));
  }
  await frame.waitForSelector('a.confirm-btn', { timeout: 15000 });
  return { page, frame, count };
}

export async function downloadPaper(o = {}) {
  if (o.subject) await setSubject(o.subject);
  const timeoutSec = o.timeoutSec || 180;
  const attempt = async () => {
    const { page, frame, count } = await openDownloadDialog(o);
    const settings = await fillDownloadOptions(frame, o);
    const dl = browser.context.waitForEvent('download', { timeout: timeoutSec * 1000 });
    dl.catch(() => {});
    await frame.locator('a.confirm-btn').first().click();
    return { page, frame, count, settings, dl };
  };
  let r = await attempt();
  let download = await Promise.race([r.dl.catch(() => null), new Promise((res) => setTimeout(() => res(null), 6000))]);
  let captcha = false;
  if (!download) {
    const checks = await Promise.all([
      r.page.evaluate(CAPTCHA_VISIBLE).catch(() => false),
      r.frame.evaluate(CAPTCHA_VISIBLE).catch(() => false),
    ]);
    captcha = checks.some(Boolean);
    if (captcha && browser.headless) {
      // 无头模式下用户看不到验证码：切到可见窗口重新发起
      await browser.restart(false);
      r = await attempt();
    }
    if (captcha) await r.page.bringToFront().catch(() => {});
    download = await r.dl.catch(() => null);
  }
  if (!download) {
    const msg = await r.frame
      .evaluate(() => document.querySelector('.status-box:not([hidden]), .error-msg')?.innerText.trim())
      .catch(() => '');
    throw new Error(
      captcha
        ? `等待 ${timeoutSec} 秒仍未完成滑块验证/下载。请在弹出的浏览器窗口中拖动滑块完成验证后重试。`
        : `下载没有开始。${msg || ''}`
    );
  }
  const file = await saveDownload(download, { timeoutSec: Math.max(60, timeoutSec) });
  return { saved: file, size: fs.statSync(file).size, questionCount: r.count, settings: r.settings, captchaSolvedByUser: captcha };
}
