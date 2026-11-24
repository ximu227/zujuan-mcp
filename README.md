# zujuan-mcp

让 AI 通过真实浏览器操作[组卷网](https://zujuan.xkw.com)的网关服务：选题、筛选、试题篮、组卷、智能组卷、细目表组卷、试卷汇编、下载 Word/PDF 试卷、存档与收藏等。

本仓库是**网关运行时**，由配套的 `zujuan` skill 通过命令行脚本 `zj.mjs` 拉起，对外提供本地 HTTP/JSON 接口（默认 `127.0.0.1:8765`）。

## 架构

```
zujuan skill (zj.mjs)
      │  HTTP/JSON (127.0.0.1:8765)
      ▼
doubao/gateway.mjs ── 把 src/index.js 作为 stdio 子进程拉起
      │
      ▼
src/browser.js ── Playwright connectOverCDP
      │
      ▼
平台常驻浏览器（CDP 9222）── zujuan.xkw.com
```

- **云端共享模式**（设置 `ZUJUAN_CDP_ENDPOINT`）：直接连接平台常驻浏览器，不自己启动进程，复用平台网络通道；只在共享浏览器中新建/关闭自有标签页，绝不关闭整个浏览器。
- 下载通过页面级 `Page.setDownloadBehavior` 重定向到 `ZUJUAN_DOWNLOAD_DIR`，由 `saveDownload` 等待文件落盘。

## 目录结构

```
.
├── doubao/
│   └── gateway.mjs        # HTTP 网关，把 MCP 服务器作为子进程拉起
├── src/
│   ├── browser.js         # 浏览器生命周期 + 共享 CDP 模式 + 下载保存
│   ├── index.js           # MCP 工具注册（含 browser_* 通用工具）
│   ├── zujuan.js          # 组卷网业务工具（选题/组卷/下载等）
│   ├── center.js          # 组卷中心相关
│   ├── features.js        # 站内 API 特性
│   └── tools-extra.js     # 额外工具
├── deploy.sh              # 一键部署/更新脚本
├── .env.example           # 环境变量示例
└── package.json
```

## 环境要求

- Node.js >= 18
- 可通过 CDP 访问的浏览器（云端平台浏览器，或本机 Chrome/Edge）

## 从 GitHub 一键部署（推荐）

在目标机器（云主机）上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/ximu227/zujuan-mcp/main/deploy.sh | bash
```

或克隆后手动执行：

```bash
git clone https://github.com/ximu227/zujuan-mcp.git "$HOME/zujuan-mcp"
cd "$HOME/zujuan-mcp"
./deploy.sh
```

`deploy.sh` 会自动完成：拉取代码 → `npm install` → 创建下载目录。已有安装目录时会更新到最新版本。可传参指定目录和分支：`./deploy.sh /path/to/dir main`。

> 私有仓库克隆需要认证：先 `gh auth login`，或在 URL 中使用 token，或配置 git 凭据。

## 配置

复制环境变量示例并按需修改：

```bash
cp .env.example .env
```

主要变量：

| 变量 | 说明 |
|---|---|
| `ZUJUAN_CDP_ENDPOINT` | 共享浏览器 CDP 端点，如 `http://127.0.0.1:9222` |
| `ZUJUAN_DOWNLOAD_DIR` | 下载文件保存目录 |
| `ZUJUAN_GATEWAY_PORT` | 网关端口，默认 8765 |
| `ZUJUAN_GATEWAY_TOKEN` | 可选访问令牌 |
| `ZUJUAN_HEADLESS` | 自启模式下是否无头（1/0） |

完整清单见 `.env.example`。配套 skill 的 `config.json` 也会通过 `env` 字段注入这些变量。

## 启动

正常情况下由 skill 的 `zj.mjs` 自动管理。手动启动：

```bash
node doubao/gateway.mjs
```

健康检查：`curl http://127.0.0.1:8765/health`。

## 合规说明

- 遵守组卷网用户协议，不批量抓取题库。
- 登录由用户扫码完成；极验滑块等验证码由用户人工处理，本项目不包含自动破解验证码的能力。
- 请勿提交 `.env`、cookie、登录态等真实凭据。
