<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI 编程，已打通。" width="100%">
</p>

# Plumb (`plumb-mcp`)

**带验证循环的 Figma → 代码 MCP。** 设计稿进、规范化设计规范出，`plumb-mcp verify` 驱动无头 Chrome 来证明你渲染出的代码确实匹配 Figma 中的设计。

📖 完整文档：**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm：[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](./README.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

> 本翻译由 AI 辅助生成。欢迎以 PR 形式提交改进意见 — 我们重视母语者的审校。

专为编码代理打造 —— Claude Code、Cursor、Windsurf，任何兼容 MCP 的工具。通过 Figma 桌面应用内运行的伴侣插件读取 Figma 文件（无 REST 速率限制，所有套餐包括免费版均可用），返回紧凑的归一化设计规范而非 Figma API 输出的数十万 token JSON，并按需将 SVG 图标和 PNG 图像直接导出到磁盘。

---

## Plumb 与其他 Figma MCP 的不同之处

另有三个值得了解的 Figma MCP 服务器：

- **Figma 官方 Dev Mode MCP** —— 双向（可写回 Figma），但有套餐门槛、按调用计费。
- **Framelink** —— 轻量级 REST 包装。两个工具。无验证，继承 REST 速率限制。
- **cursor-talk-to-figma** —— 面向设计师在 Figma 内自动化的双向工具。

Plumb 是唯一**在代码侧闭环**的方案。`plumb_verify` 告诉你代理生成的代码是否真的匹配设计 —— 带颜色编码的 delta、无像素对比、可在 CI 中运行。而 `plumb_fit` 把它变成**自愈循环**：它给构建打 0–100 的分数，返回需要修正的精确 delta，代理据此迭代直到像素级匹配。三种运行方式：在编辑器中（`plumb_fit`，免费）、在终端（`plumb-mcp fit <figma-url>`）、或在浏览器 [Playground](https://tathagat22.github.io/plumb-mcp/play/) 中（自带 key，无需安装、无需后端）。

---

## 你是否遇到了这些问题?

如果你的代理是从错误信息中找到这里,Plumb 多半能解决。

| 你看到的错误 | Plumb 为何能解决 |
|---|---|
| `Figma Dev Mode MCP exceeded the 25k token cap` · `351,378 tokens observed` | PDS 对设计 token(`$c1`、`$t1` …)去重,并把 auto-layout 预解析为 flexbox。同一个 178 节点的对话框只需 ~2.6k token。 |
| `Dev Mode MCP: 6 tool calls per month limit` · `Starter plan tool-call limit reached` | Plumb 的插件路径在所有套餐(包括免费版)上都没有按调用计费的配额。 |
| `Framelink figma-developer-mcp HTTP 429` · `Figma REST API rate limit exceeded` | 插件路径不走 REST,零速率限制。 |
| `Variables API requires Enterprise plan` · `403 Forbidden on variables` | Plumb 通过 Figma 插件 API 读取 Variables —— 所有套餐都可用。 |
| `Figma MCP returned 85% wrong layout` · 幻觉式结构 | Plumb 返回结构化 PDS(而非解析后的散文),并附带 `plumb_verify` + `plumb-mcp verify` CLI,可对比已渲染 DOM 与设计稿。 |
| `Dev Mode MCP requires selection` · "Open desktop app with the right selection" | 插件配对的那一刻,Plumb 就把整个文件清单流式发送过来,无需每次调用都选中节点。 |

安装:`npm install -g plumb-mcp` → `plumb-mcp init`。

---

## 快速开始

```bash
# 1. 安装
npm install -g plumb-mcp

# 2. 接入你的编辑器 —— 自动识别 Claude Code / Cursor / VS Code / Windsurf
plumb-mcp init

# 3. 一次性安装 Figma 插件。manifest 路径：
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
#    Figma 桌面应用 → Plugins → Development → Import plugin from manifest…
#    运行 Plumb → 点击 "Pair with Plumb" → 完成。后续运行折叠为一个小圆点。

# 4. 可选 —— 从终端直接验证渲染代码与 Figma 是否一致
plumb-mcp verify http://localhost:5173/dashboard --url <figma-url>

# …或让它自动构建并自我修正到像素级匹配（自带 ANTHROPIC_API_KEY）
plumb-mcp fit <figma-url>
```

其他安装方式：`npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [从源码构建](https://github.com/tathagat22/plumb-mcp)。

---

## 十五个工具

| 工具 | 作用 |
|---|---|
| `plumb_status` | 自描述、键名说明、连接状态。首先调用此工具。 |
| `plumb_outline` | 列出文件中每一个屏幕（id、名称、尺寸）。 |
| `plumb_node` | 将屏幕提取为紧凑的 PDS —— 通过 id 或名称。 |
| `plumb_query` | 按模式拉取子树切片（`skeleton` / `buttons` / `text` / `components`），适用于完整树会撑爆 token 预算的密集屏幕。 |
| `plumb_describe` | 仅文本的视觉描述 —— 按区域叙述 + 子节点摘要，适用于无法读取截图的代理或 token 敏感流程。 |
| `plumb_tokens` | 设计 token 表（颜色、文字、圆角、阴影）。 |
| `plumb_selection` | 用户在 Figma 中当前选中的对象。 |
| `plumb_assets` | 导出图标（SVG）和图像（PNG）—— 三种模式：递归、清单、精准 ids。 |
| `plumb_screenshot` | 将任意节点渲染为 PNG/JPG。 |
| `plumb_search` | 按名称和/或类型查找节点。 |
| `plumb_components` | 列出组件及其实例使用情况。 |
| `plumb_verify` | 将你渲染的布局与设计稿对比，返回结构化差异 —— 采用 ΔE2000 感知色差，附带阴影／旋转／弹性子节点／填充堆叠校验，不做像素比较。 |
| `plumb_fit` | 自愈循环：在 `plumb_verify` 基础上增加 0–100 收敛分数与优先级修正建议，让代理迭代到像素级匹配，而非一次性检查。 |
| `plumb_fig_outline` | 无需 Figma 桌面应用，直接从磁盘读取已保存的 `.fig` 文件并列出所有屏幕。 |
| `plumb_fig_node` | 无需 Figma 桌面应用，按 id 从已保存的 `.fig` 文件中获取一个节点。 |

---

完整文档（架构、教程、每个工具的详细说明、故障排查）位于 **<https://tathagat22.github.io/plumb-mcp/>**。

MIT © Tathagat Maitray
