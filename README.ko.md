<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI 코딩, 연결 완료." width="100%">
</p>

# Plumb (`plumb-mcp`)

**검증 루프가 있는 Figma → 코드 MCP.** 디자인이 들어가고 정규화된 스펙이 나옵니다. `plumb-mcp verify` 가 헤드리스 Chrome 을 구동해서 렌더링된 코드가 정말 Figma 의 디자인과 일치하는지 증명합니다.

📖 전체 문서: **<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm: [`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](./README.md) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md)

> 이 번역은 AI의 도움으로 생성되었습니다. 원어민의 검토를 환영하며, PR로 개선해 주시면 감사하겠습니다.

코딩 에이전트 전용 — Claude Code, Cursor, Windsurf, MCP 호환 도구라면 무엇이든. Figma 데스크톱 앱 안에서 실행되는 동반 플러그인으로 Figma 파일을 읽고(REST 속도 제한 없음, Free 를 포함한 모든 플랜에서 동작), Figma API 가 내보내는 수십만 토큰짜리 JSON 대신 간결하게 정규화된 디자인 스펙을 반환하며, 필요할 때 SVG 아이콘과 PNG 이미지를 디스크로 곧장 내보냅니다.

---

## Plumb 가 다른 Figma MCP 와 다른 점

알아둘 만한 다른 Figma MCP 서버 셋:

- **Figma 공식 Dev Mode MCP** — 양방향（Figma 에 쓰기 가능）이지만 플랜 제한이 있고 호출당 과금.
- **Framelink** — 얇은 REST 래퍼. 도구 2 개. 검증 없음, 속도 제한 그대로 상속.
- **cursor-talk-to-figma** — Figma 안에서 작업하는 디자이너용 양방향 자동화 도구.

Plumb 는 **코드 쪽에서 루프를 닫는** 유일한 선택지. `plumb_verify`（MCP 도구）와 `plumb-mcp verify`（CLI）가 에이전트가 만든 코드가 실제로 디자인과 일치하는지 알려줍니다 — 색상으로 표시된 delta, 픽셀 비교 없음, CI 에서 실행 가능.

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
| `Dev Mode MCP requires selection` · "Open desktop app with the right selection" | 플러그인이 페어링되는 순간 Plumb 는 파일 전체 인벤토리를 스트리밍합니다. 호출마다 선택할 필요 없음. |

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

# 4. 선택 — 터미널에서 바로 렌더링된 코드와 Figma 를 검증
plumb-mcp verify http://localhost:5173/dashboard --url <figma-url>
```

다른 설치 방법: `npx plumb-mcp` · `docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest` · [소스에서 빌드](https://github.com/tathagat22/plumb-mcp).

---

## 12 개 도구

| 도구 | 역할 |
|---|---|
| `plumb_status` | 자기 설명, 키 범례, 연결 상태. 가장 먼저 호출. |
| `plumb_outline` | 파일 안의 모든 화면（id, 이름, 크기）. |
| `plumb_node` | 화면을 간결한 PDS 로 추출 — id 또는 이름으로. |
| `plumb_tokens` | 디자인 토큰 테이블（색, 타입, 라운드, 그림자）. |
| `plumb_selection` | 사용자가 Figma 에서 현재 선택한 대상. |
| `plumb_assets` | 아이콘（SVG）과 이미지（PNG）내보내기 — 세 가지 모드: 재귀, 목록, 특정 ids. |
| `plumb_screenshot` | 임의 노드를 PNG/JPG 로 렌더링. |
| `plumb_search` | 이름 및/또는 타입으로 노드 검색. |
| `plumb_components` | 컴포넌트와 인스턴스 사용처 목록. |
| `plumb_verify` | 렌더링된 레이아웃을 디자인과 비교 — 구조화된 delta 반환. |
| `plumb_fig_outline` | Figma 데스크톱 없이 저장된 `.fig` 파일에서 모든 화면 나열. |
| `plumb_fig_node` | Figma 데스크톱 없이 저장된 `.fig` 파일에서 id 로 노드 가져오기. |

---

아키텍처, 레시피, 도구별 상세 레퍼런스, 트러블슈팅을 포함한 전체 문서는 **<https://tathagat22.github.io/plumb-mcp/>** 에 있습니다.

MIT © Tathagat Maitray
