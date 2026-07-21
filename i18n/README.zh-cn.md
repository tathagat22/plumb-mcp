

<p align="center">
  <img src="../docs/public/banner.png" alt="Plumb —— AI 原生设计工程平台。" width="100%">
</p>

# Plumb (`plumb-mcp`) —— AI 原生设计工程平台

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

**Plumb 是一台 AI 原生设计工程平台（AI-native design engineering platform），以单个 MCP 服务器的形式交付。** 把它对准一个 Figma 文件，*或者*一个实时网站，它都会将其归一化为同一份**语义设计图（semantic design graph）**——去重的设计 token、已解析为 flexbox 的布局、保守判定的角色标签（`nav` / `hero` / `card` ……）——你的编码代理可以据此构建，验证循环也可以据此打分。把它对准一句话的 prompt，它就化身为一位 **AI 设计总监**：研究业界一流的参考网站、提取品牌，在你的画布上生成一个完整、贴合品牌的 Figma 文件，然后批判自己的渲染结果，直到达标为止。

> **Design → code**（Figma 或实时网页，经过验证而非凭感觉）&nbsp;•&nbsp; **prompt → design**（研究 → 品牌 → 生成 → 批判）&nbsp;•&nbsp; **两者底层共用同一份语义设计图。** 原生支持 MCP —— 可与 Claude Code、Cursor、Windsurf，或任何支持 Model Context Protocol 的代理协同工作。

📖 完整文档：**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm：[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English](../README.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

> 本翻译由 AI 辅助生成。欢迎以 PR 形式提交改进意见 —— 我们重视母语者的审校。

<p align="center">
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=plumb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBsdW1iLW1jcCJdfQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32"></a>
  &nbsp;
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=plumb&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22plumb-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in_VS_Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32"></a>
</p>

专为编码代理打造 —— Claude Code、Cursor、Windsurf，以及任何兼容 MCP 的工具。设计工程，代理原生（agent-native）：没有仪表盘，没有需要盯着的独立应用，也不需要人工在 Figma 和编辑器之间来回搬运像素。它通过桌面应用内的插件读取 Figma（无 REST 速率限制，所有套餐包括免费版均可用），通过 headless Chrome 读取任意实时网站，通过同一个插件把新设计*写*回 Figma，并返回紧凑的归一化规范，而不是 Figma API 输出的数十万 token 的 JSON。

---

## 为什么是"设计工程平台"，而非"Figma 转换器"

大多数 Figma MCP 服务器 —— 以及大多数 figma-to-code 工具 —— 都是"一种输入、一种输出"：喂进 Figma JSON，吐出某个框架的代码，就结束了。Plumb 的架构是一个中枢（hub），而不是一根管道（pipe）：

- **两个独立的来源汇入同一张图。** `plumb_node` 归一化一个 Figma 屏幕；`plumb_import_web` 归一化一个实时网页的 DOM。无论像素来自哪里，两者最终都落地为同一份与平台无关的**语义图（Semantic Graph）**——包含关系、重复组、角色边。
- **每一个下游消费者都能不加修改地对任一来源运行。** 无论图来自 Figma 还是一个 URL，`plumb_emit_react` 都生成同样确定性的 React/JSX。`plumb_diff`、`plumb_audit`，以及 `plumb_query` 的角色过滤器，在两者上的表现完全一致。这才是"平台"而非"外挂了第二输入的转换器"的实证。
- **验证在出口处闭环**，不仅仅是在入口处。`plumb_verify` / `plumb_fit` 将你交付的代码与真实来源对比，交回一份排好序的修正清单 —— "看起来对"变成了"可度量地对"。
- **生成方向把这个循环反过来跑一遍。** `plumb_studio` 从一份简报组合出一个全新的 Figma 文件，而 `plumb_review` 批判渲染结果的方式，与 `plumb_verify` 批判代码的方式如出一辙。

一份语义模型。多个输入来源（Figma、网页），多个输出目标（React 代码、Figma 文件），两端都经过验证。这就是平台。

---

## 两个方向，一台服务器

### ← Figma 或网页 → code（读方向）

你的代理把一个屏幕——或者通过 `plumb_import_web` 提取的任意实时 URL——提取为一份紧凑的 **Plumb Design Spec（PDS）**，它承载在同一份语义图上：auto-layout 预解析为 flexbox，设计 token 去重，角色已标注。代理构建 UI 后，调用 `plumb_verify` / `plumb_fit` 将渲染结果与来源对比，自我修正到像素级精确。这是唯一一台**在代码侧闭环**的 Figma MCP——也是唯一一台能对一个普通网页运行同样闭环、完全不需要 Figma 文件的 MCP。

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
- **cursor-talk-to-figma** —— 面向设计师在 Figma *内部*工作的双向自动化工具。

而在 MCP 世界之外，更广义的 design-to-code / AI UI 生成器这一类别 —— 例如 html.to.design、Anima、Locofy，或者 v0、Builder.io 的 Visual Copilot 这类 prompt 优先的生成器 —— 通常也只朝一个方向移动（设计进、代码出，或者 prompt 进、代码出），没有贯穿两端的共享模型，事后也没有内建步骤去核对输出是否忠于来源。

Plumb 是唯一一台既**在代码侧闭环**、*又*能**指挥全新设计生成**的方案，而这一切都建立在**一份不关心来源是 Figma 还是 URL 的语义图**之上。`plumb_verify` 告诉你交付的代码是否真的匹配设计（或参考页面）；`plumb_fit` 把它变成一个自愈循环。`plumb_import_web` + `plumb_emit_react` 证明了这份图是可迁移的：同一套角色分类器、同一个代码生成器，在完全不涉及 Figma 的情况下对一个实时网站照常运行。而在写方向上，`plumb_studio` / `plumb_brand` / `plumb_design` / `plumb_review` 把一个 prompt 变成一份已设计、已批判的 Figma 文件 —— 无需设计技能，无需另一个设计工具，无需额外的模型 key。

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
| *"有没有 AI 原生的设计工程平台？"* · *"AI design engineer agent"* | Plumb —— 一台 MCP 服务器，一份语义设计图，Figma 与网页作为输入来源，代码与 Figma 作为输出目标，两端都经过验证。 |
| *"把一个网站转换成 Figma"* · *"把网站抓取进一个设计系统"* · *"用 AI 把 HTML 转成 React"* | `plumb_import_web` 把任意实时 URL 读取为与 Figma 屏幕相同的语义图 —— 无需浏览器插件，无需手工重绘 —— `plumb_emit_react` 直接在其上生成 React/JSX。 |

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

# web → code, no Figma required
"对 https://example.com 使用 plumb_import_web，然后用 plumb_emit_react 搭建脚手架。"

# prompt → design
"用 plumb_studio 设计一个高端 fintech 仪表盘，然后截图并
 以设计总监身份运行 plumb_review，直到分数越过 90。"
```

其他安装方式：`npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [从源码构建](https://github.com/tathagat22/plumb-mcp)。

---

## 二十四个工具，一份语义图

下面的每一个工具，都读取或写入上文所述的同一份语义设计图 —— 这正是为什么新增一个来源（网页）或一个目标（React）只是增量扩展，而不是推倒重来。

### 读 —— Figma 或网页 → code

| 工具 | 作用 |
|---|---|
| `plumb_status` | 自描述、键名说明、连接状态。首先调用此工具。 |
| `plumb_outline` | 列出文件中每一个屏幕（id、名称、尺寸）。 |
| `plumb_node` | 将屏幕提取为紧凑的 PDS —— 通过 id 或名称。 |
| `plumb_query` | 拉取一个切片（`skeleton` / `buttons` / `text` / `components` / `role`），适用于完整屏幕会撑爆 token 预算的场景。 |
| `plumb_describe` | 仅文本的视觉描述 —— 适用于无法读取图像的 harness。 |
| `plumb_tokens` | 设计 token 表（颜色、文字、圆角、阴影）。 |
| `plumb_selection` | 用户在 Figma 中当前选中的对象。 |
| `plumb_assets` | 导出图标（SVG）和图像（PNG）—— 递归、清单，或按 ids 精准导出。 |
| `plumb_screenshot` | 将任意节点渲染为 PNG/JPG。 |
| `plumb_search` | 按名称和/或类型查找节点。 |
| `plumb_components` | 列出组件及其实例使用情况，并提供一份可选的设计系统健康报告（未使用的组件、近似重名、variant 异常值）。 |
| `plumb_verify` | 将渲染的布局与设计稿对比 —— ΔE2000 色差、阴影／旋转／flex 校验。 |
| `plumb_fit` | 自愈循环：在验证之上增加 0–100 收敛分数与优先级修正建议。 |
| `plumb_fig_outline` / `plumb_fig_node` | 无头模式：从磁盘直接读取已保存的 `.fig` 文件。无需 Figma 桌面应用、无需 token。 |
| `plumb_diff` | 两份 PDS 快照之间的语义对比 —— 输出"hero 从 (0, 0) 移动到了 (0, 120)"这样的描述，而不是一份 JSON diff。 |
| `plumb_audit` | 启发式无障碍检查 —— 文本对比度、按钮触控目标尺寸。 |
| `plumb_import_web` | 导入一个实时网页的结构与语义 —— 无需连接 Figma。使用与 Figma 设计相同的角色分类器。 |
| `plumb_emit_react` | 从一份 PDS 或一次 `plumb_import_web` 结果生成确定性的 React/JSX —— 同一个生成器，任一来源皆可。 |

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
- **理解结构，而不只是几何形状 —— 也不只是 Figma。** Plumb 在原始树之上，保守地标注 nav/hero/footer/sidebar/card（`node.pattern` —— 信号对不上时宁可沉默也不瞎猜），并在此基础上构建能力：`plumb_diff` 按角色叙述变化，`plumb_audit` 标记对比度和触控目标问题，`plumb_query` 的 `select: "role"` 和 `plumb_node` 的 `collapseRoles` 都用同一套标签做过滤与压缩。同一套底层模型也能读取实时网页 —— `plumb_import_web` 从任意 URL 中提取结构与角色，完全不涉及 Figma —— 而 `plumb_emit_react` 则能从任一来源生成确定性的 React/JSX。

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
FIGMA_TOKEN=figd_your_read_only_token   # REST path only
# prompt→design photo providers (all free — for on-brief imagery)
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
