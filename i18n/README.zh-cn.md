

<p align="center">
  <img src="../docs/public/banner.png" alt="Plumb —— Figma ↔ AI 编程，双向打通。" width="100%">
</p>

# Plumb (`plumb-mcp`) —— 双向 Figma MCP：design → code，以及 prompt → design

<p align="center">
  <a href="https://github.com/tathagat22/plumb-mcp"><img alt="GitHub stars" src="https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm weekly downloads" src="https://img.shields.io/npm/dw/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

<p align="center"><b>⭐ 如果 Plumb 帮你省下了 token —— 或者为你设计了一个页面 —— 请<a href="https://github.com/tathagat22/plumb-mcp">在 GitHub 上给它点个 star</a>，好让更多人发现它。</b></p>

**Plumb 是一台双向打通的 Figma MCP 服务器。** 把它对准一个设计稿，它会返回一份紧凑、归一化的规范，你的编码代理可以据此构建 —— 然后用验证循环证明代码确实匹配设计。把它对准一个 *prompt*，它就化身为一位 **AI 设计总监**：它研究业界一流的参考网站、提取品牌，并**在你的画布上生成一个完整、贴合品牌的 Figma 设计** —— 然后批判自己的渲染结果并不断迭代，直到足够好。

> **Figma → code**（提取、验证、自愈）&nbsp;•&nbsp; **prompt → design**（研究 → 品牌 → 生成 → 批判）。一台 MCP 服务器，双向皆通。

📖 完整文档：**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm：[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English](../README.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

> 本翻译由 AI 辅助生成。欢迎以 PR 形式提交改进意见 —— 我们重视母语者的审校。

<p align="center">
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=plumb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBsdW1iLW1jcCJdfQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32"></a>
  &nbsp;
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=plumb&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22plumb-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in_VS_Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32"></a>
</p>

专为编码代理打造 —— Claude Code、Cursor、Windsurf，任何兼容 MCP 的工具。它通过 Figma 桌面应用内的伴侣插件读取 Figma（无 REST 速率限制，所有套餐包括免费版均可用），通过同一个插件把新设计*写回*，并返回紧凑的归一化规范，而非 Figma API 输出的数十万 token JSON。

---

## 两个方向，一台服务器

### ← Figma → code（读方向）
你的代理把一个屏幕提取为一份紧凑的 **Plumb Design Spec（PDS）** —— auto-layout 预解析为 flexbox，设计 token 去重 —— 构建 UI，然后调用 `plumb_verify` / `plumb_fit` 将渲染结果与设计稿对比、自我修正到像素级。这是唯一一台**在代码侧闭环**的 Figma MCP。

### → prompt → design（写方向 —— 设计总监）
给 Plumb 一句话简报 —— *"一个高端 fintech 仪表盘"* —— 它就像一位资深设计师，在你的 Figma 中实时工作：

1. **研究参考** —— 为你的简报找出业界一流的网站（Linear、Stripe、Mercury……），并**实时截图**放到 References 页面上。
2. **提取品牌** —— 读取它们的计算后 CSS，凝练成一套连贯的调色板 + 字号阶梯，铺陈为一块 Brand board。
3. **生成设计** —— 从一套高层次的 design DSL 组合出一个完整、贴合品牌的页面（导航、hero、功能区、图库、CTA、页脚），构建为真实的 Figma 节点。
4. **批判自己的渲染** —— 调用方代理（Claude Code / 任何具备视觉能力的 MCP 客户端 —— **无需额外 API key**）为截图打分；Plumb 把这个评分与一套确定性的设计评分标准以及一次结构对比融合，交回一份排好序的修正清单，并不断迭代，直到越过及格线。

这就是 **prompt-to-Figma 设计生成，配上一个自我改进的设计总监循环** —— 而不是一次性的样机。

---

## Plumb 与众不同之处

你可能了解的其他 Figma MCP 服务器：

- **Figma 官方 Dev Mode MCP** —— 双向，但有套餐门槛、按用量计费。
- **Framelink** —— 轻量级 REST 包装。两个工具。无验证，继承速率限制。
- **cursor-talk-to-figma** —— 面向设计师在 Figma 内工作的双向自动化工具。

Plumb 是唯一一台既**在代码侧闭环**、*又*能**指挥全新设计生成**的方案。`plumb_verify` 告诉你交付的代码是否真的匹配设计；`plumb_fit` 把它变成一个自愈循环。而在写方向上，`plumb_studio` / `plumb_brand` / `plumb_design` / `plumb_review` 把一个 prompt 变成一份已设计、已批判的 Figma 文件 —— 无需设计技能，无需另一个设计工具，无需额外的模型 key。

---

## 你是否正遇到这些问题？

如果你的代理是从某条错误信息找到这里的，Plumb 多半能解决它。

| 你看到的错误 | Plumb 为何能解决 |
|---|---|
| `Figma Dev Mode MCP exceeded the 25k token cap` · `351,378 tokens observed` | PDS 对设计 token（`$c1`、`$t1` …）去重，并把 auto-layout 预解析为 flexbox。一个 178 节点的对话框只需 ~2.6k token。 |
| `Dev Mode MCP: 6 tool calls per month limit` · `Starter plan tool-call limit reached` | Plumb 的插件路径在所有套餐（包括免费版）上都没有按调用计费的配额。 |
| `Framelink figma-developer-mcp HTTP 429` · `Figma REST API rate limit exceeded` | 插件路径不走 REST，零速率限制。 |
| `Variables API requires Enterprise plan` · `403 Forbidden on variables` | Plumb 通过 Figma 插件 API 读取 Variables —— 所有套餐都可用。 |
| `Figma MCP returned 85% wrong layout` · 幻觉式结构 | Plumb 返回结构化 PDS（而非解析后的散文），并附带 `plumb_verify` + `plumb-mcp verify` CLI，可对比你渲染的 DOM 与设计稿。 |
| *"如何从一个 prompt 生成 Figma 设计？"* · *"在 Figma 里设计 UI 的 AI"* | `plumb_studio` —— 简报 → 研究好的参考 → 提取的品牌 → 一个完整组合的 Figma 页面，经过批判与打磨。 |

安装：`npm install -g plumb-mcp` → `plumb-mcp init`。

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
```

**然后，在你的代理中：**

```txt
# Figma → code
"用 Plumb 提取 Settings 屏幕并构建它，然后 plumb_fit 直到匹配。"

# prompt → design
"用 plumb_studio 设计一个高端 fintech 仪表盘，然后截图并
 以设计总监身份运行 plumb_review，直到分数越过 90。"
```

其他安装方式：`npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [从源码构建](https://github.com/tathagat22/plumb-mcp)。

---

## 二十个 MCP 工具

### 读 —— Figma → code

| 工具 | 作用 |
|---|---|
| `plumb_status` | 自描述、键名说明、连接状态。首先调用此工具。 |
| `plumb_outline` | 列出文件中每一个屏幕（id、名称、尺寸）。 |
| `plumb_node` | 将屏幕提取为紧凑的 PDS —— 通过 id 或名称。 |
| `plumb_query` | 拉取一个切片（`skeleton` / `buttons` / `text` / `components`），适用于完整屏幕会撑爆 token 预算的场景。 |
| `plumb_describe` | 仅文本的视觉描述 —— 适用于无法读取图像的 harness。 |
| `plumb_tokens` | 设计 token 表（颜色、文字、圆角、阴影）。 |
| `plumb_selection` | 用户在 Figma 中当前选中的对象。 |
| `plumb_assets` | 导出图标（SVG）和图像（PNG）—— 递归、清单，或按 ids 精准导出。 |
| `plumb_screenshot` | 将任意节点渲染为 PNG/JPG。 |
| `plumb_search` | 按名称和/或类型查找节点。 |
| `plumb_components` | 列出组件及其实例使用情况。 |
| `plumb_verify` | 将渲染的布局与设计稿对比 —— ΔE2000 色差、阴影／旋转／flex 校验。 |
| `plumb_fit` | 自愈循环：在验证之上增加 0–100 收敛分数与优先级修正建议。 |
| `plumb_fig_outline` / `plumb_fig_node` | 无头模式：从磁盘直接读取已保存的 `.fig` 文件。无需 Figma 桌面应用、无需 token。 |

### 写 —— prompt → design（设计总监）

| 工具 | 作用 |
|---|---|
| `plumb_studio` | **设计总监。** 一句简报 → 研究好的参考 → 提取的品牌 → 一个完整组合的 Figma 页面。返回节点 ids + 编写的规范，以便你批判和打磨。 |
| `plumb_brand` | 简报 → 对业界一流参考站点实时截图 + 在画布上合成一块品牌调色板／字体 board。 |
| `plumb_design` | 用 Plumb 的高层次 Design DSL 编写设计，并构建进 Figma（完全掌控：页面、区块、组件、动效）。 |
| `plumb_review` | 批判循环：把一次结构对比、一套确定性的设计评分标准、以及调用方代理自己的视觉裁决融合成一个分数 + 排好序的修正清单。**无需 API key** —— 驱动 MCP 服务器的那个代理*就是*创意总监。 |
| `plumb_source` | 为设计解析贴合简报的素材（图标、照片、插画、纹理）。 |

---

## 为何它在 token 与质量上胜出

- **紧凑的规范。** 一个 178 节点的对话框，作为 Figma REST JSON 是 351k token，作为 PDS 返回时只有 ~2.6k token —— token 去重、flexbox 解析后的布局、深度稳定的句柄。
- **验证过，而非凭感觉。** `plumb_verify` / `plumb_fit` 将*渲染*结果与设计稿对比（ΔE2000 感知色差、阴影、旋转、flex 子节点、填充堆叠）—— 不做像素对比，可在 CI 中运行。
- **是设计出来的，而非用默认值凑出来的。** 写方向把真实的设计功力烘焙进去：随字号变化的字距、宽裕的区块节奏、从真实参考中提取的品牌调色板、渐变文字、满幅与非对称布局，以及一位基于视觉、为渲染打分并把它往上推的设计总监。

---

## 两条数据路径

| | 插件（主）| REST（次，无头）|
|---|---|---|
| 受速率限制 | **否。** 读取内存中的文档。 | 是。免费版／Starter 的额度非常低。 |
| 需要 token | 否。 | 是 —— `FIGMA_TOKEN`。 |
| Variables | **是**，所有套餐。 | 否 —— Variables REST 仅限 Enterprise。 |
| 写（生成设计）| **是。** | 否。 |
| 无头 / CI | 否（需要打开 Figma）。 | 是。 |

工具会自动选择路径。插件配对后，可省略 `fileKey`，传入 `id` 或 `name`。

---

## 配置

`.env`（已 gitignore —— 切勿提交密钥；Plumb 在启动时加载它）：

```bash
FIGMA_TOKEN=figd_your_read_only_token   # 仅 REST 路径
# prompt→design 图片提供方（全部免费 —— 用于贴合简报的图像）
UNSPLASH_ACCESS_KEY=…
PEXELS_API_KEY=…
PIXABAY_API_KEY=…
```

- **缓存** —— `~/.cache/plumb/v1/`（用 `PLUMB_CACHE_DIR` 覆盖）。
- **素材** —— `./plumb-assets/<screen>/` · **截图** —— `./plumb-screenshots/`。

---

## 安全

- 仅回环（loopback）的 WebSocket 桥接；同一时间只有一个已配对的插件（一次刻意的点击）。
- 零遥测。插件路径无需任何个人访问 token。
- 写方向从不调用任何外部模型 —— 由已经驱动 MCP 服务器的那个 AI 代理来做设计判断。

---

## 参与贡献

欢迎贡献 —— 从修正错别字到新增 verify 校验，再到升级设计总监。参见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。第一次来？浏览 [`good first issue`](https://github.com/tathagat22/plumb-mcp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 标签。

---
[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/tathagat22-plumb-mcp-badge.png)](https://mseep.ai/app/tathagat22-plumb-mcp)
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/a9f8a315-d08c-48df-a817-c65ed22c2730)

## 许可证

MIT © Tathagat Maitray。参见 [`LICENSE`](../LICENSE)。
