// 浏览器生命周期管理。
//
// 云端共享模式（设置 ZUJUAN_CDP_ENDPOINT，如 http://127.0.0.1:9222）：
//   直接连接平台常驻浏览器，不自己启动进程，复用平台网络通道。
//   只在共享浏览器中新建/关闭自己的标签页，绝不关闭整个浏览器。
// 本地 CDP 模式（默认）：启动本机 Chrome，通过远程调试端口连接，无自动化指纹。
// 本地 Playwright 模式（ZUJUAN_LAUNCH_MODE=playwright）：由 Playwright 直接启动。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const BASE_URL = 'https://zujuan.xkw.com';

const PROFILE_DIR = process.env.ZUJUAN_PROFILE_DIR || path.join(os.homedir(), '.zujuan-mcp', 'profile');
const DOWNLOAD_DIR = process.env.ZUJUAN_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads', 'zujuan');
const DEFAULT_HEADLESS = !['0', 'false', 'no'].includes(String(process.env.ZUJUAN_HEADLESS ?? '1').toLowerCase());
const LAUNCH_MODE = process.env.ZUJUAN_LAUNCH_MODE || 'cdp'; // cdp | playwright
// playwright 模式下使用：chrome | msedge | chromium
const CHANNEL = process.env.ZUJUAN_BROWSER_CHANNEL || 'chrome';
// 云端共享浏览器 CDP 端点；设置后进入共享模式
const CDP_ENDPOINT = process.env.ZUJUAN_CDP_ENDPOINT || '';
// 两次页面跳转之间的最小间隔（毫秒）。访问过快会触发站点的「滑动验证页面」
const MIN_NAV_INTERVAL_MS = Number(process.env.ZUJUAN_MIN_NAV_INTERVAL_MS || 4000);
const VERIFY_TIMEOUT_SEC = Number(process.env.ZUJUAN_VERIFY_TIMEOUT_SEC || 300);
// 容器/云主机环境：ZUJUAN_CONTAINER=1 时追加容器必需参数；ZUJUAN_EXTRA_ARGS 可再追加自定义参数（空格分隔）
const CONTAINER_ARGS = ['1', 'true', 'yes'].includes(String(process.env.ZUJUAN_CONTAINER ?? '0').toLowerCase())
  ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer']
  : [];
const EXTRA_ARGS = String(process.env.ZUJUAN_EXTRA_ARGS || '')
  .split(/\s+/)
  .filter(Boolean);
const BROWSER_ARGS = [...CONTAINER_ARGS, ...EXTRA_ARGS];

export function getDownloadDir() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  return DOWNLOAD_DIR;
}

function findChrome() {
  const env = process.env.ZUJUAN_CHROME_PATH;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    env,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean);
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('没有找到 Chrome/Edge。请安装 Chrome，或设置环境变量 ZUJUAN_CHROME_PATH 指向浏览器可执行文件。');
  return hit;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BrowserManager {
  constructor() {
    this.shared = !!CDP_ENDPOINT; // 云端共享模式
    this.browser = null; // cdp 连接下的 Browser 对象
    this.context = null;
    this.page = null;
    this.proc = null; // 仅本地模式：我们启动的 Chrome 进程
    this.headless = DEFAULT_HEADLESS;
    this.launching = null;
    this.lastNav = 0;
    this.ownedPages = new Set(); // 共享模式下由本技能创建的标签页
  }

  // ───────────── 启动 ─────────────

  async connectExisting() {
    const portFile = path.join(PROFILE_DIR, 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) return null;
    const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
    if (!port) return null;
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
    } catch {
      return null;
    }
  }

  /** 云端共享模式：连接平台常驻浏览器，不启动进程 */
  async startShared() {
    const b = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 15000 });
    this.browser = b;
    b.on('disconnected', () => {
      if (this.browser === b) {
        this.browser = null;
        this.context = null;
        this.page = null;
      }
    });
    const ctx = b.contexts()[0];
    if (!ctx) throw new Error('共享浏览器没有可用的浏览器上下文。');
    // 平台浏览器运行在虚拟显示中，按有头处理，避免登录/验证逻辑尝试重启
    this.headless = false;
    return ctx;
  }

  async startCdp(headless) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    // 复用已经在运行、使用同一用户目录的 Chrome（例如上次未关闭的窗口）
    let b = await this.connectExisting();
    if (b) {
      this.headless = false; // 无法得知其模式，按可见处理
    } else {
      const portFile = path.join(PROFILE_DIR, 'DevToolsActivePort');
      fs.rmSync(portFile, { force: true });
      const args = [
        `--user-data-dir=${PROFILE_DIR}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1400,950',
        // 远程调试模式下 Chrome 会把 navigator.webdriver 设为 true，站点据此判定为自动化
        '--disable-blink-features=AutomationControlled',
        ...BROWSER_ARGS,
      ];
      if (headless) args.push('--headless=new');
      this.proc = spawn(findChrome(), [...args, 'about:blank'], { stdio: 'ignore', detached: false });
      this.proc.on('exit', () => (this.proc = null));
      let port = '';
      for (let i = 0; i < 60 && !port; i++) {
        await sleep(250);
        if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
      }
      if (!port) throw new Error(`浏览器启动失败（未拿到调试端口）。用户目录：${PROFILE_DIR}。如果有使用该目录的 Chrome 窗口，请先关闭。`);
      b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
      this.headless = headless;
    }
    this.browser = b;
    const ctx = b.contexts()[0];
    b.on('disconnected', () => {
      if (this.browser === b) {
        this.browser = null;
        this.context = null;
        this.page = null;
      }
    });
    return ctx;
  }

  async startPlaywright(headless) {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const opts = {
      headless,
      viewport: { width: 1400, height: 900 },
      locale: 'zh-CN',
      acceptDownloads: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled', ...BROWSER_ARGS],
    };
    if (CHANNEL !== 'chromium') opts.channel = CHANNEL;
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, opts);
    this.headless = headless;
    return ctx;
  }

  async start(headless = this.headless) {
    let ctx;
    if (this.shared) {
      ctx = await startShared();
    } else {
      try {
        ctx = LAUNCH_MODE === 'playwright' ? await this.startPlaywright(headless) : await this.startCdp(headless);
      } catch (e) {
        if (/ProcessSingleton|SingletonLock|already in use/i.test(String(e))) {
          throw new Error(`浏览器用户目录被占用：${PROFILE_DIR}。请关闭使用该目录的其他浏览器/MCP 实例后重试。`);
        }
        throw e;
      }
    }
    if (!this.shared && this.headless) {
      // 无头 Chrome 的 UA 含 HeadlessChrome，会被站点直接拦截
      const p0 = ctx.pages()[0] || (await ctx.newPage());
      const ua = await p0.evaluate(() => navigator.userAgent).catch(() => '');
      if (ua.includes('HeadlessChrome')) {
        const cdp = await ctx.newCDPSession(p0);
        this.uaOverride = ua.replace('HeadlessChrome', 'Chrome');
        await cdp.send('Network.setUserAgentOverride', { userAgent: this.uaOverride }).catch(() => {});
      }
    }
    await ctx
      .addInitScript(() => {
        try {
          Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
        } catch {}
      })
      .catch(() => {});
    ctx.on('page', (p) => this.attachPage(p));
    ctx.on('close', () => {
      if (this.context === ctx) {
        this.context = null;
        this.page = null;
      }
    });
    this.context = ctx;
    if (this.shared) {
      // 新建专属工作标签页，不碰共享浏览器已有的页面
      const page = await ctx.newPage();
      this.ownedPages.add(page);
      this.attachPage(page);
      this.page = page;
    } else {
      const pages = ctx.pages().filter((p) => !p.isClosed());
      pages.forEach((p) => this.attachPage(p));
      this.page = pages.find((p) => p.url().startsWith(BASE_URL)) || pages[0] || (await ctx.newPage());
    }
    return ctx;
  }

  attachPage(p) {
    if (p.__mcpAttached) return;
    p.__mcpAttached = true;
    p.__dialogs = [];
    // 站点用 alert/confirm 提示时自动确认，避免阻塞；消息留给工具返回
    p.on('dialog', async (d) => {
      p.__dialogs.push({ type: d.type(), message: d.message });
      try {
        await d.accept();
      } catch {}
    });
    p.on('close', () => {
      this.ownedPages.delete(p);
      if (this.page === p) {
        const rest = this.context?.pages().filter((x) => !x.isClosed()) || [];
        this.page = rest.at(-1) || null;
      }
    });
    if (this.uaOverride && this.context) {
      this.context
        .newCDPSession(p)
        .then((s) => s.send('Network.setUserAgentOverride', { userAgent: this.uaOverride }))
        .catch(() => {});
    }
    // 站点常用 target=_blank 打开新标签，自动切换到新页
    // 内部后台标签页（__mcpBackground）不切换当前页
    setTimeout(() => {
      if (this.context && !p.__mcpBackground && !p.isClosed()) this.page = p;
    }, 0);
    // 共享模式下，让该标签页的下载直接落到目标目录（覆盖 Playwright 的浏览器级设置）
    if (this.shared) this.configureDownloadFor(p).catch(() => {});
  }

  /**
   * 共享模式：对页面显式设置下载目录。
   * 平台浏览器不采用 Playwright 的浏览器级临时目录，页面级 Page.setDownloadBehavior 可生效。
   */
  async configureDownloadFor(page) {
    if (!this.shared || !this.context || page.isClosed()) return;
    const session = await this.context.newCDPSession(page);
    await session.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: getDownloadDir(),
    });
  }

  async ensure() {
    if (this.context && this.page && !this.page.isClosed()) return this.page;
    if (this.launching) {
      await this.launching;
    } else if (!this.context) {
      this.launching = this.start().finally(() => (this.launching = null));
      await this.launching;
    }
    if (!this.page || this.page.isClosed()) {
      if (this.shared) {
        // 共享模式下只使用自己新建的标签页，不碰其他页面
        const p = await this.context.newPage();
        this.ownedPages.add(p);
        this.attachPage(p);
        this.page = p;
      } else {
        this.page = this.context.pages().find((p) => !p.isClosed()) || (await ctx.newPage());
      }
    }
    return this.page;
  }

  /**
   * 以指定模式重启（本地模式用于切换可见窗口）。
   * 共享模式无法重启平台浏览器，直接返回当前页。
   */
  async restart(headless, { reopen = true } = {}) {
    if (this.shared) return this.page;
    const url = this.page && !this.page.isClosed() ? this.page.url() : null;
    await this.close();
    await this.start(headless);
    if (reopen && url && url.startsWith(BASE_URL)) await this.goto(url).catch(() => {});
    return this.page;
  }

  // ───────────── 导航 ─────────────

  async goto(url, { waitMs = 1500 } = {}) {
    let page = await this.ensure();
    const full = url.startsWith('http') ? url : BASE_URL + (url.startsWith('/') ? url : '/' + url);
    const gap = MIN_NAV_INTERVAL_MS - (Date.now() - this.lastNav);
    if (gap > 0) await sleep(gap);
    this.lastNav = Date.now();
    try {
      await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      // 页面自身脚本正在跳转/刷新时会中断本次导航，稍等后重试一次
      if (!/ERR_ABORTED|interrupted by another navigation|NETWORK_CHANGED/.test(String(e))) throw e;
      await sleep(1500);
      page = await this.ensure();
      await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    // WAF 首次访问会下发 JS 质询并自动刷新
    for (let i = 0; i < 10; i++) {
      const title = await page.title().catch(() => '');
      if (title.trim() && !/阻断页面/.test(title)) break;
      await page.waitForTimeout(800);
    }
    if (await this.isVerificationPage(page)) page = await this.waitForHumanVerification(full);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    if (waitMs) await page.waitForTimeout(waitMs);
    const title = await page.title().catch(() => '');
    if (/阻断页面/.test(title)) {
      throw new Error('请求被站点 WAF 阻断（阻断页面）。请稍后重试。');
    }
    return page;
  }

  async isVerificationPage(page) {
    const title = await page.title().catch(() => '');
    return /滑动验证|安全验证/.test(title);
  }

  /**
   * 站点弹出「滑动验证页面」时等待人工完成验证，不尝试自动破解。
   * 共享模式下浏览器在虚拟显示中，由调用方通过截图等方式与用户交互。
   */
  async waitForHumanVerification(url, timeoutSec = VERIFY_TIMEOUT_SEC) {
    if (!this.shared && this.headless) {
      await this.restart(false, { reopen: false });
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    let page = this.page;
    await page.bringToFront().catch(() => {});
    process.stderr.write(`[zujuan-mcp] 站点要求安全验证（最长等待 ${timeoutSec} 秒）\n`);
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      page = this.page && !this.page.isClosed() ? this.page : await this.ensure();
      if (!(await this.isVerificationPage(page))) {
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        if (!page.url().startsWith(url.split('?')[0].replace(/\/$/, ''))) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        }
        this.lastNav = Date.now();
        return page;
      }
      await sleep(1500);
    }
    throw new Error(
      `站点要求安全验证（访问过于频繁），${timeoutSec} 秒内未完成。请稍后重试，或降低操作频率。`
    );
  }

  /** 打开一个不会成为「当前页」的后台标签页 */
  async backgroundPage() {
    await this.ensure();
    const prev = this.page;
    const p = await this.context.newPage();
    p.__mcpBackground = true;
    if (this.shared) this.ownedPages.add(p);
    this.page = prev;
    return p;
  }

  async close() {
    if (this.shared) {
      // 只关闭本技能创建的标签页，再断开 CDP 连接；绝不关闭共享浏览器
      for (const p of this.ownedPages) {
        if (!p.isClosed()) await p.close().catch(() => {});
      }
      this.ownedPages.clear();
      await this.browser?.close().catch(() => {}); // connectOverCDP 下仅断开连接
      this.browser = null;
      this.context = null;
      this.page = null;
      return;
    }
    const proc = this.proc;
    const b = this.browser;
    if (b) {
      if (proc) {
        // 正常关闭浏览器（让 Chrome 把 localStorage 等写回磁盘），并等进程真正退出。
        // 直接杀进程会丢失最近的本地存储，下次启动时组卷中心/试题篮会恢复成旧数据。
        try {
          const s = await b.newBrowserCDPSession();
          await s.send('Browser.close').catch(() => {});
        } catch {}
        for (let i = 0; i < 100 && this.proc; i++) await sleep(150);
      }
      await b.close().catch(() => {});
    } else if (this.context) {
      await this.context.close().catch(() => {});
    }
    if (proc && this.proc) {
      try {
        proc.kill();
      } catch {}
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.proc = null;
  }
}

export const browser = new BrowserManager();
export { PROFILE_DIR };

/**
 * 把一次下载保存到目标目录并返回最终文件路径。
 * 共享模式下浏览器已直接把文件下载到 getDownloadDir()，这里只等待最终文件写入完成；
 * 本地模式仍走 Playwright 的 download.saveAs。
 */
export async function saveDownload(download, { timeoutSec = 180 } = {}) {
  const name = download.suggestedFilename();
  const target = path.join(getDownloadDir(), name);
  if (!browser.shared) {
    await download.saveAs(target);
    return target;
  }
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) {
      const s1 = fs.statSync(target).size;
      await sleep(500);
      if (fs.existsSync(target) && fs.statSync(target).size === s1 && s1 > 0) return target;
    }
    await sleep(400);
  }
  // 兜底：浏览器可能因同名冲突改了文件名，扫描目录中最新的同类文件
  const ext = path.extname(name).toLowerCase();
  const candidates = fs
    .readdirSync(getDownloadDir())
    .filter((f) => path.extname(f).toLowerCase() === ext && !f.endsWith('.crdownload'))
    .map((f) => path.join(getDownloadDir(), f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (candidates[0]) return candidates[0];
  try {
    await download.saveAs(target);
    return target;
  } catch (e) {
    throw new Error(`下载文件未能保存到 ${target}：${e.message}`);
  }
}
