# 迭代 8 图标质量与隐私（一屏需求）
目标：图标清晰好看，打开新标签页时不再向所有网站发请求。新逻辑放 icons.js。

审查后的实现顺序（覆盖 AC1–AC5，并修 BUG-025/026/027/028）：

1. 用户上传的本地图片或明确填写的 `customIconUrl` 优先级最高，不能被内置库覆盖。
2. 已缓存的 data URL。
3. 内置库 SVG。
4. 以上都没有时：首屏用字母占位；`opentab:grid-ready` 之后再用普通 `<img>` 加载远程 favicon（不 `fetch`、不设 `crossorigin`，避免 CORS 控制台报错）。`onerror` 退回字母。
5. 只有用户点击「重新抓取」才 `fetch()` 并转成 data URL；失败在更换图标面板提示「该站点不允许读取，已保留远程图标」。
6. 空闲迁移只做：匹配内置库、压缩过大的 data URL。不对站点发跨域 `fetch`。
7. 首页新增、popup、书签/常用网站导入、备份与同步都走同一套解析。同步剥离 data URL、`iconCacheState`，以及 `chrome-extension:` / `blob:` 的 `customIconUrl`。

- AC1 新增快捷方式：库命中 → 延迟 `<img>` 远程 favicon → 带底色首字母占位。popup / 导入同一套逻辑。
- AC2 内置高清图标库至少覆盖 40 个常用站点（中文和国际各半），矢量 128px SVG，许可证兼容 Apache-2.0，写进 NOTICE。
- AC3 老用户升级：空闲时把能匹配的换成库 SVG；原来的远程 favicon 仍可在首屏之后用 `<img>` 显示，不把能显示的真图标永久变成字母。
- AC4 右键「更换图标」：重新抓取、上传本地图片、选首字母占位并改颜色。
- AC5 隐私：E2E 断言首屏（`opentab:grid-ready` 之前）对第三方站点的图标请求为 0。
- AC6 `npm test` 覆盖并全部通过；不新增权限；包体增量不超过 300KB；首屏不劣化。
