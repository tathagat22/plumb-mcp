

<p align="center">
  <img src="../docs/public/banner.png" alt="Plumb — AI 네이티브 디자인 엔지니어링 플랫폼." width="100%">
</p>

# Plumb (`plumb-mcp`) — AI 네이티브 디자인 엔지니어링 플랫폼

<p align="center">
  <a href="https://github.com/tathagat22/plumb-mcp"><img alt="GitHub stars" src="https://img.shields.io/github/stars/tathagat22/plumb-mcp?style=social"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/plumb-mcp"><img alt="npm weekly downloads" src="https://img.shields.io/npm/dw/plumb-mcp?color=cb3837&logo=npm&logoColor=white"></a>
  &nbsp;
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

<p align="center"><b>⭐ Plumb 가 토큰을 아껴줬거나 — 페이지를 디자인해 줬다면 — 다른 사람들도 찾을 수 있도록 <a href="https://github.com/tathagat22/plumb-mcp">GitHub 에서 스타를 눌러주세요</a>.</b></p>

**Plumb 는 하나의 MCP 서버로 제공되는 AI 네이티브 디자인 엔지니어링 플랫폼입니다.** Figma 파일이든 실제 운영 중인 웹사이트든, 가리키기만 하면 둘 다 동일한 **시맨틱 디자인 그래프(semantic design graph)** — 중복 제거된 토큰, flexbox 로 해석된 레이아웃, 보수적으로 부여된 역할 라벨(`nav` / `hero` / `card` …) — 로 정규화됩니다. 코딩 에이전트는 이 그래프를 바탕으로 빌드하고, 검증 루프는 이를 채점합니다. 대신 한 줄짜리 프롬프트를 가리키면 Plumb 는 **AI 디자인 디렉터** 가 됩니다: 업계 최고 수준의 레퍼런스를 리서치하고, 브랜드를 추출한 뒤, 캔버스 위에 완성된 온브랜드 Figma 파일을 생성하고, 기준을 통과할 때까지 자신의 렌더를 스스로 비평합니다.

> **디자인 → 코드** (Figma 또는 실제 웹, 감이 아니라 검증) &nbsp;•&nbsp; **프롬프트 → 디자인** (리서치 → 브랜드 → 생성 → 비평) &nbsp;•&nbsp; **그 아래에는 하나의 시맨틱 디자인 그래프.** MCP 네이티브 — Claude Code, Cursor, Windsurf 등 Model Context Protocol 을 지원하는 모든 에이전트에서 동작합니다.

📖 전체 문서: **<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm: [`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](../README.md) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md)

> 이 번역은 AI의 도움으로 생성되었습니다. 원어민의 검토를 환영하며, PR로 개선해 주시면 감사하겠습니다.

<p align="center">
  <a href="cursor://anysphere.cursor-deeplink/mcp/install?name=plumb&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInBsdW1iLW1jcCJdfQ=="><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32"></a>
  &nbsp;
  <a href="https://insiders.vscode.dev/redirect/mcp/install?name=plumb&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22plumb-mcp%22%5D%7D"><img src="https://img.shields.io/badge/Install_in_VS_Code-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install in VS Code" height="32"></a>
</p>

코딩 에이전트를 위해 만들어졌습니다 — Claude Code, Cursor, Windsurf, MCP 호환 도구라면 무엇이든. 에이전트 네이티브 디자인 엔지니어링: 대시보드도, 따로 지켜봐야 할 앱도, Figma 와 에디터 사이에서 픽셀을 옮겨다니는 사람도 필요 없습니다. Figma 데스크톱 앱 플러그인으로 Figma 를 읽고(REST 속도 제한 없음, Free 를 포함한 모든 플랜에서 동작), 헤드리스 Chrome 으로 실제 운영 중인 웹사이트를 읽으며, 같은 플러그인을 통해 새로운 디자인을 Figma 에 다시 *쓰고*, Figma API 가 내보내는 수십만 토큰짜리 JSON 대신 간결하게 정규화된 스펙을 반환합니다.

---

## 왜 'Figma 컨버터'가 아니라 '디자인 엔지니어링 플랫폼'인가

대부분의 Figma MCP 서버 — 그리고 대부분의 figma-to-code 도구 전반 — 는 하나의 형태로 들어와 하나의 형태로 나가는 구조입니다: Figma JSON 이 들어오면 특정 프레임워크의 코드가 나가고, 끝입니다. Plumb 의 아키텍처는 파이프가 아니라 허브입니다:

- **두 개의 독립된 소스가 같은 그래프로 흘러듭니다.** `plumb_node` 는 Figma 화면을 정규화하고, `plumb_import_web` 은 실제 웹페이지의 DOM 을 정규화합니다. 픽셀이 어디서 왔든, 둘 다 동일한 플랫폼 독립적 **시맨틱 그래프(Semantic Graph)** — 포함 관계, 반복 그룹, 역할 엣지 — 로 귀결됩니다.
- **모든 소비자(consumer)가 어느 소스에 대해서든 수정 없이 그대로 동작합니다.** `plumb_emit_react` 는 그래프가 Figma 에서 왔든 URL 에서 왔든 동일한 결정론적 React/JSX 를 생성합니다. `plumb_diff`, `plumb_audit`, 그리고 `plumb_query` 의 역할 필터 모두 두 소스에서 똑같이 동작합니다. 이것이 Plumb 가 두 번째 입력을 덧붙인 컨버터가 아니라 플랫폼이라는 구체적인 증거입니다.
- **검증은 들어오는 쪽뿐 아니라 나가는 쪽에서도 루프를 닫습니다.** `plumb_verify` / `plumb_fit` 은 배포한 코드를 소스 오브 트루스와 비교하고 순위가 매겨진 수정 목록을 돌려줍니다 — '맞아 보인다'가 측정 가능하게 참이 됩니다.
- **생성은 이 루프를 거꾸로 돌립니다.** `plumb_studio` 는 브리프로부터 완전히 새로운 Figma 파일을 구성하고, `plumb_review` 는 `plumb_verify` 가 코드를 비평하는 것과 같은 방식으로 렌더를 비평합니다.

하나의 시맨틱 모델. 여러 소스가 들어오고(Figma, 웹), 여러 타깃이 나가며(React 코드, Figma 파일), 양쪽 끝 모두에서 검증됩니다. 그것이 바로 이 플랫폼입니다.

---

## 두 방향, 하나의 서버

### ← Figma 또는 웹 → code (읽기 방향)
에이전트는 화면 — 또는 `plumb_import_web` 을 통한 임의의 실제 URL — 을 동일한 시맨틱 그래프 위에 올라탄 간결한 **Plumb Design Spec (PDS)** 로 추출합니다: auto-layout 은 flexbox 로 미리 해석되고, 디자인 토큰은 중복 제거되며, 역할이 라벨링됩니다. UI 를 빌드한 다음 `plumb_verify` / `plumb_fit` 을 호출해 렌더 결과를 소스와 비교하고 픽셀 단위로 정확해질 때까지 스스로 교정합니다. **코드 쪽에서 루프를 닫는** 유일한 Figma MCP — 그리고 Figma 파일 없이 순수한 웹페이지에 대해서도 동일한 루프를 실행하는 유일한 도구입니다.

### → prompt → design (쓰기 방향 — 디자인 디렉터)
Plumb 에게 한 줄짜리 브리프 — *"프리미엄 핀테크 대시보드"* — 를 주면, 여러분의 Figma 안에서 실시간으로 작업하는 시니어 디자이너처럼 움직입니다:

1. **레퍼런스 리서치** — 브리프에 맞는 업계 최고 수준의 사이트(Linear, Stripe, Mercury…)를 찾아 **실시간으로 스크린샷** 을 찍어 References 페이지에 올립니다.
2. **브랜드 추출** — 그들의 computed CSS 를 읽어 일관된 팔레트 + 타입 스케일로 정리하고, Brand 보드로 배치합니다.
3. **디자인 생성** — 고수준 디자인 DSL 로 완성된 온브랜드 페이지(nav, hero, features, gallery, CTA, footer)를 구성하며, 실제 Figma 노드로 빌드합니다.
4. **자신의 렌더를 비평** — 호출 중인 에이전트(Claude Code / 비전을 지원하는 모든 MCP 클라이언트 — **추가 API 키 불필요**)가 스크린샷을 채점하고, Plumb 는 이를 결정론적 디자인 루브릭 및 구조 비교와 결합해 순위가 매겨진 수정 목록을 돌려주며 기준을 통과할 때까지 반복합니다.

이것이 바로 **자가 개선 디렉터 루프를 갖춘 prompt-to-Figma 디자인 생성** — 일회성 목업이 아닙니다.

---

## Plumb 가 다른 점

알아둘 만한 다른 Figma MCP 서버들:

- **Figma 공식 Dev Mode MCP** — 양방향이지만 플랜 제한이 있고 과금됩니다.
- **Framelink** — 얇은 REST 래퍼. 도구 2 개. 검증 없음, 속도 제한 그대로 상속.
- **cursor-talk-to-figma** — Figma *안에서* 작업하는 디자이너를 위한 양방향 자동화 도구.

그리고 MCP 세계를 넘어, html.to.design, Anima, Locofy 같은 도구나 v0, Builder.io 의 Visual Copilot 같은 프롬프트 우선 생성기를 포함하는 더 넓은 design-to-code / AI UI 생성기 카테고리는 대체로 한 방향으로만 움직입니다(디자인이 들어가면 코드가 나오거나, 프롬프트가 들어가면 코드가 나오는 식) — 두 방향을 아우르는 공유 모델도 없고, 이후에 출력을 소스와 대조하는 내장 단계도 없습니다.

Plumb 는 **소스가 Figma 든 URL 이든 상관하지 않는 하나의 시맨틱 그래프** 위에서, **코드 쪽에서 루프를 닫는 것** *과* **새로운 디자인 생성을 디렉팅하는 것**을 동시에 해내는 유일한 도구입니다. `plumb_verify` 는 배포한 코드가 실제로 디자인(또는 레퍼런스 페이지)과 일치하는지 알려주고, `plumb_fit` 은 이를 자가 치유 루프로 바꿉니다. `plumb_import_web` + `plumb_emit_react` 는 이 그래프가 실제로 이식 가능함을 증명합니다: 동일한 역할 분류기와 동일한 코드 생성기가 Figma 없이도 실제 웹사이트에 대해 그대로 동작합니다. 그리고 쓰기 쪽에서는 `plumb_studio` / `plumb_brand` / `plumb_design` / `plumb_review` 가 프롬프트를 디자인되고 비평된 Figma 파일로 바꿉니다 — 디자인 스킬 불필요, 별도 디자인 도구 불필요, 추가 모델 키 불필요.

---

## 이런 오류를 만났나요?

에이전트가 오류 페이지에서 여기로 왔다면, Plumb 가 해결해 줄 가능성이 큽니다.

| 보고 있는 오류 | Plumb 가 해결하는 이유 |
|---|---|
| `Figma Dev Mode MCP exceeded the 25k token cap` · `351,378 tokens observed` | PDS 는 디자인 토큰(`$c1`, `$t1` …)을 중복 제거하고 auto-layout 을 flexbox 로 사전 해석합니다. 178 노드 다이얼로그가 ~2.6k 토큰으로 돌아옵니다. |
| `Dev Mode MCP: 6 tool calls per month limit` · `Starter plan tool-call limit reached` | Plumb 의 플러그인 경로는 Free 를 포함한 모든 플랜에서 호출당 쿼터가 없습니다. |
| `Framelink figma-developer-mcp HTTP 429` · `Figma REST API rate limit exceeded` | 플러그인 경로는 REST 를 사용하지 않으므로 속도 제한 0. |
| `Variables API requires Enterprise plan` · `403 Forbidden on variables` | Plumb 는 Figma 플러그인 API 로 Variables 를 읽습니다 — 모든 플랜에서 동작. |
| `Figma MCP returned 85% wrong layout` · 환각 레이아웃 | Plumb 는 파싱된 산문이 아닌 구조화된 PDS 를 반환하고, 렌더링된 DOM 과 디자인을 비교하는 `plumb_verify` + `plumb-mcp verify` CLI 를 함께 제공합니다. |
| *"프롬프트로 Figma 디자인을 어떻게 생성하나요?"* · *"Figma 에서 UI 를 디자인하는 AI"* | `plumb_studio` — 브리프 → 리서치된 레퍼런스 → 추출된 브랜드 → 완성되고 비평·개선된 Figma 페이지. |
| *"AI 네이티브 디자인 엔지니어링 플랫폼이 있나요?"* · *"AI 디자인 엔지니어 에이전트"* | Plumb — 하나의 MCP 서버, 하나의 시맨틱 디자인 그래프, Figma 와 웹을 소스로, 코드와 Figma 를 타깃으로, 양쪽 끝 모두 검증. |
| *"웹사이트를 Figma 로 변환하기"* · *"웹사이트를 스크래핑해 디자인 시스템 만들기"* · *"AI 로 HTML 을 React 로"* | `plumb_import_web` 은 임의의 실제 URL 을 Figma 화면과 동일한 시맨틱 그래프로 읽어들입니다 — 브라우저 확장 프로그램도, 수동 재작업도 필요 없습니다 — 그리고 `plumb_emit_react` 가 이를 바로 React/JSX 로 생성합니다. |

설치: `npm install -g plumb-mcp` → `plumb-mcp init`.

---

## 빠른 시작

```bash
# 1. 설치
npm install -g plumb-mcp

# 2. 에디터에 연결 — Claude Code / Cursor / VS Code / Windsurf 자동 인식
plumb-mcp init

# 3. Figma 플러그인을 한 번만 사이드로드. manifest 경로:
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
#    Figma 데스크톱 → Plugins → Development → Import plugin from manifest…
#    Plumb 실행 → "Pair with Plumb" 클릭 → 완료. 이후 실행은 작은 점으로 접힙니다.
```

**그다음, 에이전트에서:**

```txt
# Figma → code
"Extract the Settings screen with Plumb and build it, then plumb_fit until it matches."

# web → code, no Figma required
"Use plumb_import_web on https://example.com, then plumb_emit_react to scaffold it."

# prompt → design
"Use plumb_studio to design a premium fintech dashboard, then screenshot it and
 run plumb_review as the director until the score clears 90."
```

다른 설치 방법: `npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [소스에서 빌드](https://github.com/tathagat22/plumb-mcp).

---

## 24 개의 도구, 하나의 시맨틱 그래프

아래의 모든 도구는 앞서 설명한 동일한 시맨틱 디자인 그래프를 읽거나 씁니다 — 그래서 새로운 소스(웹)나 새로운 타깃(React)을 추가하는 일이 다시 쓰는 게 아니라 더하는 일이 됩니다.

### 읽기 — Figma 또는 웹 → code

| 도구 | 역할 |
|---|---|
| `plumb_status` | 자기 설명, 키 범례, 연결 상태. 가장 먼저 호출. |
| `plumb_outline` | 파일 안의 모든 화면(id, 이름, 크기). |
| `plumb_node` | 화면을 간결한 PDS 로 추출 — id 또는 이름으로. |
| `plumb_query` | 전체 화면이 토큰 예산을 초과할 때 슬라이스(`skeleton` / `buttons` / `text` / `components` / `role`)만 가져오기. |
| `plumb_describe` | 텍스트 전용 시각 설명 — 이미지를 읽지 못하는 하네스용. |
| `plumb_tokens` | 디자인 토큰 테이블(색상, 타이포그래피, 라운드, 그림자). |
| `plumb_selection` | 사용자가 Figma 에서 현재 선택한 대상. |
| `plumb_assets` | 아이콘(SVG)과 이미지(PNG) 내보내기 — 재귀, 목록, 또는 특정 id 로 정밀하게. |
| `plumb_screenshot` | 임의 노드를 PNG/JPG 로 렌더링. |
| `plumb_search` | 이름 및/또는 타입으로 노드 검색. |
| `plumb_components` | 컴포넌트와 인스턴스 사용 현황을 나열하고, 선택적으로 디자인 시스템 상태 리포트(미사용 컴포넌트, 유사 중복 이름, 변형 이상치)까지 제공. |
| `plumb_verify` | 렌더링된 레이아웃을 디자인과 비교 — ΔE2000 색차, 그림자/회전/플렉스 검사. |
| `plumb_fit` | 자가 치유 루프: 검증 + 0–100 수렴 점수 + 우선순위 수정. |
| `plumb_fig_outline` / `plumb_fig_node` | 헤드리스: 디스크에 저장된 `.fig` 파일을 읽기. Figma 데스크톱도, 토큰도 불필요. |
| `plumb_diff` | 두 PDS 스냅샷 사이의 시맨틱 diff — JSON diff 가 아니라 "hero 가 (0, 0)에서 (0, 120)으로 이동했다" 같은 설명. |
| `plumb_audit` | 휴리스틱 접근성 검사 — 텍스트 대비, 버튼 터치 타깃 크기. |
| `plumb_import_web` | 실제 웹페이지의 구조와 시맨틱을 임포트 — Figma 연결이 필요 없습니다. Figma 디자인에 쓰이는 것과 동일한 역할 분류기를 사용합니다. |
| `plumb_emit_react` | PDS 또는 `plumb_import_web` 결과로부터 결정론적 React/JSX 를 생성 — 소스가 무엇이든 동일한 생성기. |

### 쓰기 — prompt → design (디렉터)

| 도구 | 역할 |
|---|---|
| `plumb_studio` | **디자인 디렉터.** 하나의 브리프 → 리서치된 레퍼런스 → 추출된 브랜드 → 완성된 Figma 페이지. 노드 id + 작성된 스펙을 돌려주어 비평·개선할 수 있게 함. |
| `plumb_brand` | 브리프 → 업계 최고 수준 레퍼런스 사이트의 실시간 스크린샷 + 캔버스 위에 합성된 브랜드 팔레트/타입 보드. |
| `plumb_design` | Plumb 의 고수준 디자인 DSL 로 디자인을 작성하고 Figma 로 빌드(페이지, 섹션, 컴포넌트, 모션까지 완전 제어). |
| `plumb_review` | 비평 루프: 구조 비교, 결정론적 디자인 루브릭, 그리고 호출 중인 에이전트 자신의 비전 판정을 하나의 점수 + 순위가 매겨진 수정으로 결합. **API 키 불필요** — MCP 서버를 구동하는 에이전트가 *바로* 크리에이티브 디렉터. |
| `plumb_source` | 디자인에 맞는 온브리프 에셋(아이콘, 사진, 일러스트, 패턴)을 해결. |

---

## 토큰과 품질에서 이기는 이유

- **간결한 스펙.** Figma REST JSON 으로 351k 토큰인 178 노드 다이얼로그가 ~2.6k 토큰의 PDS 로 돌아옵니다 — 중복 제거된 토큰, flexbox 로 해석된 레이아웃, 깊이가 안정적인 핸들.
- **감이 아니라 검증.** `plumb_verify` / `plumb_fit` 은 *렌더링된* 결과를 디자인과 비교합니다(ΔE2000 지각 색차, 그림자, 회전, 플렉스 자식, 채움 스택) — 픽셀 비교 없음, CI 에서 실행 가능.
- **기본값이 아니라 디자인.** 쓰기 방향에는 진짜 디자인 감각이 녹아 있습니다: 크기에 반응하는 letter-spacing, 넉넉한 섹션 리듬, 실제 레퍼런스에서 추출한 브랜드 팔레트, 그라디언트 텍스트, 풀블리드와 비대칭 레이아웃, 그리고 렌더를 채점해 끌어올리는 비전 기반 디렉터.
- **기하 구조뿐 아니라 의미 구조까지 이해합니다 — 그리고 Figma 에 국한되지 않습니다.** Plumb 는 원본 트리 위에 nav/hero/footer/sidebar/card 를 보수적으로 태깅하고(`node.pattern` — 신호가 맞아떨어지지 않으면 추측 대신 침묵), 이를 기반으로 삼습니다: `plumb_diff` 는 역할 단위로 변경 사항을 서술하고, `plumb_audit` 는 대비와 터치 타깃 문제를 짚어내며, `plumb_query` 의 `select: "role"` 과 `plumb_node` 의 `collapseRoles` 는 같은 라벨 기준으로 필터링·압축합니다. 이 근본 모델은 실제 웹페이지도 똑같이 읽습니다 — `plumb_import_web` 은 Figma 없이도 임의의 URL 에서 구조와 역할을 추출하고, `plumb_emit_react` 는 어느 소스에서든 결정론적 React/JSX 를 생성합니다.

---

## 두 개의 데이터 경로

| | 플러그인(주 경로) | REST(보조, 헤드리스) |
|---|---|---|
| 속도 제한 | **없음.** 인메모리 문서를 읽음. | 있음. Free/Starter 는 예산이 매우 낮음. |
| 토큰 필요 | 없음. | 있음 — `FIGMA_TOKEN`. |
| Variables | **가능**, 모든 플랜. | 불가 — Variables REST 는 Enterprise 전용. |
| 쓰기(디자인 생성) | **가능.** | 불가. |
| 헤드리스 / CI | 불가(Figma 실행 필요). | 가능. |

도구가 경로를 자동 선택합니다. 플러그인이 페어링되면 `fileKey` 를 생략하고 `id` 또는 `name` 을 전달하세요.

---

## 설정

`.env`(gitignore 처리 — 비밀은 절대 커밋하지 마세요; Plumb 가 시작 시 로드합니다):

```bash
FIGMA_TOKEN=figd_your_read_only_token   # REST 경로 전용
# prompt→design 사진 제공자(모두 무료 — 온브리프 이미지용)
UNSPLASH_ACCESS_KEY=…
PEXELS_API_KEY=…
PIXABAY_API_KEY=…
```

- **캐시** — `~/.cache/plumb/v1/`(`PLUMB_CACHE_DIR` 로 재정의).
- **에셋** — `./plumb-assets/<screen>/` · **스크린샷** — `./plumb-screenshots/`.

---

## 보안

- 루프백 전용 WebSocket 브리지; 한 번에 하나의 페어링된 플러그인만(의도적인 클릭 한 번).
- 텔레메트리 없음. 플러그인 경로에는 개인 액세스 토큰이 필요 없음.
- 쓰기 방향은 외부 모델을 절대 호출하지 않습니다 — 이미 MCP 서버를 구동 중인 AI 에이전트가 디자인 판단을 담당합니다.

---

## 기여

기여를 환영합니다 — 오타 수정부터 새로운 verify 검사, 디자인 디렉터 개선까지. [`CONTRIBUTING.md`](./CONTRIBUTING.md) 를 참고하세요. 처음이신가요? [`good first issue`](https://github.com/tathagat22/plumb-mcp/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 라벨을 둘러보세요.

---
[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/tathagat22-plumb-mcp-badge.png)](https://mseep.ai/app/tathagat22-plumb-mcp)
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/a9f8a315-d08c-48df-a817-c65ed22c2730)

## 라이선스

MIT © Tathagat Maitray. [`LICENSE`](../LICENSE) 참조.
