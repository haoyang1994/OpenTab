globalThis.OpenTabI18n?.register({
  '小组件': 'Widgets', '添加小组件': 'Add widget', '舍弃草稿并重新载入': 'Discard drafts and reload', '重新读取小组件': 'Reload widgets', '布局帮助': 'Layout help',
  '拖动手柄或聚焦手柄后按方向键移动，也可在尺寸与位置中输入行列。窄窗口自动重排，原布局保留。': 'Drag the handle or focus it and use arrow keys. You can also enter rows and columns in Size and position. Narrow windows reflow without changing your saved layout.',
  '移动小组件（方向键）': 'Move widget (arrow keys)',
  '便笺': 'Note', '清单': 'Checklist', '常用链接': 'Quick links', '倒计日': 'Countdown',
  '内容': 'Content', '保存内容': 'Save content', '事项': 'Event', '目标日期': 'Target date',
  '请选择目标日期': 'Choose a target date', '还有 {days} 天': '{days} days remaining', '已过 {days} 天': '{days} days ago',
  '链接名称': 'Link name', '网址': 'URL', '添加链接': 'Add link', '删除链接': 'Delete link',
  '新事项': 'New item', '添加事项': 'Add item', '删除事项': 'Delete item',
  '尺寸与位置': 'Size and position', '占用列数': 'Column span', '占用行数': 'Row span',
  '起始列': 'Start column', '起始行': 'Start row', '应用布局': 'Apply layout', '移除小组件': 'Remove widget',
  '组件类型': 'Widget type', '添加到主页': 'Add to homepage', '关闭': 'Close',
  '注册自定义组件': 'Register custom widget', '组件定义 JSON': 'Widget definition JSON', '注册组件': 'Register widget', '注销自定义组件': 'Unregister custom widget',
  '粘贴 JSON 定义，支持便笺、清单、链接和倒计日。仅接受数据，不执行脚本、HTML 或远程代码。': 'Paste a JSON definition for a note, checklist, links or countdown widget. Definitions are data only; scripts, HTML and remote code are never executed.',
  '小组件已保存。': 'Widget saved.',
  '布局已保存：{title}，第 {row} 行，第 {column} 列，{w}×{h}。': 'Layout saved: {title}, row {row}, column {column}, {w}×{h}.',
  '其他标签页已修改小组件。草稿已保留，请复制后重新载入。': 'Widgets changed in another tab. Drafts are preserved; copy them before reloading.',
  '小组件数据无效：请检查类型、字段、链接、日期及数量或容量限制。': 'Invalid widget data: check the type, fields, URLs, dates, count and size limits.',
  '小组件保存或读取失败，草稿已保留，请重试。': 'Could not save or read widgets. Drafts are preserved; please retry.',
  '请先移除该类型的所有小组件；内置组件不可注销。': 'Remove all instances of this type first. Built-in types cannot be unregistered.'
});

// Unified desktop widgets (2026-11 redesign).
globalThis.OpenTabI18n?.register({
  '桌面列数按分组保存。应用列数会整理位置；已有组件大小保持不变。': 'Desktop columns are saved per group. Applying columns reorganizes positions and preserves widget sizes.',
  '桌面列数': 'Desktop columns', '应用列数并整理': 'Apply columns and organize',
  '取消桌面列数修改': 'Cancel desktop column changes',
  '时钟': 'Clock', '组合组件': 'Composite widget', '已完成': 'Completed',
  '写下你的想法': 'Write down your thoughts', '在设置中添加事项': 'Add items in settings', '在设置中添加链接': 'Add links in settings',
  '时区（留空使用系统时区）': 'Time zone (leave blank for system zone)', '十二小时制': '12-hour clock',
  '桌面已在其他位置变化。草稿已保留，请导出后重新读取。': 'The desktop changed elsewhere. Drafts are preserved; export them before reloading.',
  '目标位置已占用，原布局保留。请选择空位。': 'That space is occupied. Your layout is unchanged; choose an empty space.',
  '组件数据无效，请检查尺寸、字段、日期、链接和容量。': 'Invalid widget data. Check dimensions, fields, dates, links and capacity.',
  '桌面读取或保存失败，草稿与原数据已保留。': 'Could not read or save the desktop. Drafts and original data are preserved.',
  '目标分组已变化，请重新打开组件库或设置。': 'The target group changed. Reopen the library or settings.',
  '桌面已保存。': 'Desktop saved.', '未知组件（数据已保留）': 'Unknown widget (data preserved)',
  '移动': 'Move', '设置': 'Settings', '删除': 'Delete',
  '拖动移动按钮，或聚焦后按方向键移动。': 'Drag the Move button, or focus it and use arrow keys.',
  '此类型暂不可用，可导出数据或重新注册对应定义。': 'This type is unavailable. Export its data or restore its definition.',
  '组件恢复数据': 'Widget recovery data', '组件显示失败，数据已保留，可在设置中导出。': 'Could not display the widget. Its data is preserved and can be exported from settings.',
  '窄窗口仅重排显示。请在设置中输入桌面坐标，或扩大窗口后拖动。': 'Narrow windows only reflow the view. Enter desktop coordinates in settings, or widen the window to drag.',
  '拖动组件移动按钮或网址到空位；组件方向键、网址 Alt＋方向键移动。空位保留，整理需主动选择。': 'Drag a widget Move button or website to empty space. Use arrow keys on widget handles, or Alt + arrows on websites. Holes stay until you choose Organize.',
  '布局已保存，空位保留。': 'Layout saved. Empty spaces preserved.', '窄窗口请在设置中输入桌面坐标。': 'In narrow windows, enter desktop coordinates in settings.',
  '可放置': 'Available', '已占用': 'Occupied', '组件已删除，可撤销。': 'Widget deleted. Undo is available.',
  '桌面已变化，无法撤销旧操作。': 'The desktop changed. This old action cannot be undone.', '组件已恢复。': 'Widget restored.',
  '设置草稿已保留，请先保存或取消。': 'A settings draft is preserved. Save or cancel it first.',
  '此类型暂不可编辑，数据已保留。': 'This type cannot be edited right now. Its data is preserved.',
  '保存内容与布局': 'Save content and layout', '取消并舍弃此设置草稿': 'Cancel and discard this settings draft',
  '组件库': 'Widget library', '需要恢复对应的本地类型': 'Restore the corresponding local type', '预览暂不可用，定义已保留。': 'Preview unavailable. The definition is preserved.',
  '添加到当前分组': 'Add to current group', '注销定义': 'Unregister definition', '请先移除该类型在所有分组中的实例。': 'Remove all instances of this type from every group first.',
  '未找到原分组的组件': 'Widget with a missing group', '恢复到当前分组': 'Recover to current group',
  '导出恢复数据与草稿': 'Export recovery data and drafts', '舍弃设置和注册草稿并重新读取': 'Discard settings and registration drafts, then reload',
  '选择卡片，将组件添加到当前场景的当前分组。': 'Choose a card to add a widget to the current group in the current scene.',
  '注册组合组件': 'Register composite widget',
  '用文本、数字、列表、日期、进度和链接组合自己的组件。只接受声明式 JSON，不执行脚本、HTML 或远程代码。': 'Combine text, numbers, lists, dates, progress and links. Only declarative JSON is accepted. Scripts, HTML and remote code never execute.',
  '舍弃注册草稿': 'Discard registration draft', '整理桌面': 'Organize desktop', '撤销删除': 'Undo deletion',
  '请先保存或取消小组件编辑。': 'Save or cancel widget editing first.', '组件数据需要恢复，分组未删除。': 'Widget data needs recovery. The group was not deleted.'
});

// Labels and preview content for the component gallery.
globalThis.OpenTabI18n?.register({
  '组件库导航': 'Widget library navigation', '桌面布局': 'Desktop layout', '自定义组件': 'Custom widgets',
  '搜索小组件': 'Search widgets', '没有找到小组件': 'No widgets found',
  '记录灵感，留住重要的小事。': 'Capture ideas and little things that matter.',
  '整理今天的计划': 'Plan the day', '留一点时间给自己': 'Make time for yourself',
  '常用网站': 'Top sites', '工作资料': 'Work resources', '下一次旅行': 'Next trip'
});

globalThis.OpenTabI18n?.register({
  '更多操作': 'More actions', '小组件操作': 'Widget actions', '编辑': 'Edit',
  '恢复数据': 'Recovery data', '拖动移动，方向键调整位置': 'Drag to move, or use arrow keys',
  '请先增加桌面列数，再添加此组件。': 'Increase the desktop column count before adding this widget.'
});

globalThis.OpenTabI18n?.register({ '超出桌面边界，原布局已保留。': 'Outside the desktop bounds. Your layout is unchanged.' });

globalThis.OpenTabI18n?.register({
  '当前分组：{name}': 'Current group: {name}', '选择组件': 'Choose widgets', '添加内容': 'Add content', '网站': 'Sites', '组件管理': 'Widget management',
  '尚未注册自定义组件。': 'No custom widgets registered yet.',
  '新建文件夹': 'Create folder', '已新建文件夹': 'Folder created',
  '默认列数用于尚未单独设置的分组；启用多场景后按场景保存。当前分组列数优先，修改默认值不会整理已有分组。': 'Default columns apply to groups without their own saved layout. With scenes enabled, this default is saved per scene. Group columns take priority; changing the default does not reorganize saved groups.'
});
