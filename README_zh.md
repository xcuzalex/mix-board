# MixNote

无限画布 / 白板应用。可作为静态网页运行，也可打包为 macOS 原生桌面应用（Tauri v2）。

## 功能

### 画布与交互
- 平移、缩放（0.1×–5×）、网格切换、智能对齐参考线
- 框选、多选（Shift+点击）
- 撤销/重做（100 步历史）
- 复制 / 粘贴 / 复制副本（带偏移）
- 元素编组与解组
- 图层排序（置顶/置底）
- 元素对齐与均匀分布
- 右键上下文菜单

### 元素类型
| 类型 | 说明 |
|------|------|
| 形状 | 矩形、椭圆、菱形、三角形 — 支持文字、填充与描边 |
| 文本 | 独立文本块 |
| 便签 | 彩色便签（9 种颜色） |
| 线条 / 箭头 | 连接器，11 种箭头样式 + 4 种路径形状 |
| 自由绘制 | 压感笔触 |
| 高亮笔 | 半透明画笔 |
| 图片 | 嵌入式图片（自动缩放至 400px） |
| 脑图 | 树形图，7 种布局模式 |
| 表格 | 可编辑单元格的网格表格 |
| 分区 | 带标签的容器，用于组织元素 |
| 框架 | 支持导出的框架容器 |

### 扩展图形库（35+ 种）
胶囊、六边形、八边形、平行四边形、梯形、星形、对话气泡、云朵、圆柱、数据库、文档、流程图符号（流程、预定义流程、手动输入、显示、延迟、内部存储）、UML（类框、包、组件）、状态机等。

### 连接器与线条
- 路径形状：直线、折线、曲线、直角折线
- 箭头类型（起点/终点各自可选）：无、实心箭头、开放箭头、空心箭头、菱形、空心菱形、圆形、空心圆形、横线、三角形、空心三角形
- 自动吸附到形状连接点（每个形状 4 个连接点）

### 脑图
- 7 种布局：左右展开、全部向左、全部向右、向下树形、向右树形、组织架构图、时间轴
- 节点形状：纯文字、圆角矩形、胶囊
- 节点颜色、字号、折叠/展开
- 键盘操作：Tab（添加子节点）、Enter（添加兄弟节点）

### 文件操作
- 保存 / 打开 `.mixnote` 文件（JSON 格式）
- 导出画布为 PNG（带 40px 边距）
- 桌面端：原生文件对话框，直接读写文件系统
- 网页端：文件选择框输入，Blob 下载

## 键盘快捷键

### 工具切换
| 按键 | 工具 |
|------|------|
| `V` | 选择 |
| `H` | 抓手（平移） |
| `R` | 矩形 |
| `O` | 椭圆 |
| `D` | 菱形 |
| `L` | 线条 |
| `A` | 箭头 |
| `T` | 文本 |
| `N` | 便签 |
| `P` | 自由绘制 |
| `Shift+P` | 高亮笔 |
| `I` | 图片 |
| `M` | 脑图 |
| `F` | 框架 |
| `Shift+S` | 分区 |

### 编辑操作
| 按键 | 操作 |
|------|------|
| `Ctrl/Cmd+Z` | 撤销 |
| `Ctrl/Cmd+Shift+Z` | 重做 |
| `Ctrl/Cmd+A` | 全选 |
| `Ctrl/Cmd+C` | 复制 |
| `Ctrl/Cmd+V` | 粘贴 |
| `Ctrl/Cmd+D` | 复制副本 |
| `Ctrl/Cmd+G` | 编组 |
| `Ctrl/Cmd+Shift+G` | 解组 |
| `Delete` / `Backspace` | 删除选中元素 |
| `Ctrl/Cmd+S` | 保存 |
| `Ctrl/Cmd+Shift+E` | 导出 PNG |

### 图层排序
| 按键 | 操作 |
|------|------|
| `Ctrl/Cmd+]` | 上移一层 |
| `Ctrl/Cmd+Shift+]` | 置于顶层 |
| `Ctrl/Cmd+[` | 下移一层 |
| `Ctrl/Cmd+Shift+[` | 置于底层 |

### 画布控制
| 按键 | 操作 |
|------|------|
| `Space`（按住） | 平移模式 |
| `Shift+G` | 切换网格 |
| `Ctrl/Cmd+滚轮` | 缩放 |
| `Esc` | 取消选中 / 退出编辑 |

### 脑图专用
| 按键 | 操作 |
|------|------|
| `Tab` | 添加子节点 |
| `Enter` | 添加兄弟节点 |
| 双击 | 编辑节点文字 |

## 快速上手

### 环境要求

**网页版：**
- Node.js 20+，npm 10+

**桌面版（macOS）：**
- Node.js 20+，npm 10+
- Rust stable + Cargo
- Xcode Command Line Tools：`xcode-select --install`

安装 Rust：
```bash
curl https://sh.rustup.rs -sSf | sh
rustup default stable
```

### 一键启动

```bash
./run.sh            # 网页版 — 访问 http://localhost:5173
./run.sh desktop    # macOS 桌面版
./run.sh --help     # 查看用法
```

首次运行会自动安装 npm 依赖。

### 手动启动

```bash
# 仅网页版
cd ui && npm install && npm run dev

# 桌面版
cd ui && npm install && npm run tauri:dev
```

## 构建

```bash
# 前端（输出至 ui/dist）
cd ui && npm run build

# macOS .dmg 安装包
cd ui && npm run tauri:build
```

## 文档格式

文件使用 `.mixnote` 扩展名（JSON 格式）：

```json
{
  "type": "mixnote",
  "version": 1,
  "source": "MixNote/0.1.0",
  "elements": [...],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridEnabled": false,
    "gridSize": 20
  },
  "files": {}
}
```

`files` 字段以 base64 存储嵌入的图片等资源。

## 项目结构

```
mix-board/
├── Cargo.toml                   # Rust 工作区
├── run.sh                       # 一键启动脚本
├── crates/
│   └── mixnote-tauri/           # Tauri 桌面壳 + IPC 命令
└── ui/
    └── src/
        ├── canvas/              # 渲染器、交互、碰撞检测、连接器
        ├── components/          # Toolbar、PropertyPanel、TopBar、ContextMenu
        ├── platform/            # 桌面/网页抽象层
        ├── store/               # Zustand 状态（文档 + UI）
        ├── types/               # TypeScript 元素/文档/工具类型定义
        └── utils/               # IO、颜色、数学、ID 工具函数
```

**技术栈：** React 19、TypeScript 5、Vite 8、Zustand + Immer、Tailwind CSS 4、Tauri v2。

## 常见问题

**`./run.sh: Permission denied`**
```bash
chmod +x run.sh
```

**Tauri 提示缺少 Rust 或系统依赖**
```bash
rustc --version && cargo --version
xcode-select --install   # macOS
```

**端口 5173 被占用** — Vite 会提示端口冲突，关闭占用该端口的进程，或在 `ui/vite.config.ts` 中修改端口号。
