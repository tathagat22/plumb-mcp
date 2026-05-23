<p align="center">
  <img src="./docs/public/banner.png" alt="Plumb — Figma ↔ AI 코딩, 연결 완료." width="100%">
</p>

# Plumb (`plumb-mcp`)

**AI 코딩 에이전트용 Figma MCP 서버 — Claude Code, Cursor, Windsurf, 그리고 모든 Model Context Protocol 호환 AI 코딩 도구와 함께 사용 가능.**

📖 전체 문서: **<https://tathagat22.github.io/plumb-mcp/>** &nbsp;·&nbsp; 📦 npm: [`plumb-mcp`](https://www.npmjs.com/package/plumb-mcp) &nbsp;·&nbsp; 🇬🇧 [English README](./README.md) &nbsp;·&nbsp; 🇨🇳 [简体中文](./README.zh-cn.md) &nbsp;·&nbsp; 🇯🇵 [日本語](./README.ja.md)

> 이 번역은 AI의 도움으로 생성되었습니다. 원어민의 검토를 환영하며, PR로 개선해 주시면 감사하겠습니다.

Plumb 는 Figma 데스크톱 앱 안에서 실행되는 동반 플러그인을 통해 Figma 파일을 읽어들입니다 — REST 속도 제한 없음, 과금 없음, 플랜 제한 없음. Figma API 가 내보내는 수십만 토큰짜리 JSON 대신, 간결하고 정규화된 디자인 스펙을 반환하며, 필요할 때 SVG 아이콘과 PNG 이미지를 디스크에 내보냅니다. Free 플랜을 포함한 모든 Figma 플랜에서 동작합니다.

---

## 빠른 시작

### 서버 설치

```bash
# npm（권장）
npm install -g plumb-mcp

# 또는 설치 없이 실행
npx plumb-mcp

# 또는 Docker（멀티 아키텍처 — amd64 + arm64）
docker run --rm -i ghcr.io/tathagat22/plumb-mcp:latest
```

### Figma 플러그인 사이드로드

플러그인은 npm 패키지와 Docker 이미지에 포함되어 있습니다. manifest 경로 찾기:

```bash
echo "$(npm root -g)/plumb-mcp/figma-plugin/manifest.json"
```

Figma 데스크톱에서: **Plugins → Development → Import plugin from manifest…** 를 선택하고 위 경로를 지정하세요.

**Plumb** 플러그인을 실행한 뒤 **Pair with Plumb** 를 클릭합니다. 페어링 후 플러그인은 작은 점으로 접힙니다.

---

## 다른 Figma MCP 서버와 비교

| 기능 | Plumb | Figma 공식 Dev Mode MCP | Framelink | claude-talk-to-figma |
|---|---|---|---|---|
| 도구 개수 | **12** | 적음 | 2 | 적음 |
| Figma Free 플랜에서 동작 | ✅ | 제한 있음 | ✅（Variables 제외） | ✅ |
| 읽기 경로 | 플러그인 · REST · `.fig` | REST | REST | 플러그인 |
| 플러그인 경로 속도 제한 | **없음** | n/a | n/a | 없음 |
| 비 Enterprise 플랜에서 Variables | ✅（플러그인 경유） | 제한 있음 | ❌ | ✅ |
| Figma 에 쓰기 | ❌ | ✅ | ❌ | ✅ |
| 디자인 대 코드 diff（`verify`） | ✅ | ❌ | ❌ | ❌ |
| 실시간 `selection` 인식 | ✅ | ✅ | ❌ | ✅ |
| 컴포넌트 / 인스턴스 목록 | ✅ | 부분 지원 | ❌ | 부분 지원 |
| CI 용 오프라인 `.fig` 파싱 | ✅ | ❌ | ❌ | ❌ |
| 토큰 절약형 PDS（auto-layout → flex, 중복 제거） | ✅ | ❌ | 부분 지원 | ❌ |
| 로컬 전용, 텔레메트리 없음 | ✅ | 클라우드 | ✅ | ✅ |
| 전송 방식 | stdio | stdio | stdio + HTTP/SSE | stdio |
| 라이선스 | MIT | 사유 | MIT | MIT |

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
