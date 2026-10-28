# Microsoft Edge compatibility

OpenTab uses one Manifest V3 package for Chrome and desktop Microsoft Edge. No additional permissions, search-provider changes, or storage migrations are introduced by Edge compatibility.

## Install

1. Extract the unsigned OpenTab ZIP (or use the repository’s extension directory).
2. Open `edge://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select the directory containing `manifest.json`.
3. Edge may disable an extension that changes the new tab page or request confirmation. Review and explicitly enable OpenTab / keep its new-tab change. Do not disable browser protections to suppress this prompt.
4. Open a new tab. Reload the extension on `edge://extensions/` after updating its files.

The shortcut-settings button opens `edge://extensions/shortcuts` in Edge and `chrome://extensions/shortcuts` in Chrome. Bookmark import reads the current browser’s bookmarks, not another browser’s profile. Optional bookmark and top-site permissions remain requested only for explicit import actions.

## Data and search

Chrome and Edge profiles have separate local storage and browser sync services. Installing in Edge does not copy or delete Chrome data, and browser sync is not a Chrome-to-Edge transfer. Use OpenTab’s explicit JSON backup/import flow to transfer supported data; review the backup scope first. SSH credentials are not transferred in ordinary backups. Do not uninstall the source profile before checking the destination.

Built-in and custom search engines and saved preferences are unchanged. Edge supports `chrome.search`, but compatibility alone does not require replacing OpenTab’s search behavior or adding its permission. No browser default search setting is changed.

## Verification

The existing `CI` workflow runs the complete Chromium regression suites and extracted-ZIP smoke test. The separate Edge workflow runs a real installed Microsoft Edge against the extracted ZIP, not Chromium with a forged user agent. Its browser version and assertions are logged by CI. These are separate checks; Chromium success is not evidence of Edge success. See the actual commit’s CI results for pass/fail status.

Runtime compatibility is not an Edge Add-ons certification or Store submission. No developer registration or listing publication is performed here.

## Official references

- [Port a Chrome extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)
- [Supported extension APIs](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)
- [Edge extension developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)
- [Why Edge turns off some extensions](https://support.microsoft.com/en-gb/edge/why-does-microsoft-edge-turn-off-extensions-i-ve-installed)

## 简体中文

Chrome 与桌面版 Edge 共用同一份 MV3 扩展，不新增权限、不改变搜索引擎、不迁移存储格式。

解压 ZIP 后，在 `edge://extensions/` 开启开发者模式，点击「加载解压缩的扩展」，选择包含 `manifest.json` 的目录。Edge 可能要求确认新标签页更改或暂时停用扩展，请检查后明确启用 OpenTab；不要关闭浏览器保护来绕过提示。升级文件后在该页面重新加载。

快捷键管理会打开 Edge 自己的设置页。书签导入读取当前浏览器的书签，仍只在主动操作时请求可选权限。Chrome 与 Edge 的本地数据和同步服务彼此独立；安装 Edge 版本不会自动迁移或删除 Chrome 数据。如需迁移，请先导出 OpenTab JSON 备份，再在 Edge 明确导入，并核对结果。普通备份不含 SSH 密钥或密码。

原有内置、自定义搜索引擎及个人设置保持不变。完整 Chromium 回归与真实 Edge ZIP 测试分别在 CI 执行，是否通过以对应提交的检查结果为准。此工作不是商店审核或提交。
