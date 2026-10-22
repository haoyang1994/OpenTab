# Testing Strategy

## 1. 目标

本项目测试目标是保证 Chrome 新标签页扩展在以下方面持续可用：

- 页面可加载（扩展资源与脚本初始化正常）
- 核心交互可用（时钟、设置、背景、快捷图标）
- 数据持久化可靠（`chrome.storage.local`）
- 外部依赖可降级（Bing 接口异常时不阻塞主要功能）

## 2. 范围与边界

### 2.1 当前自动化已覆盖（E2E）

文件：`tests/extension.test.mjs`

- 能加载扩展页面（`chrome-extension://<id>/home.html`）
- 核心节点存在：`#time`、`#settings-btn`、`#refresh-bg-btn`、`#timezone-btn`
- 时钟文本非空
- 点击日期后日历（flatpickr）可打开
- 仓库根目录所有 `*.html` 不从 `node_modules/` 加载运行时资源；`vendor/` 文件存在，SSH 页 `Terminal` 与 `FitAddon` 可加载
- 设置面板可打开
- 时间格式切换为 24h 后 `#ampm` 隐藏
- 无异常 console error（已知网络类 Bing 错误可豁免；URL 白名单见 `tests/console-allow.mjs`，含 example.com / bing.com，不含笼统的 Failed to load resource）

文件：`tests/search.test.mjs`（由 `npm test` / `scripts/run-e2e.sh` 执行）

- AC1 内置 Google/Bing/百度/DuckDuckGo/GitHub；自定义 `%s` 引擎增删改与非法 URL 拒绝；默认引擎刷新后保持
- AC2 `example.com` / `https://a.b/c` / `localhost:3000` 直达；`hello world` / `1.5` / `a.b c` 当关键词
- AC3 Tab/Shift+Tab 切换引擎并高亮；`/` 与可打印字符聚焦搜索框；设置面板和其他输入框不受影响；聚焦「+」后空格打开添加弹窗（不劫持 button / `a[href]` / `[role=button]` / `summary` / `[tabindex]`）；中文输入法 `Process` / keyCode 229 / `compositionstart` 聚焦搜索框且不 `preventDefault`
- AC4 历史最多 20、去重、可关、可清，只写 `chrome.storage.local`
- AC5 快捷方式名称完全匹配（忽略大小写）回车打开并显示提示
- AC6 新标签页设置、Ctrl+Enter、中键
- AC8 记录首屏 DCL 与 `opentab:grid-ready`；DCL 必须 > 0；`grid-ready` 与 DCL 均 ≤ 500ms（与 T8 同类阈值）；无 console error

SSH 网关安全测试：`tests/ssh-gateway.test.mjs`（`npm run test:ssh-gateway`，已纳入 `npm test` / `npm run test:ci`）

- Origin 非 `chrome-extension://<id>` 时握手拒绝（含真实 WebSocket 升级）
- 缺少或错误 token 时握手拒绝
- compress 命令参数经 POSIX 单引号转义，注入载荷不会作为额外 shell 命令执行
- 未设置 `SSH_PRIVATE_KEY_PATH` 时不会加载 `~/.ssh/id_rsa`
- 无需真实 SSH 主机

仓库规范：`tests/repo-hygiene.test.mjs`（LICENSE / NOTICE / 社区文件 / 删除清单 / 根目录 html 本地引用）

导入与同步：`tests/import-sync.test.mjs`（`npm test` 会跑）。覆盖书签/常用网站 optional 权限 mock、Infinity/WeTab/iTab 解析、无法识别的备份、撤销快照、带文件夹的 OpenTab 备份导入、sync 按存储后 JSON 大小分片（含中文/引号至少 3 片且每片 ≤8KB）与超配额降级、按 id 合并远端图标、deviceId/内容哈希去环、第二台设备开启同步时的冲突选择与快照撤销、密钥存非导出 IndexedDB `CryptoKey`、启动时迁移明文秘密，以及导入/恢复不清空 vault。E2E（`tests/extension.test.mjs`）再走入口、导入/撤销、同步开关、用量、两个标签页开启同步后 10 秒不 reload，以及同步冲突「用云端」选择。

首屏：`tests/first-screen-unit.test.mjs` 覆盖 Bing 日更策略、CSP/权限相对 master、boot.js 体积与 `isLocalAsset`。E2E：`tests/first-run.test.mjs`（由 `npm test` / `scripts/run-e2e.sh` 执行）覆盖默认壁纸、启动镜像时钟/主题、以及 `opentab:boot-applied`。

布局与设置面板：`tests/layout.test.mjs`（单元）覆盖 layout normalize/cssVars、boot 镜像切片、设置搜索中英文匹配、天气分区占位、开发者工具迁移、`SYNC_SETTING_KEYS` 含布局键、带布局设置和中文引号名称的 BUG-022 分片，以及 `tests/console-allow.mjs` 的 URL 白名单。E2E：`tests/settings-layout.test.mjs`（由 `npm test` / `scripts/run-e2e.sh` 执行）覆盖 AC1 分区导航与窄屏顶部 tab、AC2 设置搜索（含分区内关键词、不依赖整段 keywords）与 Esc、AC3 布局实时预览与刷新保持（在 `opentab:grid-ready` 当时断言 80px / 6 列 / 隐藏名称，不 `waitForFunction` 等终值）、AC4 分区/全局恢复默认与撤销且不改快捷方式、BUG-032 全局恢复不关闭浏览器同步而同步分区恢复会关闭、AC5 开发者工具默认隐藏与老用户自动开启、AC6 焦点陷阱与 label/aria、AC7 无 console error 且首屏 `grid-ready` / DCL ≤ 500ms。

图标：`tests/icons.test.mjs`（`npm test` 会跑）。覆盖内置库 ≥40 且中英文各半、paintSrc 从不返回 http(s)、自定义 URL 高于内置库、sync 剥离 data URL / `iconCacheState` / `chrome-extension:` / `blob:`。E2E 断言首屏第三方图标请求为 0，网格就绪后用 `<img>` 显示远程图标（含不带 CORS 头的站点、popup/导入、上传本地图片），且无 CORS 控制台豁免。

### 2.2 当前未覆盖（需要手工/后续自动化）

- 右键新增图标完整流程（emoji/name/url 输入校验）
- 图标删除确认流程
- 页面重开后的持久化回读（图标/背景/时区/时制）
- 时区列表交互与每个时区显示正确性
- 背景 Tab 切换（Bing/Gradient/Custom URL）全路径
- 网络失败时 UI 反馈（例如提示/占位）

## 3. 测试分层

### 3.1 快速冒烟（每次改动必须）

```bash
npm test
```

用途：确认仓库规范、导入/同步单元测试、首屏单元测试、布局/设置单元测试、图标单元测试、SSH 网关安全测试与主流程均未损坏。`npm test` 顺序：`tests/repo-hygiene.test.mjs` → `tests/import-sync.test.mjs` → `tests/first-screen-unit.test.mjs` → `tests/layout.test.mjs` → `tests/icons.test.mjs` → `test:ssh-gateway` → Playwright E2E（`extension` / `search` / `first-run` / `settings-layout`）。

### 3.2 CI 一致性执行

```bash
npm test
```

说明：CI 与本地使用同一条命令。`npm test` 先跑 repo-hygiene、`tests/import-sync.test.mjs`、`tests/first-screen-unit.test.mjs`、`tests/layout.test.mjs`、`tests/icons.test.mjs` 和 `test:ssh-gateway`，再走 `scripts/run-e2e.sh`：有显示器时直接有头运行；Linux 无 `DISPLAY` 或 `CI=true` 时用 `xvfb-run` 包装有头 Chromium（MV3 扩展需要 headed 才能稳定加载）。`npm run test:ci` 与 `npm test` 相同。

### 3.3 本地调试模式

```bash
npm run test:e2e:headed
npm run test:e2e:headless
npm run test:ssh-gateway
```

`test:e2e:headless` 不推荐：Playwright 无头使用 `chrome-headless-shell`，MV3 `--load-extension` 可能失败。需要看浏览器窗口时用 `test:e2e:headed`；无显示器环境请用 `npm test`（自动 xvfb）。

## 4. 触发规则（Agent Gate）

当以下文件有改动时，必须至少执行一次 `npm test`：

- `home.html`
- `home.css`
- `home.js`
- `boot.js`
- `bing-cache.js`
- `search.js`
- `folders.js`
- `import.js`
- `sync.js`
- `layout.js`
- `settings-nav.js`
- `background.js`
- `manifest.json`
- `ssh-gateway.mjs`
- `ssh_terminal.js`
- `tests/**`

当改动涉及背景请求、权限或外部接口时，除 `npm test` 外还应手工验证 Bing 刷新按钮。

## 5. 用例矩阵（建议执行）

| 模块 | 场景 | 预期 | 类型 |
|---|---|---|---|
| 启动加载 | 打开新标签页 | 主页渲染完成，无白屏 | 冒烟 |
| 时钟 | 12h/24h 切换 | 显示格式即时变更并持久化 | 冒烟 |
| 时区 | 切换时区 | 时间与标签更新、刷新后保持 | 回归 |
| 背景-Bing | 点击刷新 | 背景切换或在失败时平稳降级 | 回归 |
| 背景-Gradient | 选择预设 | 背景即时切换并持久化 | 回归 |
| 背景-Custom | 输入 URL 应用 | 背景更新并持久化 | 回归 |
| 图标新增 | 新增合法链接 | 卡片显示，点击可打开链接 | 回归 |
| 图标删除 | 右键删除确认 | 卡片移除并持久化 | 回归 |
| 异常控制台 | 页面初始化 | 无未预期错误日志 | 冒烟 |

## 6. 网络与降级策略

### 6.1 Bing API 规范

- 使用官方接口：`https://www.bing.com/HPImageArchive.aspx`
- 扩展权限需包含：`https://www.bing.com/*`

### 6.2 失败处理预期

当 Bing 请求失败时：

- 不应阻断页面主要功能（时钟/设置/图标）
- 保留当前背景，不出现脚本崩溃
- 控制台允许出现受控错误信息，但不能出现未处理异常

## 7. CI 规范

工作流：`.github/workflows/ci.yml`

- 触发：`push` 到 `master`、所有 `pull_request`
- Node 版本：20
- 强制步骤：
1. `npm ci`
2. `npx playwright install --with-deps chromium`
3. `npm test`（repo-hygiene、import-sync、first-screen-unit、layout 单元测试、SSH 网关安全测试、E2E；E2E 在无显示器时由 `scripts/run-e2e.sh` 套 xvfb）

## 8. 失败分级与处理

- P0（阻断发布）：主页无法加载、脚本崩溃、核心按钮缺失
- P1（高优先）：关键交互失效（时区/时制/图标不可用）
- P2（中优先）：样式/文案偏差、非核心边缘场景

处理要求：

1. P0/P1 必须修复后再合并。
2. P2 可在有追踪 issue 的前提下合并。

## 9. 常见失败与排查

1. `Executable doesn't exist`
- 执行 `npm run pw:install`

2. `xvfb-run` 缺失（`npm test` 会打印友好提示并 exit 1）
- 在 Linux 安装 `xvfb`（如 `sudo apt-get install xvfb`），或改在带 GUI 环境执行 `npm run test:e2e:headed`

3. 扩展未加载
- 确认 `manifest_version` 为 3
- 确认 `--load-extension` 路径指向项目根目录

4. Bing 请求失败
- 确认 `manifest.json` 包含 `https://www.bing.com/*`
- 检查本机 DNS、代理和防火墙

## 10. 后续增强建议

1. 引入 Playwright Test runner，产出 HTML 报告与 trace。
2. 为图标 CRUD、时区切换、背景切换补齐自动化用例。
3. 增加离线模式和 API 失败可视化提示测试。


## 11. 天气隐私与可靠性回归

- `node tests/weather-unit.test.mjs`：默认关闭、城市校验、显式偏好保留、缓存复用与过期、服务/数据异常、超时、关闭后迟到响应、同标签与跨标签单位切换、存储读取/写入失败。测试使用隔离 VM 和合成数据，不读取定位或请求真实天气。
- `tests/weather.test.mjs` 已加入 `npm test` / headed E2E 链：真实 MV3 页面中检查默认无天气请求、城市保存后主动启用、刷新与故障降级、跨重载缓存、关闭与输入校验；全部 HTTP 请求拦截，城市为 `Test City`。
- 权限回归要求不新增权限，并明确移除 `geolocation`。CSP 比较对新旧基线对称规范化，避免图标迭代合并后误报。
- 验证记录（2026-10-22）：云工作区的 Node 单元与 SSH 安全检查通过；该工作区因缺少显示依赖及浏览器 IPC 限制无法执行 E2E。随后在 GitHub Actions Ubuntu 云 runner 完整运行 `npm test`，全部五套真实 MV3 E2E 通过，包括天气、搜索、首屏、设置恢复/撤销与原有扩展功能。参见 [CI 39718057430](https://github.com/haoyang1994/OpenTab/actions/runs/39718057430)。每次后续提交仍须重新通过完整 CI。
- CI 保存 `browser-verification` 截图产物（7 天），包括天气浅色、深色与 600px 窄屏。截图不是完整的人工可访问性审计，Chrome 商店发布仍是独立流程。


## 12. 多标签页持久化回归

- `node tests/workspace-persistence.test.mjs`：按字段/实体 ID 的三路合并、冲突拒绝、加载归一化与真实编辑的区别、队列和失败不破坏数据。
- `node tests/settings-undo.test.mjs`：设置重置撤销只回退自身改变的字段，保留合并后的无关设置，拒绝同字段冲突及旧代次操作。
- `tests/workspace.test.mjs`：真实 MV3 双页面共享持久存储，并发添加/独立重命名、旧标签修改时钟、删除不复活、同一项目冲突、设置保存合并后旧编辑弹窗/图标更换/撤销仍被拒绝、行内重命名显式取消、备份替换代次、删除、导入和同步撤销保留新项目、popup 与主页并发添加、持锁页面关闭后保存恢复。每个数据场景验证存储及重新加载后的内容。
- 上述测试均进入 `npm test` / `test:ci`；浏览器套件保留成功截图及失败时两个页面的截图，使用合成网址并拦截外部网络。
- 这不是跨设备实时协同编辑保证。具体冲突与撤销规则见 [PERSISTENCE.md](PERSISTENCE.md)。
