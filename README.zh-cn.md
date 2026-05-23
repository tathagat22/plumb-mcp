<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI 编程，已打通。" width="100%">
</p>

# Plumb (`plumb-mcp`)

**面向 AI 编程代理的 Figma MCP 服务器 —— 适用于 Claude Code、Cursor、Windsurf，以及任何兼容 Model Context Protocol 的 AI 编程工具。**

📖 完整文档：**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm：[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](./README.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

> 本翻译由 AI 辅助生成。欢迎以 PR 形式提交改进意见 — 我们重视母语者的审校。

Plumb 通过 Figma 桌面应用内运行的伴侣插件读取 Figma 文件，无 REST 速率限制、无计费、无套餐门槛。它返回紧凑的、归一化的设计规范，而不是 Figma API 输出的几十万 token 的 JSON，并按需将 SVG 图标与 PNG 图像导出到磁盘。在任何 Figma 套餐（包括免费版）上均可使用。

---

## 快速开始

### 安装服务器

```bash
# npm（推荐）
npm install -g plumb-mcp

# 或直接运行
npx plumb-mcp

# 或使用 Docker（多架构 — amd64 + arm64）
docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest
```

### 安装 Figma 插件

插件随 npm 包和 Docker 镜像一起发布。找到 manifest：

```bash
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
```

在 Figma 桌面应用中：**Plugins → Development → Import plugin from manifest…**，选择上面路径。

运行 **Plumb** 插件，点击 **Pair with Plumb**。配对成功后，插件会折叠为一个小圆点。

---

## 与其他 Figma MCP 服务器对比

| 能力 | Plumb | Figma 官方 Dev Mode MCP | Framelink | claude-talk-to-figma |
|---|---|---|---|---|
| 工具数量 | **12** | 较少 | 2 | 较少 |
| 在 Figma Free 套餐可用 | ✅ | 有限制 | ✅（无 Variables） | ✅ |
| 读取来源 | 插件 · REST · `.fig` | REST | REST | 插件 |
| 插件路径速率限制 | **无** | n/a | n/a | 无 |
| 非 Enterprise 套餐支持 Variables | ✅（通过插件） | 有限制 | ❌ | ✅ |
| 写回 Figma | ❌ | ✅ | ❌ | ✅ |
| 设计 vs 代码对比（`verify`） | ✅ | ❌ | ❌ | ❌ |
| 实时 `selection` 感知 | ✅ | ✅ | ❌ | ✅ |
| 组件 / 实例清单 | ✅ | 部分 | ❌ | 部分 |
| CI 环境下离线解析 `.fig` | ✅ | ❌ | ❌ | ❌ |
| Token 精简的 PDS（auto-layout → flex、去重） | ✅ | ❌ | 部分 | ❌ |
| 仅本地运行、零遥测 | ✅ | 云端 | ✅ | ✅ |
| 传输方式 | stdio | stdio | stdio + HTTP/SSE | stdio |
| 许可证 | MIT | 专有 | MIT | MIT |

---

## 十二个工具

| 工具 | 作用 |
|---|---|
| `plumb_status` | 自描述、键名说明、连接状态。首先调用此工具。 |
| `plumb_outline` | 列出文件中每一个屏幕（id、名称、尺寸）。 |
| `plumb_node` | 将屏幕提取为紧凑的 PDS —— 通过 id 或名称。 |
| `plumb_tokens` | 设计 token 表（颜色、文字、圆角、阴影）。 |
| `plumb_selection` | 用户在 Figma 中当前选中的对象。 |
| `plumb_assets` | 导出图标（SVG）和图像（PNG）—— 三种模式：递归、清单、精准 ids。 |
| `plumb_screenshot` | 将任意节点渲染为 PNG/JPG。 |
| `plumb_search` | 按名称和/或类型查找节点。 |
| `plumb_components` | 列出组件及其实例使用情况。 |
| `plumb_verify` | 将你渲染的布局与设计稿对比，返回结构化差异。 |
| `plumb_fig_outline` | 无需 Figma 桌面应用，直接从磁盘读取已保存的 `.fig` 文件并列出所有屏幕。 |
| `plumb_fig_node` | 无需 Figma 桌面应用，按 id 从已保存的 `.fig` 文件中获取一个节点。 |

---

完整文档（架构、教程、每个工具的详细说明、故障排查）位于 **<https://tathagat22.github.io/plumb-mcp/>**。

MIT © Tathagat Maitray
