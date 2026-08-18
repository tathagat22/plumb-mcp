

<p align="center">
  <img src="../docs/public/banner.png" alt="Plumb — AIネイティブなデザインエンジニアリングプラットフォーム。" width="100%">
</p>

# Plumb (`plumb-mcp`) — AIネイティブなデザインエンジニアリングプラットフォーム

<p align="center">
  <a href="https://github.com/tathagat22/plumb-mcp"><img alt="GitHub stars" src="https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm weekly downloads" src="https://img.shields.io/npm/dw/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

<p align="center"><b>⭐ Plumb がトークンを節約してくれたら — あるいはページをデザインしてくれたら — <a href="https://github.com/tathagat22/plumb-mcp">GitHub でスターを</a>。他の人が見つけられるように。</b></p>

**Plumb は、単一の MCP サーバーとして提供される AIネイティブなデザインエンジニアリングプラットフォームです。** Figma ファイル *または* 実際に稼働しているウェブサイトを指定すると、どちらも同じ **セマンティックデザイングラフ**(重複排除されたトークン、flexbox に解決済みのレイアウト、控えめな役割ラベル — `nav` / `hero` / `card` など)へと正規化します。これはコーディングエージェントがそこからビルドでき、検証ループが採点できる形式です。代わりに一行のプロンプトを渡せば、Plumb は **AI デザインディレクター** に変わります — ベストインクラスのリファレンスをリサーチし、ブランドを抽出し、あなたのキャンバス上に完全でブランドに沿った Figma ファイルを生成し、その後は自らのレンダリングを批評して、基準をクリアするまで改善を続けます。

> **デザイン → コード**(Figma でも実サイトでも、雰囲気ではなく検証済み) &nbsp;•&nbsp; **プロンプト → デザイン**(リサーチ → ブランド → 生成 → 批評) &nbsp;•&nbsp; **その両方の土台にある、1 つのセマンティックデザイングラフ。** MCP ネイティブ — Claude Code、Cursor、Windsurf、そして Model Context Protocol を話すあらゆるエージェントで動作します。

📖 ドキュメント:**<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm:[`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](../README.md) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇰🇷 [한국어](./README.ko.md)

<p align="center">
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=plumb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBsdW1iLW1jcCJdfQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32"></a>
  &nbsp;
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=plumb&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22plumb-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in_VS_Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32"></a>
</p>

コーディングエージェント向けに設計 — Claude Code、Cursor、Windsurf、MCP 互換ならなんでも。デザインエンジニアリングをエージェントネイティブに:ダッシュボードもなく、見守るための別アプリもなく、Figma とエディタの間でピクセルを人手で運ぶ必要もありません。Figma はデスクトップアプリのプラグイン経由で読み取り(REST のレート制限なし、Free を含む全プランで動作)、任意の実サイトはヘッドレス Chrome 経由で読み取り、同じプラグインを通じて新しいデザインを Figma に *書き戻し*、Figma API が出力する数十万トークンの JSON の代わりにコンパクトで正規化された仕様を返します。

---

## なぜ「デザインエンジニアリングプラットフォーム」であって「Figma コンバーター」ではないのか

ほとんどの Figma MCP サーバー — そして figma-to-code ツール全般 — は「一つの形が入って、一つの形が出る」だけです:Figma の JSON が入り、特定フレームワークのコードが出て、それで終わりです。Plumb のアーキテクチャは、パイプではなくハブです:

- **2 つの独立したソースが同じグラフに流れ込みます。** `plumb_node` は Figma の画面を正規化し、`plumb_import_web` は実サイトの DOM を正規化します。どちらも、ピクセルの出どころに関係なく、同じプラットフォーム非依存の **セマンティックグラフ**(包含関係・反復グループ・役割のエッジ)として着地します。
- **どちらのソースに対しても、消費側のツールは無改造で動きます。** `plumb_emit_react` は、グラフが Figma 由来でも URL 由来でも、同じ決定論的な React/JSX を生成します。`plumb_diff`、`plumb_audit`、そして `plumb_query` の役割フィルターは、両方でまったく同じように動作します。これは、後付けの第二入力を持つコンバーターではなく、本物のプラットフォームであることの具体的な証拠です。
- **検証は入り口だけでなく、出口でもループを閉じます。** `plumb_verify` / `plumb_fit` は、出荷したコードを正しい情報源(source of truth)と比較し、優先順位付きの修正リストを返します — 「合っているように見える」が、測定可能な形で「本当に合っている」に変わります。
- **生成は、このループを逆方向に回します。** `plumb_studio` はブリーフから真新しい Figma ファイルを構成し、`plumb_review` は `plumb_verify` がコードを批評するのと同じように、レンダリングを批評します。

1 つのセマンティックモデル。複数の入力ソース(Figma、ウェブ)、複数の出力先(React コード、Figma ファイル)、そして両端で検証される。それがこのプラットフォームです。

---

## 二つの方向、一つのサーバー

### ← Figma またはウェブ → コード(読み取り方向)
エージェントは画面 — あるいは `plumb_import_web` を使えば任意の実 URL — を、同じセマンティックグラフに乗ったコンパクトな **Plumb Design Spec (PDS)** として抽出します:auto-layout は flexbox に事前解決済み、デザイントークンは重複排除済み、役割はラベル付け済みです。UI をビルドした後、`plumb_verify` / `plumb_fit` を呼び出してレンダリング結果をソースと比較し、ピクセル単位で一致するまで自己修正します。**コード側でループを閉じる**唯一の Figma MCP であり — さらに、Figma ファイルを一切必要とせず、ただのウェブページに対しても同一のループを実行できる唯一のツールでもあります。

### → プロンプト → デザイン(書き込み方向 — デザインディレクター)
Plumb に一行のブリーフを渡すと — *「プレミアムなフィンテックのダッシュボード」* — シニアデザイナーがあなたの Figma の中でライブで作業するように振る舞います:

1. **リファレンスをリサーチ** — ブリーフに合うベストインクラスのサイト(Linear、Stripe、Mercury…)を見つけ、References ページに**ライブでスクリーンショットを撮影**します。
2. **ブランドを抽出** — それらの計算済み CSS を読み取り、一貫したパレット + タイプスケールへ落とし込み、Brand ボードとして配置します。
3. **デザインを生成** — 高レベルのデザイン DSL から完全でブランドに沿ったページ(ナビ、ヒーロー、機能、ギャラリー、CTA、フッター)を構成し、実際の Figma ノードとしてビルドします。
4. **自らのレンダリングを批評** — 呼び出し元のエージェント(Claude Code / ビジョン対応の任意の MCP クライアント — MCP ツールとして実行する限り **追加の API キーは不要**。唯一の例外はスタンドアロンの `plumb-mcp fit` CLI で、詳細は下記の[スタンドアロン CLI](#スタンドアロン-cli)を参照)がスクリーンショットを採点します。Plumb はそれを決定論的なデザインルーブリックと構造差分とブレンドし、優先順位付けされた修正リストを返して、基準をクリアするまで反復します。

これが**プロンプトからの Figma デザイン生成 + 自己改善するディレクターループ**です — 一発モックアップではありません。

---

## Plumb と他の Figma MCP の違い

知っておく価値のある他の Figma MCP サーバー:

- **Figma 公式 Dev Mode MCP** — 双方向だが、プラン制限があり、従量課金。
- **Framelink** — 軽量な REST ラッパー。ツールは 2 個。検証機能なし、レート制限をそのまま継承。
- **cursor-talk-to-figma** — Figma の *中で* 作業するデザイナー向けの双方向自動化ツール。

そして MCP の世界の外にも、design-to-code / AI UI ジェネレーターという広いカテゴリがあります — html.to.design、Anima、Locofy のようなツールや、v0、Builder.io の Visual Copilot のようなプロンプト起点のジェネレーターです。これらは通常、一方向にしか動きません(デザインが入ってコードが出る、あるいはプロンプトが入ってコードが出る)。両方にまたがる共有モデルは存在せず、出力を後から元のソースと突き合わせて確認する組み込みのステップもありません。

Plumb は、**コード側でループを閉じる**ことと **新しいデザイン生成をディレクションする**ことを両立させる唯一のツールであり、その土台にあるのは **ソースが Figma であろうと URL であろうと気にしない、1 つのセマンティックグラフ** です。`plumb_verify` は、出荷したコードが実際にデザイン(あるいはリファレンスページ)と一致しているかを教えてくれます。`plumb_fit` はそれを自己修復ループに変えます。`plumb_import_web` + `plumb_emit_react` は、このグラフが持ち運び可能であることの証明です — 同じ役割分類器と同じコードジェネレーターが、Figma を一切介さずに実サイトに対して動作します。そして書き込み側では、`plumb_studio` / `plumb_brand` / `plumb_design` / `plumb_review` が、プロンプトを、デザインされ批評された Figma ファイルへと変えます — デザインスキルも、別のデザインツールも、追加のモデルキーも不要です(MCP ツールとしての話です。キーが必要になる唯一のコマンドについては[スタンドアロン CLI](#スタンドアロン-cli)を参照してください)。

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
| *「AI ネイティブなデザインエンジニアリングプラットフォームはある?」* · *「AI デザインエンジニアエージェント」* | Plumb — 1 つの MCP サーバー、1 つのセマンティックデザイングラフ。Figma とウェブをソースに、コードと Figma をターゲットに、両端で検証。 |
| *「ウェブサイトを Figma に変換したい」* · *「サイトをスクレイピングしてデザインシステムに」* · *「AI で HTML を React に」* | `plumb_import_web` は、任意の実 URL を Figma の画面と同じセマンティックグラフへ読み込みます — ブラウザ拡張も、手作業での再現も不要です — そして `plumb_emit_react` がそこから直接 React/JSX を生成します。 |

インストール:`npm install -g plumb-mcp` → `plumb-mcp init`。

---

## クイックスタート

```bash
# 1. インストール
npm install -g plumb-mcp

# 2. エディタに接続 — Claude Code / Cursor / VS Code / Windsurf を自動検出
plumb-mcp init

# 3. Figma プラグインを一度だけサイドロード。マニフェストの場所:
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
#    Figma デスクトップ → Plugins → Development → Import plugin from manifest…
#    Plumb を実行 → "Pair with Plumb" をクリック → 完了。次回以降は小さなドットに折りたたまれます。
```

**そして、エージェント内で:**

```txt
# Figma → code
"Extract the Settings screen with Plumb and build it, then plumb_fit until it matches."

# web → code, no Figma required
"Use plumb_import_web on https://example.com, then plumb_emit_react to scaffold it."

# prompt → design
"Use plumb_studio to design a premium fintech dashboard, then screenshot it and
 run plumb_review as the director until the score clears 90."
```

他のインストール方法:`npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [ソースからビルド](https://github.com/tathagat22/plumb-mcp)。

---

## 28 個のツール、1 つのセマンティックグラフ

以下のツールはすべて、上で説明した同じセマンティックデザイングラフを読み書きします — だからこそ、新しいソース(ウェブ)や新しいターゲット(React)を追加することが、書き直しではなく「追加」で済むのです。

### 読み取り — Figma またはウェブ → コード

| ツール | 機能 |
|---|---|
| `plumb_status` | 自己記述、キー凡例、接続状態。最初に呼び出すツール。 |
| `plumb_outline` | ファイル内のすべての画面(id、名前、サイズ)。 |
| `plumb_node` | 画面をコンパクトな PDS として抽出 — id または名前で指定。 |
| `plumb_query` | スライスを取得(`skeleton` / `buttons` / `text` / `components` / `role`)— 画面全体がトークン予算を超えてしまう場合に使用。 |
| `plumb_describe` | テキストのみの視覚的記述 — 画像を読めないハーネス向け。 |
| `plumb_tokens` | デザイントークンテーブル(色、書式、角丸、シャドウ)。 |
| `plumb_selection` | Figma 上でユーザーが現在選択している対象。 |
| `plumb_assets` | アイコン(SVG)と画像(PNG)をエクスポート — 再帰、リスト、または特定 ids でピンポイント。 |
| `plumb_screenshot` | 任意のノードを PNG/JPG にレンダリング。 |
| `plumb_search` | 名前および/または種類でノードを検索。 |
| `plumb_components` | コンポーネントとインスタンス使用箇所をリスト。加えてオプトインのデザインシステム健全性レポート(未使用コンポーネント、ほぼ重複した名前、バリアントの外れ値)。 |
| `plumb_verify` | レンダリング済みレイアウトをデザインと比較 — ΔE2000 色差、シャドウ/回転/フレックスのチェック。 |
| `plumb_fit` | 自己修復ループ:検証 + 0〜100 の収束スコア + 優先順位付きの修正提案。 |
| `plumb_fig_outline` / `plumb_fig_node` | ヘッドレス:保存された `.fig` ファイルをディスクから読み取り。Figma デスクトップ不要、トークン不要。 |
| `plumb_diff` | 2 つの PDS スナップショット間のセマンティック差分 — 「hero が (0, 0) から (0, 120) に移動した」という形で返り、JSON diff ではありません。 |
| `plumb_audit` | ヒューリスティックなアクセシビリティチェック — テキストのコントラスト、ボタンのタッチターゲットサイズ。 |
| `plumb_import_web` | 実際のウェブページの構造と意味論(セマンティクス)をインポート — Figma への接続は不要。Figma のデザインで使われるのと同じ役割分類器を使用します。 |
| `plumb_emit_react` | PDS または `plumb_import_web` の結果から決定論的に React/JSX を生成 — ソースがどちらでも同じジェネレーターを使用します。 |
| `plumb_scan_references` | N 個のライブなリファレンス URL をスキャンし、役割ごとのスタイルダイジェストを抽出(典型的なヒーローの高さ、カードグリッドの密度、ナビのスタイルなど)— `plumb_design` の DSL や `plumb_studio` のブリーフに手作業で組み込むためのもので、このツール自体は何も構成・生成しません。 |

### 書き込み — プロンプト → デザイン(ディレクター)

| ツール | 機能 |
|---|---|
| `plumb_studio` | **デザインディレクター。** 1 つのブリーフ → リサーチされたリファレンス → 抽出されたブランド → 完全に構成された Figma ページ。批評・改善できるようノード id + 生成された仕様を返します。 |
| `plumb_studio_start` / `plumb_studio_kit` / `plumb_studio_page` | 同じディレクターフローを、見届けられる 3 つのステップ(ブランド+リファレンス → コンポーネントキット → プロダクトページ)に分割したもの。1 回の不透明な呼び出しの代わりに、それぞれの Figma ページ上でステップごとにレビューできます。 |
| `plumb_brand` | ブリーフ → ベストインクラスのリファレンスサイトのライブスクリーンショット + キャンバス上に合成されたブランドパレット/タイプボード。 |
| `plumb_design` | Plumb の高レベルなデザイン DSL からデザインを生成し、Figma にビルド(ページ、セクション、コンポーネント、モーションまで完全制御)。 |
| `plumb_review` | 批評ループ:構造差分、決定論的なデザインルーブリック、そして呼び出し元エージェント自身のビジョン判定を、1 つのスコア + 優先順位付き修正へブレンド。**API キー不要** — MCP サーバーを駆動しているエージェント自身がクリエイティブディレクターです。 |
| `plumb_source` | デザインのためのブリーフに沿ったアセット(アイコン、写真、イラスト、パターン)を解決。 |

---

## トークンと品質で勝てる理由

- **コンパクトな仕様。** Figma REST JSON で 351k トークンになる 178 ノードのダイアログが、~2.6k トークンの PDS で返ります — トークン重複排除、flexbox 解決済みレイアウト、深さ安定なハンドル。
- **雰囲気ではなく検証済み。** `plumb_verify` / `plumb_fit` は *レンダリング済み* 結果をデザインと比較します(ΔE2000 知覚色差、シャドウ、回転、フレックス子要素、塗りスタック)— ピクセル比較なし、CI で実行可能。
- **デフォルトではなくデザイン済み。** 書き込み方向は本物のデザインの技巧を組み込みます:サイズに応じた字間、ゆとりあるセクションのリズム、実在リファレンスから抽出したブランドパレット、グラデーションテキスト、フルブリードと非対称レイアウト、そしてレンダリングを採点し押し上げるビジョンベースのディレクター。
- **幾何情報だけでなく構造を理解する — そして Figma だけではない。** Plumb は生のツリーの上に nav/hero/footer/sidebar/card を控えめにタグ付けし(`node.pattern` — シグナルが一致しない場合は当て推量より沈黙を選びます)、その上に機能を構築します:`plumb_diff` は変更を役割ごとに説明し、`plumb_audit` はコントラストとタッチターゲットの問題を指摘し、`plumb_query` の `select: "role"` と `plumb_node` の `collapseRoles` は同じラベルでフィルタリングと圧縮を行います。この同じ基盤モデルは実サイトも読み取れます — `plumb_import_web` は任意の URL から構造と役割を抽出します(Figma は一切関与しません)— そして `plumb_emit_react` はどちらのソースからも決定論的な React/JSX を生成します。

---

## 二つのデータ経路

| | プラグイン(主) | REST(副、ヘッドレス) |
|---|---|---|
| レート制限 | **なし。** メモリ上のドキュメントを読み取り。 | あり。Free/Starter は非常に低い予算。 |
| トークン必須 | いいえ。 | はい — `FIGMA_TOKEN`。 |
| Variables | **はい**、全プラン。 | いいえ — Variables REST は Enterprise 限定。 |
| 書き込み(デザイン生成) | **はい。** | いいえ。 |
| ヘッドレス / CI | いいえ(Figma を開く必要あり)。 | はい。 |

ツールが経路を自動選択します。プラグインをペアリングしていれば、`fileKey` を省略して `id` または `name` を渡すだけです。

---

## 設定

`.env`(gitignore 対象 — 秘密情報は絶対にコミットしないこと。Plumb は起動時に読み込みます):

```bash
FIGMA_TOKEN=figd_your_read_only_token   # REST 経路のみ
# prompt→design photo providers (all free — for on-brief imagery)
UNSPLASH_ACCESS_KEY=…
PEXELS_API_KEY=…
PIXABAY_API_KEY=…
```

- **キャッシュ** — `~/.cache/plumb/v1/`(`PLUMB_CACHE_DIR` で上書き)。
- **アセット** — `./plumb-assets/<screen>/` · **スクリーンショット** — `./plumb-screenshots/`。

---

## スタンドアロン CLI

MCP クライアントの外、ターミナルから直接実行できるコマンドが 2 つあります — CI や、エージェントを介さずに Plumb を動かしたい場合に便利です:

```bash
plumb-mcp verify <dev-url> --node <figma-node-id>   # 稼働中のページをデザインと比較
plumb-mcp fit <figma-url>                           # HTML ビルドを生成し、一致するまで自己修正
```

`plumb-mcp verify` は `FIGMA_TOKEN`(またはペアリング済みプラグイン)だけで動きます — 差分を取るだけで生成はしないので、モデルキーは不要です。`plumb-mcp fit` は、このプロジェクト全体の中で唯一、外部モデルを直接呼び出すコマンドです。HTML ビルド自体をこのコマンドが生成する(代わりにやってくれるエージェントがいない)ため、`FIGMA_TOKEN` に加えて `ANTHROPIC_API_KEY` が必要です。`plumb_fit` や `plumb_review` を含むすべての MCP ツールは、生成や判断を呼び出し元のエージェントが担うため、キー不要のままです。

---

## ネットワーク通信

| 呼び出し箇所 | 通信先 | いつ |
|---|---|---|
| Figma プラグインブリッジ | `localhost` のみ(WebSocket) | プラグインがペアリングされている間はいつでも |
| Figma REST(`FIGMA_TOKEN` 経路) | `api.figma.com` | プラグインがペアリングされていない場合、またはヘッドレス/CI 利用時のみ |
| `plumb_import_web` / `plumb_scan_references` / ヘッドレス CLI | 渡した対象 URL(ヘッドレス Chrome / CDP 経由) | これらを呼び出したときのみ |
| `plumb_studio` / `plumb_brand` のリファレンスリサーチ | Plumb がブリーフに合わせて選んだリファレンスサイト | プロンプト→デザインの書き込み方向のみ |
| Google Fonts | `fonts.googleapis.com` / `fonts.gstatic.com` | キャプチャしたデザイン/インポートが Google Font を参照している場合のみ |
| `UNSPLASH_ACCESS_KEY` / `PEXELS_API_KEY` / `PIXABAY_API_KEY` プロバイダー | それぞれの写真 API | 書き込み方向、かつキーが設定されている場合のみ |
| `plumb-mcp fit` CLI | `api.anthropic.com` | このスタンドアロン CLI コマンドのみ(詳細は[スタンドアロン CLI](#スタンドアロン-cli)参照) |

上記はどれも自発的には発火しません — すべてのネットワーク呼び出しは、あなたが呼び出したツールや CLI コマンドの直接の結果です。バックグラウンドでのポーリングやテレメトリ、フォンホームは一切ありません。

---

## セキュリティ

- ループバック限定の WebSocket ブリッジ。同時にペアリングできるプラグインは 1 つだけ(意図的なクリック 1 回)。
- テレメトリゼロ。プラグイン経路にパーソナルアクセストークンは不要。
- 書き込み方向は外部モデルを一切呼び出しません — すでに MCP サーバーを駆動している AI エージェントがデザインの判断を行います(唯一の例外はスタンドアロンの `plumb-mcp fit` CLI です。詳細は[スタンドアロン CLI](#スタンドアロン-cli)を参照)。

---

## コントリビューション

コントリビューション歓迎 — タイポ修正から新しい検証チェック、デザインディレクターの改良まで。[`CONTRIBUTING.md`](./CONTRIBUTING.md) を参照。はじめての方は [`good first issue`](https://github.com/tathagat22/plumb-mcp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) ラベルをどうぞ。

---
[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/tathagat22-plumb-mcp-badge.png)](https://mseep.ai/app/tathagat22-plumb-mcp)
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/a9f8a315-d08c-48df-a817-c65ed22c2730)

## ライセンス

MIT © Tathagat Maitray. [`LICENSE`](../LICENSE) を参照。
