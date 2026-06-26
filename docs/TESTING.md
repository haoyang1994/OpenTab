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
- 设置面板可打开
- 时间格式切换为 24h 后 `#ampm` 隐藏
- 无异常 console error（已知网络类 Bing 错误可豁免）

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

用途：确认主流程未损坏，适合 agent 与本地频繁执行。

### 3.2 CI 一致性执行

```bash
npm run test:ci
```

说明：在 `CI=true` 时自动用 `xvfb-run` 启动有头浏览器，避免 Linux 无显示环境问题。

### 3.3 本地调试模式

```bash
npm run test:e2e:headed
npm run test:e2e:headless
```

## 4. 触发规则（Agent Gate）

当以下文件有改动时，必须至少执行一次 `npm test`：

- `home.html`
- `home.css`
- `home.js`
- `background.js`
- `manifest.json`
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

工作流：`.github/workflows/e2e.yml`

- 触发：`push`、`pull_request`
- Node 版本：20
- 强制步骤：
1. `npm ci`
2. `npx playwright install chromium`
3. `npm run test:ci`

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

2. `xvfb-run: command not found`
- 在 Linux 安装 `xvfb`，或改在带 GUI 环境执行

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
