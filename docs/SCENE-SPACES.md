# Scene spaces / 场景空间

## English

Scene support is integrated on the feature branch, pending final release
validation. This is a usage guide, not a published-version or browser-test result.
See the [release contract](SCENE-SPACES-PLAN.md) for the remaining checks.

### Start with the homepage you already have

1. Update OpenTab on your other devices before using scene sync. Download a JSON
   backup from **Settings → Import and sync → Backup and restore**.
2. Open **Scenes**, beside the group tabs. Read the data-format and downgrade
   warning, then click **Enable scenes**. Opening this introduction or choosing
   **Cancel** does not enable scenes or migrate data.
3. Your existing content becomes **Default scene**, with its group/site IDs,
   folder structure, ordering, stored icon data, and local secret-vault references
   preserved. Choose **New scene** to add a name and icon. A new scene starts with
   an empty Home group, the bundled background, and default layout, not a copy of
   another scene. Names may contain 1–40 characters; the current limit is 64 scenes,
   including archived scenes.

The migration stores a full local recovery record without secrets in the same
write as the new scene graph. A quota/write failure does not trim your content to
make it fit. This internal record is not a separate user-facing restore button;
a downloaded backup remains the straightforward user-controlled recovery copy.

### What changes when you switch

| Belongs to each scene | Remains shared across scenes |
| --- | --- |
| Groups, folders, sites, and to-dos | Theme, accent, opacity, blur, shortcut frames, and motion preferences |
| Background choice and Bing image index | Search engines, search/privacy preferences, and history |
| Icon size, columns, show/hide names, grid max width | Weather, timezone, clock settings, and to-do button visibility |

The focus timer belongs to the tab, not a scene. Switching scenes does not reset
it. Scenes organize one OpenTab workspace; they are not separate browser
profiles, accounts, or security boundaries.

Each tab keeps its own scene and last group within that scene. An explicit scene
selection supplies a default for newly opened tabs, but does not switch existing
tabs. Switching selects a view of the complete stored graph; it never restores a
snapshot or discards inactive-scene records.

Finish or cancel unsaved edits before changing scenes. Pending saves must finish
first, and changed or archived destinations are rejected. If another tab's change
blocks a draft, the recovery message may offer **Discard unsaved edits and
retry**; only choose it when you no longer need the draft.

### Organize, find, and save

- To move individual websites, enter **Select sites** in the current group or
  open folder, select one or several sites, then choose **Move to…**. Destinations
  include groups and folders in all active scenes. Review the full path and count
  before confirming. The sites keep their IDs, URLs and artwork, with no copies
  or deduplication. You remain in the source view and can use the success notice's
  **Undo**. Changed source/destination identities or archived scenes reject a stale
  move or Undo; unrelated later edits are preserved.
- Open the scene manager to switch, rename, archive, or restore scenes. Archiving
  keeps all content; expand **Archived scenes** to restore it. The last active
  scene cannot be archived. There is no scene-delete action.
- To move a whole group, select a non-Home group, open the manager, choose
  **Move current group**, and select another active scene. Its child groups and
  sites move with it without new IDs or copies. To-dos and appearance stay in the
  source scene. Home groups cannot move.
- Saved-site search and **Cmd+K / Ctrl+K** search across active scenes, with
  scene/group paths to distinguish identical names. A group result switches to
  that scene and group; a site result opens the site. The palette also offers
  **Manage scenes**. Archived destinations are excluded.
- The toolbar popup lists **scene / group** destinations. Verify the selected
  destination before saving; its default is not a guarantee of the scene shown
  in a particular already-open tab. If the destination changes while the popup
  is open, choose it again rather than saving to a stale target.
- Additive imports and pasted URL lists target the current scene. Importing an
  OpenTab backup is different: it restores the whole workspace.

### Sync is optional, and not a full backup

Enabling scenes keeps your existing sync opt-in unchanged. With Chrome sync on,
scene-aware devices use a separate v2 namespace. The scene-specific payload
contains scene metadata, group ownership, sites, and the four layout settings.
The pre-existing allowlist of shared settings continues to sync as before.

To-dos, backgrounds/Bing selection, uploaded and local icon data, search history,
per-tab scene selection, and SSH secrets do not sync. A newly received scene uses
local default background data, not the other device's wallpaper. Local-only
scenes missing from an applied cloud copy are retained as archived recovery
scenes instead of having their content silently deleted.

Devices still on the old v1 stream do not exchange scene edits with v2. Update
and enable scenes on each participating device; this is not an automatic merge
of old and new streams. Use the sync status and explicit local/cloud choice when
copies differ. No new permission, account, or external service is added.

### Backups, restore, and compatibility

- **Download backup** exports the complete scene workspace, including archived
  scenes, tasks, scene profiles, and stored local assets. It strips secrets and
  excludes search history by default; weather preferences/cache and Bing cache
  metadata remain outside the JSON backup. External media URLs remain URLs, not
  bundled copies of remote files.
- **Import backup** replaces the full workspace, not just the scene you are
  viewing. Restoring an older single-workspace backup in a scene-enabled app
  turns that backup into one default scene; it does not turn scenes off. Later
  edits are not merged into the restored graph. Export current work first.
- The existing manual **Save snapshot** action makes a compact snapshot that
  omits uploaded/local icon data. Full scene recovery points created before
  explicit backup restores or **Use cloud copy** preserve stored local assets.
  Automatic sync is not a per-update snapshot history; do not treat every
  snapshot as an equivalent full backup.
- An unsupported or malformed scene schema blocks normal editing in this build
  instead of treating the data as an old workspace. For an unsupported version,
  update to a compatible OpenTab build, then retry. A retry does not convert an
  unknown format; do not clear storage or force an old backup over newer work.
- **Do not downgrade on the same browser profile after enabling scenes.** The
  protections in this build cannot make an older build refuse unsafe writes.
  Separate sync namespaces protect the streams, not an older program editing
  the same local storage. Return to a compatible build before choosing an
  explicit full restore. There is no supported one-click “disable scenes” or
  safe same-profile old-app fallback.

## 简体中文

场景功能已在功能分支集成，最终发布验证尚未完成。本文说明使用方式，不代表
已发布新版本或已完成浏览器验收；剩余检查见[发布约定](SCENE-SPACES-PLAN.md)。

### 从已有主页开始

1. 使用场景同步前，先更新其他设备上的 OpenTab。在「设置 → 导入与同步 →
   备份与恢复」下载 JSON 备份。
2. 点击分组标签旁的「场景空间」，阅读数据格式与降级提示，再点击
   「启用场景空间」。仅打开介绍或选择「取消」不会启用或迁移。
3. 现有内容进入「默认场景」，保留分组 / 网站 ID、文件夹结构、顺序、已存储的
   图标数据和本地密钥库引用。点击「新建场景」填写名称并选择图标。新场景从空的
   主页分组、内置背景和默认布局开始，不会复制另一个场景。名称为 1–40 个字符；
   当前最多 64 个场景，已归档场景也占数量。

迁移会在写入新结构的同一次操作中保存不含密钥的完整本地恢复记录。空间不足或
写入失败时，不会删减内容来强行完成。该内部记录没有独立的用户恢复按钮；下载的
备份仍是便于自行保管和选择恢复的副本。

### 切换时哪些内容会变

| 每个场景单独保存 | 所有场景共享 |
| --- | --- |
| 分组、文件夹、网站和待办 | 主题、主题色、不透明度、虚化、快捷方式背景框和动态效果 |
| 背景选择和 Bing 图片索引 | 搜索引擎、搜索 / 隐私设置和搜索历史 |
| 图标大小、列数、名称显隐、网格最大宽度 | 天气、时区、时钟设置和待办按钮显隐 |

专注计时属于标签页，不属于场景，切换不会重置。场景只是同一个 OpenTab 工作区的
整理方式，不是独立浏览器配置、账号或安全隔离区。

每个标签页记住自己的场景和该场景中上次查看的分组。主动选择场景会为新标签页
提供默认值，但不会让已经打开的其他标签页跟着切换。切换只是查看完整数据中的
一部分，不恢复快照，也不删除未显示的场景。

切换前请完成或取消未保存的编辑。正在保存的操作须先结束，已变化或已归档的目标
会被拒绝。如果其他标签页的变动使草稿暂时无法继续，恢复提示可能提供
「放弃未保存编辑并重试」；仅在不再需要草稿时选择。

### 整理、查找与收藏

- 移动单个或多个网站：在当前分组或打开的文件夹中进入「选择网站」，勾选后
  点击「移动到…」。可选择所有可用场景中的分组与文件夹，确认前会显示完整路径
  和网站数量。保留原 ID、网址和图标，不复制、不去重。移动后仍停留在原视图，
  可通过成功提示「撤销」。来源、目标身份变化或场景归档时，旧移动与撤销操作
  会被拒绝；其他无关的新修改会保留。
- 在场景管理面板切换、改名、归档或恢复。归档保留全部内容，展开「已归档场景」
  即可恢复。最后一个可用场景不能归档，目前没有删除场景的操作。
- 整体移动分组时，先选中非「主页」分组，打开管理面板，点击「移动当前分组」，
  再选择另一个可用场景。子分组和网站随之移动，不生成新 ID 或副本；待办和外观
  留在原场景。主页分组不能移动。
- 已保存网站搜索与 Cmd+K / Ctrl+K 跨可用场景查找，用场景 / 分组路径区分重名。
  选择分组结果会切换场景和分组，选择网站结果会打开网站。快捷入口还提供
  「管理场景空间」。已归档目标不参与查找。
- 工具栏弹窗明确列出「场景 / 分组」。保存前核对位置，默认项不一定等于某个已打开
  标签页正在看的场景。弹窗打开后目标若发生变化，需重新选择，不能提交旧目标。
- 追加导入和粘贴网址列表以当前场景为目标；导入 OpenTab 备份则不同，它恢复整个
  工作区。

### 同步可选，也不能代替完整备份

启用场景不会改变已有的同步开关。打开 Chrome 同步后，支持场景的设备使用独立
v2 命名空间。场景新增的同步内容仅含场景信息、分组归属、网站和四项布局设置；
原来允许同步的全局设置仍按原规则同步。

待办、背景 / Bing 图片选择、上传和本地图标数据、搜索历史、标签页场景选择及
SSH 密钥不同步。新收到的场景使用本地默认背景，而非另一设备的壁纸。应用云端
副本时，云端没有的本机场景会以已归档恢复场景保留，不悄悄删除其本地内容。

仍使用旧版 v1 数据流的设备，不会与 v2 互换场景编辑。参与同步的设备都需更新并
启用场景；新旧数据流不会自动合并。副本不一致时，请查看同步状态并明确选择用
本机还是云端。此功能不新增权限、账号或外部服务。

### 备份、恢复与兼容性

- 「下载备份」导出完整场景工作区，含已归档场景、待办、场景外观及已存储的本地
  素材。不含密钥，默认不含搜索历史；天气偏好 / 缓存及 Bing 缓存元数据仍不进入
  JSON。外部媒体地址仍是地址，不会把远程文件打包带走。
- 「导入备份」替换整个工作区，而非仅替换当前场景。已启用场景时恢复旧版单工作区
  备份，会将该备份转换成一个默认场景，不会关闭场景功能。后续编辑不会自动合并
  进恢复的数据，操作前请先导出当前内容。
- 手动「保存快照」仍生成紧凑快照，会省略上传 / 本地图标数据。场景模式下，在
  明确恢复备份或选择「用云端」前生成的完整恢复点会保留本地素材。自动同步并非
  每次更新都留快照；不要把所有快照都当作等价的完整备份。
- 本版本遇到未知或损坏的场景结构会阻止正常编辑，不会把它当旧数据继续写入。
  遇到不支持的版本，请先更新到兼容的 OpenTab，再重试。重试不会转换未知格式；
  不要清空存储，也不要强行用旧备份覆盖较新的内容。
- **启用场景后，不要在同一浏览器配置上降级。** 新版本的保护无法让旧程序拒绝
  不安全的写入。独立同步命名空间隔离的是数据流，不能保护同一本地存储免受旧程序
  修改。请先回到兼容版本，再明确选择是否完整恢复。目前没有受支持的一键
  「关闭场景」或可安全编辑同一配置的旧版回退方式。
