# Plumb (`plumb-mcp`)

**AI コーディングエージェント向けの Figma MCP サーバー — Claude Code、Cursor、Windsurf、その他 Model Context Protocol 対応の AI コーディングツールと組み合わせて使用。**

📖 ドキュメント：**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm：[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](./README.md) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

> この翻訳は AI 支援によって生成されています。改善提案は PR で歓迎します — ネイティブ話者のレビューを大切にしています。

Plumb は Figma デスクトップアプリ内で動作するコンパニオンプラグインを通じて Figma ファイルを読み取ります。REST のレート制限なし、課金なし、プラン制限なし。Figma API が出力する数十万トークンの JSON ではなく、コンパクトで正規化された設計仕様を返します。アイコンは SVG として、画像は PNG として、必要な時にディスクへ書き出します。Free プランを含む任意の Figma プランで動作します。

---

## クイックスタート

### サーバーのインストール

```bash
# npm（推奨）
npm install -g plumb-mcp

# またはインストールせずに実行
npx plumb-mcp

# または Docker（マルチアーキテクチャ — amd64 + arm64）
docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest
```

### Figma プラグインのサイドロード

プラグインは npm パッケージと Docker イメージに同梱されています。マニフェストの場所を確認：

```bash
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
```

Figma デスクトップアプリで：**Plugins → Development → Import plugin from manifest…** を選択し、上記のパスを指定。

**Plumb** プラグインを実行し、**Pair with Plumb** をクリック。ペアリング後、プラグインは小さなドットに折りたたまれます。

---

## 他の Figma MCP サーバーとの比較

| 機能 | Plumb | Figma 公式 Dev Mode MCP | Framelink | claude-talk-to-figma |
|---|---|---|---|---|
| ツール数 | **12** | 少数 | 2 | 少数 |
| Figma Free プランでの動作 | ✅ | 制限あり | ✅（Variables 除く） | ✅ |
| 読み取り方法 | プラグイン · REST · `.fig` | REST | REST | プラグイン |
| プラグイン経由のレート制限 | **なし** | n/a | n/a | なし |
| 非 Enterprise プランでの Variables | ✅（プラグイン経由） | 制限あり | ❌ | ✅ |
| Figma への書き戻し | ❌ | ✅ | ❌ | ✅ |
| デザインとコードの差分（`verify`） | ✅ | ❌ | ❌ | ❌ |
| 選択状態のリアルタイム認識 | ✅ | ✅ | ❌ | ✅ |
| コンポーネント / インスタンス一覧 | ✅ | 一部 | ❌ | 一部 |
| CI 向けオフライン `.fig` パース | ✅ | ❌ | ❌ | ❌ |
| トークン節約型 PDS（auto-layout → flex、重複排除） | ✅ | ❌ | 一部 | ❌ |
| ローカル動作、テレメトリなし | ✅ | クラウド | ✅ | ✅ |
| トランスポート | stdio | stdio | stdio + HTTP/SSE | stdio |
| ライセンス | MIT | プロプライエタリ | MIT | MIT |

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
