

<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI コーディング、双方向に配管完了。" width="100%">
</p>

# Plumb (`plumb-mcp`) — 双方向の Figma MCP：デザイン → コード、そしてプロンプト → デザイン

<p align="center">
  <a href="https://github.com/tathagat22/plumb-mcp"><img alt="GitHub stars" src="https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

<p align="center"><b>⭐ Plumb がトークンを節約してくれたら — あるいはページをデザインしてくれたら — <a href="https://github.com/tathagat22/plumb-mcp">GitHub でスターを</a>。他の人が見つけられるように。</b></p>

**Plumb は双方向に動く Figma MCP サーバーです。** デザインに向ければ、コーディングエージェントがそこからビルドできるコンパクトで正規化された仕様を返し、検証ループでコードがデザインと一致することを証明します。*プロンプト* に向ければ、**AI デザインディレクター** に変貌します：ベストインクラスの実在するリファレンスサイトをリサーチし、ブランドを抽出し、**あなたのキャンバス上に完全でブランドに沿った Figma デザインを生成**します — そして自らのレンダリングを批評し、良くなるまで反復します。

> **Figma → コード**（抽出・検証・自己修復） &nbsp;•&nbsp; **プロンプト → デザイン**（リサーチ → ブランド → 生成 → 批評）。1 つの MCP サーバーで、両方向。

📖 ドキュメント：**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm：[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](./README.md) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

<p align="center">
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=plumb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBsdW1iLW1jcCJdfQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32"></a>
  &nbsp;
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=plumb&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22plumb-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in_VS_Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32"></a>
</p>

> この翻訳は AI 支援によって生成されています。改善提案は PR で歓迎します — ネイティブ話者のレビューを大切にしています。

コーディングエージェント専用 — Claude Code、Cursor、Windsurf、MCP 互換ツールなら何でも。Figma デスクトップアプリのプラグインを通じて Figma を読み取り（REST レート制限なし、Free を含む全プランで動作）、同じプラグインを通じて新しいデザインを *書き戻し*、Figma API が出力する数十万トークンの JSON ではなく、コンパクトで正規化された仕様を返します。

---

## 二つの方向、一つのサーバー

### ← Figma → コード（読み取り方向）
エージェントは画面をコンパクトな **Plumb Design Spec (PDS)** として抽出し（auto-layout は flexbox に事前解決、デザイントークンは重複排除済み）、UI をビルドし、その後 `plumb_verify` / `plumb_fit` を呼び出してレンダリング結果をデザインと比較し、ピクセル単位で一致するまで自己修正します。**コード側でループを閉じる**唯一の Figma MCP です。

### → プロンプト → デザイン（書き込み方向 — デザインディレクター）
Plumb に一行のブリーフを渡すと — *「プレミアムなフィンテックのダッシュボード」* — シニアデザイナーがあなたの Figma の中でライブで作業するように振る舞います：

1. **リファレンスをリサーチ** — ブリーフに合うベストインクラスのサイト（Linear、Stripe、Mercury…）を見つけ、References ページに**ライブでスクリーンショットを撮影**します。
2. **ブランドを抽出** — それらの計算済み CSS を読み取り、一貫したパレット + タイプスケールへ落とし込み、Brand ボードとして配置します。
3. **デザインを生成** — 高レベルのデザイン DSL から完全でブランドに沿ったページ（ナビ、ヒーロー、機能、ギャラリー、CTA、フッター）を構成し、実際の Figma ノードとしてビルドします。
4. **自らのレンダリングを批評** — 呼び出し元のエージェント（Claude Code / ビジョン対応の任意の MCP クライアント — **追加の API キーは不要**）がスクリーンショットを採点します。Plumb はそれを決定論的なデザインルーブリックと構造差分とブレンドし、優先順位付けされた修正リストを返して、基準をクリアするまで反復します。

これが**プロンプトからの Figma デザイン生成 + 自己改善するディレクターループ**です — 一発モックアップではありません。

---

## Plumb と他の Figma MCP の違い

知っておく価値のある他の Figma MCP サーバー：

- **Figma 公式 Dev Mode MCP** — 双方向だが、プラン制限があり、課金される。
- **Framelink** — 軽量 REST ラッパー。ツール 2 個。検証なし、レート制限を継承。
- **cursor-talk-to-figma** — Figma 内で作業するデザイナー向けの双方向自動化ツール。

**コード側でループを閉じる** *と同時に* **新しいデザイン生成をディレクションする**のは Plumb だけです。`plumb_verify` は、出荷したコードが実際にデザインと一致するかを教えてくれます。`plumb_fit` はそれを自己修復ループに変えます。そして書き込み側では、`plumb_studio` / `plumb_brand` / `plumb_design` / `plumb_review` が、プロンプトを、デザインされ批評された Figma ファイルへと変えます — デザインスキルも、別のデザインツールも、追加のモデルキーも不要です。

---

## こんなエラーに遭遇していませんか?

エラーから辿り着いた場合、Plumb で大抵解決します。

| 表示されているエラー | Plumb で解決できる理由 |
|---|---|
| `Figma Dev Mode MCP exceeded the 25k token cap` · `351,378 tokens observed` | PDS はデザイントークン(`$c1`、`$t1` …)を重複排除し、auto-layout を flexbox に事前解決します。178 ノードのダイアログが ~2.6k トークンで返ります。 |
| `Dev Mode MCP: 6 tool calls per month limit` · `Starter plan tool-call limit reached` | Plumb のプラグイン経路は、Free を含む全プランで呼び出しあたりの上限なし。 |
| `Framelink figma-developer-mcp HTTP 429` · `Figma REST API rate limit exceeded` | プラグイン経路は REST を経由しないため、レート制限ゼロ。 |
| `Variables API requires Enterprise plan` · `403 Forbidden on variables` | Plumb は Figma プラグイン API 経由で Variables を読み取ります — 全プランで動作。 |
| `Figma MCP returned 85% wrong layout` · 幻覚レイアウト | Plumb はパース済みの散文ではなく構造化 PDS を返し、レンダリング済み DOM とデザインを比較する `plumb_verify` + `plumb-mcp verify` CLI を同梱。 |
| *「プロンプトから Figma デザインを生成するには?」* · *「Figma で UI をデザインする AI」* | `plumb_studio` — ブリーフ → リサーチされたリファレンス → 抽出されたブランド → 批評・改善済みの完全に構成された Figma ページ。 |

インストール:`npm install -g plumb-mcp` → `plumb-mcp init`。

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
```

**そして、エージェント内で：**

```txt
# Figma → コード
"Plumb で Settings 画面を抽出してビルドし、一致するまで plumb_fit を回して。"

# プロンプト → デザイン
"plumb_studio でプレミアムなフィンテックのダッシュボードをデザインして、スクリーンショットを撮り、
 スコアが 90 を超えるまでディレクターとして plumb_review を回して。"
```

他のインストール方法：`npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [ソースからビルド](https://github.com/tathagat22/plumb-mcp)。

---

## 20 個の MCP ツール

### 読み取り — Figma → コード

| ツール | 機能 |
|---|---|
| `plumb_status` | 自己記述、キー凡例、接続状態。最初に呼び出すツール。 |
| `plumb_outline` | ファイル内のすべての画面（id、名前、サイズ）。 |
| `plumb_node` | 画面をコンパクトな PDS として抽出 — id または名前で指定。 |
| `plumb_query` | スライスを取得（`skeleton` / `buttons` / `text` / `components`）— 画面全体がトークン予算を超えてしまう場合に使用。 |
| `plumb_describe` | テキストのみの視覚的記述 — 画像を読めないハーネス向け。 |
| `plumb_tokens` | デザイントークンテーブル（色、書式、角丸、シャドウ）。 |
| `plumb_selection` | Figma 上でユーザーが現在選択している対象。 |
| `plumb_assets` | アイコン（SVG）と画像（PNG）をエクスポート — 再帰、リスト、または特定 ids でピンポイント。 |
| `plumb_screenshot` | 任意のノードを PNG/JPG にレンダリング。 |
| `plumb_search` | 名前および/または種類でノードを検索。 |
| `plumb_components` | コンポーネントとインスタンス使用箇所をリスト。 |
| `plumb_verify` | レンダリング済みレイアウトをデザインと比較 — ΔE2000 色差、シャドウ／回転／フレックスのチェック。 |
| `plumb_fit` | 自己修復ループ：検証 + 0〜100 の収束スコア + 優先順位付きの修正提案。 |
| `plumb_fig_outline` / `plumb_fig_node` | ヘッドレス：保存された `.fig` ファイルをディスクから読み取り。Figma デスクトップ不要、トークン不要。 |

### 書き込み — プロンプト → デザイン（ディレクター）

| ツール | 機能 |
|---|---|
| `plumb_studio` | **デザインディレクター。** 1 つのブリーフ → リサーチされたリファレンス → 抽出されたブランド → 完全に構成された Figma ページ。批評・改善できるようノード id + 生成された仕様を返します。 |
| `plumb_brand` | ブリーフ → ベストインクラスのリファレンスサイトのライブスクリーンショット + キャンバス上に合成されたブランドパレット／タイプボード。 |
| `plumb_design` | Plumb の高レベルなデザイン DSL からデザインを生成し、Figma にビルド（ページ、セクション、コンポーネント、モーションまで完全制御）。 |
| `plumb_review` | 批評ループ：構造差分、決定論的なデザインルーブリック、そして呼び出し元エージェント自身のビジョン判定を、1 つのスコア + 優先順位付き修正へブレンド。**API キー不要** — MCP サーバーを駆動しているエージェント自身がクリエイティブディレクターです。 |
| `plumb_source` | デザインのためのブリーフに沿ったアセット（アイコン、写真、イラスト、パターン）を解決。 |

---

## トークンと品質で勝てる理由

- **コンパクトな仕様。** Figma REST JSON で 351k トークンになる 178 ノードのダイアログが、~2.6k トークンの PDS で返ります — トークン重複排除、flexbox 解決済みレイアウト、深さ安定なハンドル。
- **雰囲気ではなく検証済み。** `plumb_verify` / `plumb_fit` は *レンダリング済み* 結果をデザインと比較します（ΔE2000 知覚色差、シャドウ、回転、フレックス子要素、塗りスタック）— ピクセル比較なし、CI で実行可能。
- **デフォルトではなくデザイン済み。** 書き込み方向は本物のデザインの技巧を組み込みます：サイズに応じた字間、ゆとりあるセクションのリズム、実在リファレンスから抽出したブランドパレット、グラデーションテキスト、フルブリードと非対称レイアウト、そしてレンダリングを採点し押し上げるビジョンベースのディレクター。

---

## 二つのデータ経路

| | プラグイン（主） | REST（副、ヘッドレス） |
|---|---|---|
| レート制限 | **なし。** メモリ上のドキュメントを読み取り。 | あり。Free/Starter は非常に低い予算。 |
| トークン必須 | いいえ。 | はい — `FIGMA_TOKEN`。 |
| Variables | **はい**、全プラン。 | いいえ — Variables REST は Enterprise 限定。 |
| 書き込み（デザイン生成） | **はい。** | いいえ。 |
| ヘッドレス / CI | いいえ（Figma を開く必要あり）。 | はい。 |

ツールが経路を自動選択します。プラグインをペアリングしていれば、`fileKey` を省略して `id` または `name` を渡すだけです。

---

## 設定

`.env`（gitignore 対象 — 秘密情報は絶対にコミットしないこと。Plumb は起動時に読み込みます）：

```bash
FIGMA_TOKEN=figd_your_read_only_token   # REST 経路のみ
# プロンプト→デザインの写真プロバイダー（すべて無料 — ブリーフに沿った画像用）
UNSPLASH_ACCESS_KEY=…
PEXELS_API_KEY=…
PIXABAY_API_KEY=…
```

- **キャッシュ** — `~/.cache/plumb/v1/`（`PLUMB_CACHE_DIR` で上書き）。
- **アセット** — `./plumb-assets/<screen>/` · **スクリーンショット** — `./plumb-screenshots/`。

---

## セキュリティ

- ループバック限定の WebSocket ブリッジ。同時にペアリングできるプラグインは 1 つだけ（意図的なクリック 1 回）。
- テレメトリゼロ。プラグイン経路にパーソナルアクセストークンは不要。
- 書き込み方向は外部モデルを一切呼び出しません — すでに MCP サーバーを駆動している AI エージェントがデザインの判断を行います。

---

## コントリビューション

コントリビューション歓迎 — タイポ修正から新しい検証チェック、デザインディレクターの改良まで。[`CONTRIBUTING.md`](./CONTRIBUTING.md) を参照。はじめての方は [`good first issue`](https://github.com/tathagat22/plumb-mcp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) ラベルをどうぞ。

---
[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/tathagat22-plumb-mcp-badge.png)](https://mseep.ai/app/tathagat22-plumb-mcp)
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/a9f8a315-d08c-48df-a817-c65ed22c2730)

## ライセンス

MIT © Tathagat Maitray. [`LICENSE`](./LICENSE) を参照。
