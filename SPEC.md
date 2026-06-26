# Chrome 主页插件 - iPad 风格

## 概念与愿景

一款优雅的 Chrome 浏览器主页插件，采用 iPad 桌面风格的圆角卡片设计语言。界面简洁大气，带有柔和的毛玻璃效果和精致的阴影，为用户提供艺术感的时钟展示、个性化背景设置以及可自定义的快捷链接图标。

## 设计语言

### 美学方向
iPad/iOS 桌面风格：圆角卡片、毛玻璃质感、柔和阴影、简洁图标

### 调色板
- **背景底色**: `#1a1a2e` (深蓝黑色)
- **卡片背景**: `rgba(255, 255, 255, 0.15)` (半透明白)
- **主文字**: `#ffffff`
- **次要文字**: `rgba(255, 255, 255, 0.7)`
- **强调色**: `#667eea` (蓝紫渐变起点)
- **辅助色**: `#764ba2` (蓝紫渐变终点)
- **边框色**: `rgba(255, 255, 255, 0.2)`

### 字体
- 主字体: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif`
- 时钟字体: `'SF Pro Display', -apple-system, sans-serif` (thin weight)

### 空间系统
- 卡片圆角: 24px
- 图标圆角: 16px
- 内边距: 16-24px
- 卡片间距: 16px
- 图标网格: 自由拖拽布局

### 动效哲学
- 所有过渡: `cubic-bezier(0.4, 0, 0.2, 1)` 300ms
- 悬停缩放: `scale(1.05)`
- 毛玻璃模糊: `backdrop-filter: blur(20px)`
- 删除动画: 淡出 + 缩小

## 布局与结构

```
┌─────────────────────────────────────────────────────────┐
│                    Bing 每日图片/渐变背景                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [🌐]           时钟 + 日期卡片              [⚙️] │   │
│  │              10:30 AM                              │   │
│  │           Saturday, March 21                        │   │
│  │              Asia/Shanghai                          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                        │
│       ┌────┐  ┌────┐  ┌────┐  ┌────┐                  │
│       │ 📁 │  │ 📧 │  │ ▶️ │  │ ➕ │                  │
│       └────┘  └────┘  └────┘  └────┘                  │
│                    (图标网格)                            │
│                                                        │
│                       🔄              ⚙️               │
│                  (刷新背景)      (设置)                  │
└─────────────────────────────────────────────────────────┘
```

## 功能与交互

### 1. 时钟 + 日期展示 + 时区选择
- **外观**: 大号艺术字体，居中显示
- **时间格式**: 12小时制 (AM/PM) 或 24小时制 (可切换)
- **日期格式**: 星期 + 月份 + 日期
- **字体**: 超细字重 (100-300)，极大字号 (80-120px)
- **秒数**: 可选显示
- **时区切换**: 时钟卡片右上角地球图标，点击展开时区选择器
- **常用时区**: 23 个常用时区快捷选择
- **时区显示**: 时钟下方显示当前时区名称和 UTC 偏移量

### 2. 背景设置
- **Bing 每日图片**: 
  - 默认使用 Bing 每日壁纸
  - 右下角刷新按钮手动切换下一张
  - 支持 Bing 图片存档 (最近 8 天)
- **预设渐变**: 5 张精选渐变背景
- **自定义图片**: 支持输入图片 URL
- **设置入口**: 底部设置按钮打开面板
- **背景类型 Tab**: Bing Daily / Gradients / Custom URL 切换

### 3. 链接图标 (小组件)
- **添加方式**: 右键点击空白区域
- **弹窗内容**: 
  - Emoji 选择器 (点击输入框显示常用 emoji 网格)
  - 图标名称
  - URL 地址
  - 保存/取消按钮
- **图标展示**: 圆角卡片，emoji + 名称
- **悬停效果**: 轻微放大 + 阴影加深
- **删除方式**: 右键点击图标 → 确认删除
- **数据存储**: chrome.storage.local 持久化

### 4. 右键菜单
- 空白区域右键: 打开添加图标弹窗
- 图标右键: 删除确认
- 禁止默认右键菜单

## 组件清单

### 时钟卡片 (ClockWidget)
| 状态 | 描述 |
|------|------|
| 默认 | 大号时间 + 日期居中显示 + 时区标签 |
| 12h 模式 | 显示 AM/PM |
| 24h 模式 | 仅显示时间数字 |
| 时区选择器 | 右上角图标展开时区列表 |

### 时区选择器 (TimezoneSelector)
| 状态 | 描述 |
|------|------|
| 隐藏 | 不可见 |
| 显示 | 23 个常用时区列表，带 UTC 偏移 |
| 选中 | 高亮显示当前选中时区 |

### 图标卡片 (IconWidget)
| 状态 | 描述 |
|------|------|
| 默认 | emoji + 名称，毛玻璃背景 |
| 悬停 | scale(1.05)，阴影加深 |
| 右键 | 显示删除确认 |

### Emoji 选择器 (EmojiPicker)
| 状态 | 描述 |
|------|------|
| 隐藏 | 不显示网格 |
| 显示 | 8x8 常用 emoji 网格 |
| 选中 | 填充到输入框并隐藏网格 |

### 设置面板 (SettingsPanel)
| 状态 | 描述 |
|------|------|
| 关闭 | 不可见 |
| 打开 | 从底部滑入，毛玻璃背景 |
| 背景 Tab | Bing / Gradients / Custom URL 切换 |

### 添加图标弹窗 (AddIconModal)
| 状态 | 描述 |
|------|------|
| 关闭 | 不可见 |
| 打开 | 居中显示，Emoji + 名称 + URL 表单 |
| Emoji 网格 | 聚焦输入框时显示，点击选中 |

## 技术方案

### 文件结构
```
my-chrome-homepage/
├── manifest.json          # 扩展配置文件
├── background.js         # Service Worker (右键菜单)
├── home.html             # 主页 HTML
├── home.css              # 主页样式
├── home.js               # 主页逻辑
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── SPEC.md
```

### manifest.json 配置
- `manifest_version`: 3
- `chrome_url_overrides`: newtab -> home.html
- `background`: service_worker (background.js)
- `permissions`: storage, contextMenus, activeTab
- `host_permissions`: chrome://newtab, chrome://startpage

### 数据模型
```javascript
// 存储结构
{
  background: {
    type: 'bing' | 'gradient' | 'image',
    value: string  // Bing URL / 渐变值 / 图片URL
  },
  clockFormat: '12h' | '24h',
  showSeconds: boolean,
  timezone: string,  // IANA 时区 ID
  bingIndex: number,  // Bing 图片索引 (0-7)
  icons: [
    {
      id: string,
      name: string,
      url: string,
      emoji: string
    }
  ]
}
```

### 常用时区列表
```javascript
const COMMON_TIMEZONES = [
  { id: 'Pacific/Honolulu', name: 'Honolulu', offset: -10 },
  { id: 'America/Los_Angeles', name: 'Los Angeles', offset: -8 },
  { id: 'America/Chicago', name: 'Chicago', offset: -6 },
  { id: 'America/New_York', name: 'New York', offset: -5 },
  { id: 'UTC', name: 'UTC', offset: 0 },
  { id: 'Europe/London', name: 'London', offset: 0 },
  { id: 'Europe/Paris', name: 'Paris', offset: 1 },
  { id: 'Africa/Cairo', name: 'Cairo', offset: 2 },
  { id: 'Europe/Moscow', name: 'Moscow', offset: 3 },
  { id: 'Asia/Dubai', name: 'Dubai', offset: 4 },
  { id: 'Asia/Kolkata', name: 'Mumbai', offset: 5.5 },
  { id: 'Asia/Bangkok', name: 'Bangkok', offset: 7 },
  { id: 'Asia/Shanghai', name: 'Shanghai', offset: 8 },
  { id: 'Asia/Tokyo', name: 'Tokyo', offset: 9 },
  { id: 'Australia/Sydney', name: 'Sydney', offset: 10 },
  { id: 'Pacific/Auckland', name: 'Auckland', offset: 12 }
  // ... 共 23 个时区
];
```

### 关键实现
1. **时区支持**: 使用 `Intl.DateTimeFormat` 和 `toLocaleTimeString` 获取指定时区时间
2. **Bing 图片**: 调用 `https://www.bing.com/HPImageArchive.aspx` 获取每日壁纸
3. **右键菜单**: background.js 中 chrome.contextMenus API
4. **数据持久化**: chrome.storage.local
5. **Emoji 选择**: 100+ 常用 emoji 网格，支持点击选择或手动输入
