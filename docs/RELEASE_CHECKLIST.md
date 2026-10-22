# Release Checklist

## 合并前（必须）

1. `npm ci`
2. `npm run pw:install`
3. `npm test`
4. 手工打开 `chrome://newtab` 验证首页可正常显示

## 功能回归（建议）

1. 时钟 12h/24h 切换并刷新页面验证持久化
2. 时区切换并刷新页面验证持久化
3. Bing 背景刷新至少一次
4. Gradient 背景切换并刷新验证
5. Custom URL 背景设置并刷新验证
6. 新增一个快捷图标并验证可打开
7. 删除该快捷图标并验证已移除

## 配置核查

1. `manifest.json` 版本号与权限配置正确
2. `host_permissions` 包含 `https://www.bing.com/*`
3. CI 工作流 `.github/workflows/ci.yml` 为绿色

## 发布阻断条件

1. 任一 P0/P1 缺陷未解决
2. 自动化测试失败
3. 核心流程手测失败（加载、时钟、设置）

## 可复现扩展 ZIP（发布前必须）

1. 按 [离线打包说明](RELEASE_PACKAGING.md) 审查运行时文件白名单。
2. `npm run test:package`，然后 `npm test`。
3. `npm run package:release`，检查打印的 SHA-256 和 ZIP 内容。
4. `npm run test:package:smoke`，用解压后的 ZIP 完成真实 MV3 验证。
5. 保留 LICENSE / NOTICE；打包不代表已签名、上传、发布或通过商店审核。
