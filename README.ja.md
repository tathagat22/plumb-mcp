<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI コーディング、配管完了。" width="100%">
</p>

# Plumb (`plumb-mcp`)

**検証ループ付きの Figma → コード MCP。** デザインを入力すると正規化された仕様が出力され、`plumb-mcp verify` がヘッドレス Chrome を駆動してレンダリングされたコードが本当に Figma のデザインと一致するかを証明します。

📖 ドキュメント：**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm：[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](./README.md) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

> この翻訳は AI 支援によって生成されています。改善提案は PR で歓迎します — ネイティブ話者のレビューを大切にしています。

コーディングエージェント専用 — Claude Code、Cursor、Windsurf、MCP 互換ツールなら何でも。Figma デスクトップアプリ内で動作するコンパニオンプラグインを通じて Figma ファイルを読み取ります（REST レート制限なし、Free を含む全プランで動作）。Figma API が出力する数十万トークンの JSON ではなく、コンパクトで正規化された設計仕様を返し、SVG アイコンと PNG 画像を必要に応じて直接ディスクに書き出します。

---

## Plumb と他の Figma MCP の違い

知っておく価値のある他の Figma MCP サーバーは三つ：

- **Figma 公式 Dev Mode MCP** — 双方向（Figma に書き戻せる）だが、プラン制限があり、課金される。
- **Framelink** — 軽量 REST ラッパー。ツール 2 個。検証なし、レート制限を継承。
- **cursor-talk-to-figma** — Figma 内で作業するデザイナー向けの双方向自動化ツール。

Plumb は**コード側でループを閉じる**唯一の選択肢。`plumb_verify`（MCP ツール）と `plumb-mcp verify`（CLI）が、エージェントが出力したコードが実際にデザインと一致するかを教えてくれます — カラーコード付きの delta、ピクセル比較なし、CI で実行可能。

---

## クイックスタート

```bash
# 1. インストール
npm install -g plumb-mcp

# 2. エディタに接続 — Claude Code / Cursor / VS Code / Windsurf を自動検出
plumb-mcp init

# 3. Figma プラグインを一度だけサイドロード。マニフェストの場所：
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
#    Figma デスクトップ → Plugins → Development → Import plugin from manifest…
#    Plumb を実行 → "Pair with Plumb" をクリック → 完了。次回以降は小さなドットに折りたたまれます。

# 4. 任意 — ターミナルからレンダリングされたコードを Figma と検証
plumb-mcp verify http://localhost:5173/dashboard --url <figma-url>
```

他のインストール方法：`npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [ソースからビルド](https://github.com/tathagat22/plumb-mcp)。

---

## 12 個のツール

| ツール | 機能 |
|---|---|
| `plumb_status` | 自己記述、キー凡例、接続状態。最初に呼び出すツール。 |
| `plumb_outline` | ファイル内のすべての画面（id、名前、サイズ）。 |
| `plumb_node` | 画面をコンパクトな PDS として抽出 — id または名前で指定。 |
| `plumb_tokens` | デザイントークンテーブル（色、書式、角丸、シャドウ）。 |
| `plumb_selection` | Figma 上でユーザーが現在選択している対象。 |
| `plumb_assets` | アイコン（SVG）と画像（PNG）をエクスポート — 3 つのモード：再帰、リスト、特定 ids。 |
| `plumb_screenshot` | 任意のノードを PNG/JPG にレンダリング。 |
| `plumb_search` | 名前および/または種類でノードを検索。 |
| `plumb_components` | コンポーネントとインスタンス使用箇所をリスト。 |
| `plumb_verify` | レンダリング済みレイアウトをデザインと比較 — 構造化された差分を返す。 |
| `plumb_fig_outline` | Figma デスクトップなしで、保存された `.fig` ファイルからすべての画面を列挙。 |
| `plumb_fig_node` | Figma デスクトップなしで、保存された `.fig` ファイルから id 指定でノードを取得。 |

---

アーキテクチャ、レシピ、各ツールの詳細リファレンス、トラブルシューティングを含む完全なドキュメントは **<https://tathagat22.github.io/plumb-mcp/>** にあります。

MIT © Tathagat Maitray
