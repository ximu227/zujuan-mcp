import { browser, BASE_URL } from './browser.js';
import { SUBJECTS, resolveSubject } from './zujuan-subjects.js';


export async function setSubject(subject, { open = true } = {}) {
  if (!subject) return null;
  const s = resolveSubject(subject);
  await browser.ensure();
  const cur = await currentSubject();
  await browser.context.addCookies([{ name: 'bankId', value: String(s.bankId), domain: '.zujuan.xkw.com', path: '/' }]);
  if (cur?.bankId === s.bankId && !open) return s;
  const page = await browser.ensure();
  const canCall = page.url().startsWith(BASE_URL) && (await page.evaluate(() => !!window.tklib?.request).catch(() => false));
  if (canCall) {
    await page
      .evaluate(
        (id) =>
          tklib.request.post('/zujuan-api/switch-question-bank', { quesBankId: id }, { headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
        s.bankId
      )
      .catch(() => {});
  }
  if (open) await browser.goto(`/${s.code}/`, { waitMs: 1500 });
  return s;
}

export async function currentSubject() {
  await browser.ensure();
  const c = (await browser.context.cookies(BASE_URL)).find((x) => x.name === 'bankId');
  const s = SUBJECTS.find((x) => String(x.bankId) === c?.value);
  return s ? { subject: s.phase + s.name, code: s.code, bankId: s.bankId } : undefined;
}

export function isLoginUrl(url) {
  return /sso\.zxxk\.com\/login|\/login\?/.test(url);
}

export function assertNotLogin(page) {
  if (isLoginUrl(page.url())) {
    throw new Error('该操作需要登录组卷网（已跳转到登录页）。请先调用 zujuan_login 完成登录。');
  }
}

export async function getStatus() {
  let page = await browser.ensure();
  // 刚启动时是空白页，先打开首页才能判断登录状态
  if (!page.url().startsWith('http')) page = await browser.goto('/', { waitMs: 1000 });
  const url = page.url();
  const info = { url, title: await page.title().catch(() => ''), headless: browser.headless, currentSubject: await currentSubject() };
  if (url.startsWith(BASE_URL)) {
    Object.assign(
      info,
      await page
        .evaluate(() => {
          const u = window.userinfo;
          return {
            loggedIn: window.isvisitor === false,
            // 只返回必要字段，不把手机号、IP 等个人信息交给模型
            user:
              u && typeof u === 'object'
                ? {
                    userName: u.UserName,
                    groupId: u.GroupID,
                    expiryDate: u.UserRole?.ExpiryDate,
                    school: u.UserRole?.SchoolUserName,
                  }
                : undefined,
            basketCount: (document.querySelector('.quest-basket')?.innerText.match(/\d+/) || [])[0] ?? undefined,
          };
        })
        .catch(() => ({}))
    );
  }
  return info;
}

export async function openSubject(subject, mode = 'zhangjie') {
  const s = resolveSubject(subject);
  await setSubject(s.code, { open: false });
  const path = { zhangjie: '/zhangjie/', zhishidian: '/zhishidian/', home: `/${s.code}/` }[mode] || '/zhangjie/';
  const page = await browser.goto(path);
  return { subject: `${s.phase}${s.name}`, code: s.code, bankId: s.bankId, url: page.url(), title: await page.title() };
}

export async function currentBankId(page) {
  return page
    .evaluate(() => document.querySelector('.quesroot[bankid]')?.getAttribute('bankid') || window.currBankId || null)
    .catch(() => null);
}
