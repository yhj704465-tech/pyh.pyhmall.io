# 코드 설명서 (Code Guide)

> 최종 업데이트: 2026-06-11

---

## 파일 구조

```
warehouse-inventory/
├── index.html          # 메인 HTML (단일 페이지)
├── css/
│   └── style.css       # 전체 스타일 (반응형, 모바일 퍼스트)
├── js/
│   ├── data.js         # 초기 재고 데이터 (엑셀 2026.06.11 기준 475개)
│   ├── auth.js         # JWT 인증 관리
│   ├── inventory.js    # 재고 데이터 로직 (파싱·CRUD·검색)
│   └── app.js          # 메인 애플리케이션 진입점 (UI 렌더링)
└── docs/
    ├── features.md     # 기능 설명서
    └── code-guide.md   # 코드 설명서 (현재 파일)
```

---

## js/data.js

엑셀 파일(창고재고현황.xlsx)에서 추출한 초기 재고 데이터.

```javascript
const INITIAL_INVENTORY = [
  {
    id: Number,           // 고유 ID (1부터 순차)
    code: Number,         // 품목코드
    name: String,         // 품명 및 규격
    stockBoxes: Number,   // 실재고 (박스 수)
    unitQty: Number,      // 낱개수량
    totalStock: Number,   // 재고수량 = stockBoxes × boxQty + unitQty
    boxQty: Number,       // 박스당 낱개 수
    expiryRaw: String,    // 소비기한 원본 (엑셀 값 그대로)
    expiryPeriod: String, // 소비기한 기간 (예: "24개월", "제조일자 없음")
    hasMulti: Boolean,    // 다중소비기한 여부 (* 표시)
  }
]
```

**expiryRaw 값 유형:**
| 값 예시 | 설명 |
|---------|------|
| `46399` | 엑셀 시리얼 날짜 |
| `"2027-05-01"` | YYYY-MM-DD 날짜 문자열 |
| `"2025-01-10제조"` | 제조일 |
| `"2026-08-19, 2026-09-15 혼적"` | 혼적 복수 날짜 |
| `"잡화"` | 비식품 |
| `""` | 소비기한 없음 |

---

## js/auth.js

JWT 인증 모듈 (IIFE 패턴, `AUTH` 객체로 노출).

### 주요 함수

| 함수 | 설명 |
|------|------|
| `AUTH.login(id, pw)` | 로그인. 성공 시 JWT를 localStorage에 저장. Promise\<boolean\> |
| `AUTH.logout()` | 로그아웃. localStorage에서 토큰 제거. |
| `AUTH.getSession()` | 현재 세션 확인. 유효하면 payload 반환, 만료/없으면 null. Promise |
| `AUTH.getSessionTimeLeft()` | 세션 잔여 시간 (분). Number |

### JWT 구조
```
header.payload.signature
```
- **header**: `{ alg: "HS256", typ: "JWT" }`
- **payload**: `{ sub: userId, iat: timestamp, exp: timestamp }`
- **signature**: HMAC-SHA256 (Web Crypto API)

> ⚠️ 정적 사이트 특성상 시크릿 키가 클라이언트에 노출됩니다.  
> 내부 전용 도구로만 사용하세요.

---

## js/inventory.js

재고 데이터 관리 핵심 로직. 모듈 패턴 없이 전역 함수로 노출.

### 날짜 유틸

| 함수 | 설명 |
|------|------|
| `excelSerialToDate(serial)` | 엑셀 시리얼 → JS Date. 공식: `(serial - 25569) × 86400 × 1000ms` |
| `parseSimpleDate(str)` | 날짜 문자열 파싱 (YYYY-MM-DD, YY-MM-DD 등) |
| `formatDate(date)` | Date → `YYYY-MM-DD` 문자열 |
| `daysUntil(date)` | 오늘 기준 잔여일 (음수 = 경과) |

### 소비기한 파싱

```javascript
parseExpiry(expiryRaw, expiryPeriod)
// 반환: { type, date, dates, text, daysLeft }
```

**type 값:**

| type | 조건 |
|------|------|
| `'expiry'` | 일반 소비기한 날짜 |
| `'manufactured'` | 제조일 기준 (소비기한 = 제조일 + 유효기간) |
| `'mixed'` | 혼적 (여러 로트) |
| `'multi'` | 다중 소비기한 |
| `'no_mfg_date'` | 제조일자 없음 |
| `'none'` | 소비기한 없음 |
| `'hardware'` | 잡화 |
| `'text'` | 파싱 불가 텍스트 |

### 저장소

| 함수 | 설명 |
|------|------|
| `loadInventory()` | localStorage 로드. 없으면 INITIAL_INVENTORY로 초기화. |
| `saveInventory(items)` | localStorage에 저장. |

### CRUD

| 함수 | 설명 |
|------|------|
| `addItems(items, newItems)` | 항목 추가 (ID 자동 생성) |
| `updateItem(items, id, updates)` | 항목 수정 (totalStock 자동 재계산) |
| `deleteItem(items, id)` | 항목 삭제 |
| `getExpiringSoon(items, days=180)` | 지정 일수 이내 임박 항목 필터 |

### 검색

| 함수 | 설명 |
|------|------|
| `searchInventory(items, query)` | 코드·이름·소비기한으로 필터 |
| `getAutocompleteSuggestions(items, query, max=8)` | 자동완성 후보 (중복 제거) |
| `groupByCode(items)` | 같은 코드끼리 그룹핑 → `Array<Array<Item>>` |

### 텍스트 파서

```javascript
parseTextEntry(line)   // 한 줄 → 항목 객체
parseTextBlock(text)   // 여러 줄 → 항목 배열
```

**입력 형식:**
```
품목코드/품명/수량/소비기한
```
- 수량: `3박스` / `50개` / `3박스,5개`
- 소비기한: `2027-05-01` / `2025-03-10제조` / `혼적:날짜1,날짜2`

---

## js/app.js

메인 애플리케이션. DOM 이벤트 바인딩 및 렌더링.

### 상태 (state)

```javascript
state = {
  items: [],            // 현재 재고 데이터 배열
  isAdmin: false,       // 관리자 로그인 여부
  searchQuery: '',      // 검색어
  showExpiringSoon: false, // 임박 필터 활성 여부
  expandedIds: Set,     // 펼쳐진 품목코드 집합
  editingId: null,      // 수정 중인 항목 ID
  filterCode: null,     // 자동완성으로 선택된 코드 필터
}
```

### 주요 함수

| 함수 | 설명 |
|------|------|
| `init()` | 초기화 (데이터 로드, 세션 확인, 렌더링) |
| `setupWelcomeAnimation()` | 타이핑 애니메이션 |
| `setupLoginForm()` | 로그인 폼 이벤트 바인딩 |
| `setupSessionTimer()` | 30초 간격 세션 만료 체크 |
| `updateAuthUI()` | 로그인 상태에 따른 UI 전환 |
| `renderAll()` | 전체 UI 재렌더링 |
| `renderInventoryTable()` | 재고 목록 렌더링 |
| `renderGroup(group)` | 단일 그룹 카드 HTML 생성 |
| `renderExpandedRows(group, expiryInfos)` | 상세 테이블 HTML 생성 |
| `bindTableEvents(container)` | 목록 이벤트 바인딩 |
| `openEditModal(id)` | 수정 모달 열기 |
| `openAddModal()` | 추가 모달 열기 |
| `showToast(message, type)` | 토스트 알림 표시 |
| `exportToCSV()` | CSV 파일 다운로드 |
| `escapeHtml(str)` | XSS 방지 HTML 이스케이프 |

---

## css/style.css

CSS 변수 기반 디자인 시스템.

### 주요 CSS 변수

```css
--bg: #f0f4f8          /* 페이지 배경 */
--surface: #ffffff     /* 카드 배경 */
--primary: #0ea5e9     /* 하늘파랑 (기본 강조) */
--accent: #8b5cf6      /* 보라 (혼적 등 서브 강조) */
--warning: #f59e0b     /* 노랑 (임박 경고) */
--danger: #ef4444      /* 빨강 (위험/만료) */
--success: #22c55e     /* 초록 (정상) */
```

### 반응형 브레이크포인트

| 구간 | 레이아웃 변화 |
|------|--------------|
| `> 900px` | 컴팩트 행 5열 그리드 |
| `≤ 900px` | 검색/버튼 세로 배치 |
| `≤ 600px` | 컴팩트 행 2열, 모바일 최적화 |

---

## 피드백 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-11 | 초기 버전 개발 완료 |
