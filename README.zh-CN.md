<div align="center">

# OpenTab

Chrome Manifest V3 新标签页，iPad 风格毛玻璃界面。开源、可审计。

[English](README.md) | **简体中文**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/haoyang1994/OpenTab/actions/workflows/ci.yml/badge.svg)](https://github.com/haoyang1994/OpenTab/actions/workflows/ci.yml)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-brightgreen.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-1.1.0-orange.svg)](manifest.json)

</div>

---

## 简介

OpenTab 覆盖 `chrome://newtab`，提供本地可定制的主页：时钟、快捷方式、搜索、天气和少量开发工具。设置只保存在本机。

首屏从本地 boot 镜像套用主题、时钟和壁纸，不再闪过占位文案。首次安装使用打包的 `default.webp`，在你选择 Bing 壁纸之前不会请求 Bing。

## 功能

### 时钟与日历

- 毛玻璃时钟卡片，支持 12 小时 / 24 小时
- 23 个常用时区
- 可选秒数
- 带节假日和节气的日历弹层

### 主题

- 深色、浅色，或跟随系统
- 六种主题色（极光蓝、梦幻紫、日落橙、薄荷绿、樱花粉、星空蓝）
- 可选粒子背景和缓慢渐变流动
- 极简模式（双击时钟）
- 可调面板不透明度、虚化、以及快捷方式背景框

### 背景

- 离线可用的本地默认壁纸（`default.webp`）；首次安装不请求 Bing
- Bing 每日壁纸会按天更新并缓存到本地（刷新按钮可切换近期历史图）
- 预设渐变
- 三张项目自有静态图（晨曦雾山湖、金色松林、星空海岸），以及 `default.webp`
- 自定义图片 / 视频 URL，或本地上传

### 快捷方式

- **+ 添加**：当前分组网格末尾常驻「+」卡片，也可在空白处右键
- **拖拽排序**：桌面网格支持鼠标拖动，聚焦后可用 Alt+←/→
- **文件夹**：把一个图标拖到另一个上停留约 500ms，会合成名为「文件夹」的文件夹（可撤销）；拖到已有文件夹上则加入。点击文件夹在当前页展开，可排序、拖出、改名；中键或右键「全部打开」按图标数开标签（超过 10 个先在页面内确认）。只剩 1 个图标时自动解散。
- **分组**：网格上方的标签（点击、滚轮、Alt+1–9）。可新建、改名、删除；删除时在页面内选择「移到默认分组」或「一起删除」，可撤销。左侧抽屉和左边缘 6px 悬停已去掉。
- **图标**：内置 40+ 常用站点高清图标；未命中则用域名配色的首字母占位。右键「更换图标」可重新抓取、上传本地图片或改占位颜色。图标缓存为本地 data URL，打开新标签页不再向那些网站发请求
- **真正的链接**：中键 / Ctrl / Cmd 点击新开标签，悬停显示网址
- **删除可撤销**：删除后底部 toast 可在 6 秒内撤销
- **Esc 关闭**：按 Esc 逐层关闭菜单、弹窗、文件夹层、设置、日历，并还原焦点
- 内置 SSH 终端（需要下面的本地网关）
- 本地 JSON 格式化工具和 FIX 解析器
- 工具栏弹窗可将当前标签页存为快捷方式（可选分组）

### 搜索、天气、待办、备份

- 搜索引擎：Google、Bing、百度、DuckDuckGo、GitHub，以及自定义 `%s` 引擎
- 输入网址或域名直接打开；输入与快捷方式名称完全匹配时回车打开该快捷方式
- 输入框获焦时 Tab / Shift+Tab 切换引擎；页面无焦点时按 `/` 或直接打字聚焦搜索框
- 本地搜索历史（最多 20 条，可关、可清）
- 「搜索结果在新标签页打开」，以及 Ctrl/Cmd+回车、中键
- 天气胶囊：浏览器地理位置 + [wttr.in](https://wttr.in)
- 侧边抽屉待办和进度条
- JSON 备份导出 / 导入，以及本地快照
- 可导入 Chrome 书签、常用网站，以及 Infinity / WeTab / iTab 备份（`bookmarks` / `topSites` 为可选权限，点击按钮时才申请）
- 可选的浏览器同步（只同步快捷方式、分组和设置，不同步壁纸、历史和当前打开的分组）；另一台设备已有数据时会询问「用云端 / 用本机」。设置里显示本地存储用量

### 设置与布局

- 分区导航：外观、壁纸、快捷方式与布局、搜索、天气（给首屏迭代留位）、导入与同步、高级、关于。点击跳转，滚动时高亮跟着变；宽度不到 720px 时改成顶部 tab
- 面板顶部搜索按标签和说明过滤（中英文、不区分大小写）；没有结果时显示「没有找到」。Esc 先清空搜索框，再按一次关闭面板
- 布局：图标大小（小/中/大，或 48–96px）、每行个数（自动或 4–12）、显示/隐藏名称、网格最大宽度。改动实时预览，刷新后保持，并走现有同步键
- 每个分区和底部都有「恢复默认」（页面内确认 + 现有撤销提示），不会改快捷方式数据
- SSH / JSON / FIX 入口默认隐藏，在「高级」里开启；已经在用这些快捷方式的安装会自动保持开启

## 截图

画面里的 Google / GitHub 标志仍是各自所有者的商标。见 [NOTICE](NOTICE)。

### 深色主题

![深色主题预览](screenshots/preview-dark.png)

### 浅色主题

![浅色主题预览](screenshots/preview-light.png)

### 设置面板

![设置面板](screenshots/settings-panel.png)

## 隐私说明

- 偏好设置、快捷方式、待办、快照和搜索历史保存在当前浏览器配置的 `chrome.storage.local`。打开浏览器同步时，只会同步快捷方式、分组和设置（不同步壁纸、待办、搜索历史、当前分组或 SSH 密钥）。Bing 壁纸缓存元数据只保存在 `chrome.storage.local`（不同步，也不写入 JSON 备份）。本机已有快捷方式时，开启同步会先询问用云端还是用本机，用云端前会自动快照。下载的 JSON 备份默认不含搜索历史。
- 搜索框不会向任何引擎请求联想或建议。
- 书签和常用网站使用 `optional_permissions`：安装时不会多要权限，只有点击对应导入按钮才会申请。
- OpenTab 没有统计、没有广告、没有账号登录。
- OpenTab 不会改写或拦截你打开的链接。
- 可选功能会请求少量外部主机：

| 服务 | 用途 | 数据 |
| --- | --- | --- |
| Bing 每日壁纸 API（`www.bing.com`） | 背景图，**仅在选择 Bing 壁纸时** | 图片 URL / 元数据。图片版权归原作者，OpenTab 只做展示。首次安装使用本地壁纸，不会访问 Bing。 |
| [wttr.in](https://wttr.in) | 天气胶囊 | 浏览器地理位置权限给出的大致位置。 |
| 你添加的网站的 favicon | 快捷方式图标 | 仅在添加、更换或升级迁移时请求，然后缓存到本地。打开新标签页不会再向那些网站发请求。 |

SSH 连接经过你自己启动的**本地** WebSocket 网关（`ssh-gateway.mjs`），不经过 OpenTab 云服务。

## 安装

### 开发者模式加载已解压扩展（当前支持的方式）

克隆后即可直接加载，**不需要 `npm install`**。日历（flatpickr）和 SSH 终端（xterm）从仓库里的 [`vendor/`](vendor/README.md) 加载，各库的 LICENSE 文件也在对应目录中。

1. 克隆本仓库。
2. 打开 Chrome，访问 `chrome://extensions/`。
3. 打开右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择仓库根目录。
5. 打开新标签页。

`npm install` / `npm ci` 只在跑自动化测试，或启动本地 SSH WebSocket 网关时需要。

### Chrome 网上应用店

待发布。

## 开发

```bash
npm ci
npm run pw:install
npm test
npm run test:ssh-gateway
npm run test:e2e:headed
npm run test:e2e:headless
npm run test:ci
```

`npm test` 会先跑 `tests/repo-hygiene.test.mjs`，再跑 `tests/import-sync.test.mjs`，再跑 `tests/first-screen-unit.test.mjs`，再跑 `tests/layout.test.mjs`，再跑 SSH 网关安全测试（`npm run test:ssh-gateway`），最后跑 Playwright E2E（`scripts/run-e2e.sh`：`extension`、`search`、`first-run`、`settings-layout`）。Linux 无显示器时该脚本会用 `xvfb` 包装有头 Chromium（需安装 `xvfb` 包）。`npm run test:ci` 与 `npm test` 相同。详见 [docs/TESTING.md](docs/TESTING.md)。

修改扩展文件后，在 `chrome://extensions/` 点击扩展卡片上的「重新加载」。

## SSH 网关

SSH 需要本地 WebSocket 网关。网关**只接受本扩展**（`chrome-extension://<扩展ID>`）的连接，并要求访问令牌。**不会**读取 `~/.ssh/id_rsa`，除非你设置 `SSH_PRIVATE_KEY_PATH`。

1. 打开 `chrome://extensions`，开启开发者模式，复制 OpenTab 的扩展 ID。
2. 启动网关：

```bash
npm install

# 必填：Origin 白名单钉到本扩展，否则网关拒绝启动
export SSH_GATEWAY_EXTENSION_ID='你的扩展ID'

# 可选：显式指定私钥。不设置则只用 SSH 图标里填写的密码登录。
# export SSH_PRIVATE_KEY_PATH="$HOME/.ssh/id_ed25519"
# export SSH_PRIVATE_KEY_PASSPHRASE='如有口令'

npm run ssh:gateway
```

3. 首次启动会打印 **access token**（之后只显示 token 文件路径）。把它填进 OpenTab SSH 图标的「网关访问令牌」。
4. 网关地址填 `ws://127.0.0.1:8787/ssh`（或 `ws://localhost:8787/ssh`）。**只支持 `127.0.0.1` / `localhost`：** 扩展 CSP 仅允许连到这两个主机。已保存的非回环网关地址（包括 `[::1]`）会被拦截。

未设置扩展 ID 时网关不会启动。任意网页（以及缺少 Origin 头的客户端）无法连接；缺少或错误令牌时握手会被拒绝。

环境变量：

- `SSH_GATEWAY_HOST` — 监听主机（默认 `127.0.0.1`）。**只支持** `127.0.0.1` / `localhost`。绑到非回环地址时，扩展侧 CSP 会拒绝连接。
- `SSH_GATEWAY_PORT` — 监听端口（默认 `8787`）
- `SSH_GATEWAY_PATH` — WebSocket 路径（默认 `/ssh`）
- `SSH_GATEWAY_EXTENSION_ID` — 本扩展 ID（**必填**；Origin 白名单。未设置则拒绝启动）
- `SSH_GATEWAY_ALLOWED_ORIGINS` — 可选，逗号分隔的 `chrome-extension://...`
- `SSH_GATEWAY_TOKEN` — 固定访问令牌；不设则生成并写入 `~/.config/opentab/ssh-gateway.token`
- `SSH_GATEWAY_TOKEN_FILE` — 令牌文件路径
- `SSH_PRIVATE_KEY_PATH` — **显式**私钥路径；省略时**不会**回落到 `~/.ssh/id_rsa`
- `SSH_PRIVATE_KEY_PASSPHRASE` — 私钥口令（如有）

快捷方式编辑器支持 SOCKS5 代理。SSH / SOCKS 密码和网关令牌用 AES-GCM 加密。包装密钥用 `extractable: false` 生成，并把 `CryptoKey` 对象存在 IndexedDB（不把原始密钥和密文一起放在 `chrome.storage.local`）。剩余风险：能以本扩展身份执行代码，或在 Chrome 仍愿为本扩展解开该密钥时读到此配置的 IndexedDB / 存储的人，仍可解密。备份和 `chrome.storage.sync` 不含这些密钥。

升级说明（已有 SSH 图标）：

- **破坏性变更：** 网关地址只支持 `127.0.0.1` / `localhost`。非回环主机（包括 `[::1]`）会被 CSP 拦截。
- 每个旧 SSH 图标都要补填「网关访问令牌」，否则连不上新网关。
- 网关不再默认使用 `~/.ssh/id_rsa`。如果仍要用私钥登录，启动前设置 `SSH_PRIVATE_KEY_PATH`。
- 必须设置 `SSH_GATEWAY_EXTENSION_ID`（`chrome://extensions` 里 OpenTab 的 ID）。

## 项目结构

```
OpenTab/
├── LICENSE / NOTICE / CHANGELOG.md
├── README.md / README.zh-CN.md
├── CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md
├── manifest.json
├── package.json
├── background.js              # Service Worker
├── home.html / home.css / home.js
├── boot.js                    # 首屏启动镜像（主题、时钟、壁纸、布局）
├── bing-cache.js / lib/bing-daily.js
├── search.js                  # 新标签页搜索框（引擎、历史、网址直达）
├── folders.js                 # 桌面文件夹和分组标签
├── import.js / sync.js        # 备份导入和 chrome.storage.sync
├── icons.js                   # 快捷方式图标库、缓存、更换图标
├── layout.js / settings-nav.js
├── specs/                     # 迭代验收标准
├── popup.html / popup.css / popup.js
├── tool.html / tool.css / tool.js
├── fixparser.html / fixparser.js
├── ssh_terminal.html / ssh_terminal.css / ssh_terminal.js
├── ssh-gateway.mjs            # 本地 SSH WebSocket 网关
├── vendor/                    # 入库的 flatpickr / xterm（含各库 LICENSE）
├── icons/                     # PNG 图标和 SVG 源文件
├── assets/default_background/ # 项目自有的默认静图
├── screenshots/
├── tests/
├── docs/                      # 历史 SPEC、测试说明、发布说明
└── .github/                   # Issue/PR 模板和 CI
```

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交即视为按 Apache-2.0 授权（inbound = outbound）。不要求签署 CLA。

## 许可证

本项目采用 Apache License, Version 2.0，全文见 [LICENSE](LICENSE)。

第三方软件、照片、商标和其他材料列在 [NOTICE](NOTICE)。其中部分条目**不在** Apache-2.0 授权范围内。
