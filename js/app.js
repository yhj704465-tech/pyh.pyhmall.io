// app.js - 메인 애플리케이션 진입점

let state = {
  items: [],
  isAdmin: false,
  searchQuery: '',
  showExpiringSoon: false,
  expandedIds: new Set(),
  editingId: null,
  filterCode: null, // 코드별 필터
};

const LOG_KEY = 'warehouse_log';
const MAX_LOG_ENTRIES = 30;

let _pendingAddItems = null;
let _outgoingLines = null;
let _pendingRevertLogId = null;

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function init() {
  state.items = loadInventory();
  // 엑셀 시리얼 날짜 일괄 변환 (최초 1회)
  if (migrateExpiryDates(state.items)) {
    saveInventory(state.items);
  }
  const session = await AUTH.getSession();
  state.isAdmin = !!session;

  setupWelcomeAnimation();
  setupLoginForm();
  setupSearch();
  setupSessionTimer();
  renderAll();

  // 로그인 상태 UI 업데이트
  updateAuthUI();
}

// ─── 변경 이력 관리 ──────────────────────────────────────────────────────────

function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; }
  catch { return []; }
}

function saveLog(log) {
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

function addLogEntry(action, label, undoData) {
  const log = loadLog();
  log.unshift({ id: Date.now(), time: new Date().toISOString(), action, label, undoData });
  if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
  saveLog(log);
  renderLogPanel();
}

// ─── 환영 텍스트 애니메이션 ───────────────────────────────────────────────────

function setupWelcomeAnimation() {
  const el = document.getElementById('welcomeText');
  if (!el) return;
  const text = '어서오세요 필요한 물품재고현황 사이트입니다';
  el.textContent = '';
  let i = 0;
  function typeNext() {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(typeNext, 80);
    } else {
      el.classList.add('done');
    }
  }
  setTimeout(typeNext, 400);
}

// ─── 로그인 폼 ────────────────────────────────────────────────────────────────

function setupLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('loginId').value.trim();
    const pw = document.getElementById('loginPw').value;
    const btn = form.querySelector('button[type=submit]');
    const errEl = document.getElementById('loginError');

    btn.disabled = true;
    btn.textContent = '확인 중...';
    errEl.textContent = '';

    const ok = await AUTH.login(id, pw);
    if (ok) {
      state.isAdmin = true;
      updateAuthUI();
      renderAll();
      showToast('관리자로 로그인되었습니다.', 'success');
    } else {
      errEl.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
      document.getElementById('loginPw').value = '';
    }
    btn.disabled = false;
    btn.textContent = '로그인';
  });
}

// ─── 세션 타이머 ──────────────────────────────────────────────────────────────

function setupSessionTimer() {
  setInterval(async () => {
    if (!state.isAdmin) return;
    const session = await AUTH.getSession();
    if (!session) {
      state.isAdmin = false;
      updateAuthUI();
      renderAll();
      showToast('세션이 만료되어 로그아웃되었습니다.', 'warning');
      return;
    }
    const left = AUTH.getSessionTimeLeft();
    const el = document.getElementById('sessionTimer');
    if (el) el.textContent = `세션 ${left}분 남음`;
  }, 30000);
}

// ─── 인증 UI 업데이트 ─────────────────────────────────────────────────────────

function updateAuthUI() {
  const loginSection = document.getElementById('loginSection');
  const adminControls = document.getElementById('adminControls');
  const sessionInfo = document.getElementById('sessionInfo');

  if (state.isAdmin) {
    if (loginSection) loginSection.style.display = 'none';
    if (adminControls) adminControls.style.display = 'flex';
    if (sessionInfo) {
      sessionInfo.style.display = 'flex';
      const left = AUTH.getSessionTimeLeft();
      const timer = document.getElementById('sessionTimer');
      if (timer) timer.textContent = `세션 ${left}분 남음`;
    }
  } else {
    if (loginSection) loginSection.style.display = 'flex';
    if (adminControls) adminControls.style.display = 'none';
    if (sessionInfo) sessionInfo.style.display = 'none';
  }
  renderLogPanel();
}

// ─── 검색 & 자동완성 ─────────────────────────────────────────────────────────

function setupSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  const dropdown = document.getElementById('autocompleteList');
  if (!input) return;

  input.addEventListener('input', () => {
    const q = input.value;
    state.searchQuery = q;
    if (clearBtn) clearBtn.style.display = q ? 'flex' : 'none';

    // 자동완성
    const suggestions = getAutocompleteSuggestions(state.items, q);
    renderAutocomplete(suggestions, dropdown, input);
    renderAll();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      state.searchQuery = '';
      state.filterCode = null;
      clearBtn.style.display = 'none';
      if (dropdown) dropdown.innerHTML = '';
      if (dropdown) dropdown.style.display = 'none';
      renderAll();
    });
  }

  // 외부 클릭 시 드롭다운 닫기
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#searchWrapper')) {
      if (dropdown) dropdown.style.display = 'none';
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dropdown) dropdown.style.display = 'none';
      input.blur();
    }
  });
}

function renderAutocomplete(suggestions, dropdown, input) {
  if (!dropdown) return;
  if (!suggestions || suggestions.length === 0) {
    dropdown.innerHTML = '';
    dropdown.style.display = 'none';
    return;
  }
  dropdown.innerHTML = suggestions.map(s =>
    `<li class="ac-item" data-code="${s.code}" data-name="${escapeHtml(s.name)}">
      <span class="ac-code">${s.code}</span>
      <span class="ac-name">${escapeHtml(s.name)}</span>
    </li>`
  ).join('');
  dropdown.style.display = 'block';

  dropdown.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('click', () => {
      const code = parseInt(el.dataset.code);
      input.value = el.dataset.name;
      state.searchQuery = el.dataset.name;
      state.filterCode = code;
      dropdown.style.display = 'none';
      renderAll();
    });
  });
}

function formatAddQty(entry) {
  const parts = [];
  if (entry.stockBoxes > 0) parts.push(`${entry.stockBoxes}박스`);
  if (entry.unitQty > 0) parts.push(`${entry.unitQty}개`);
  return parts.length > 0 ? parts.join(' ') : '0';
}

function showAddConfirm() {
  const text = document.getElementById('addText').value;
  const parsed = parseTextBlock(text);
  if (parsed.length === 0) {
    showToast('추가할 항목이 없습니다.', 'error');
    return;
  }

  // 코드 필수 검증
  const noCode = parsed.filter(e => !e.code);
  if (noCode.length > 0) {
    showToast(`품목코드가 없는 항목이 있습니다: ${noCode.map(e => e.name).join(', ')}`, 'error');
    return;
  }

  _pendingAddItems = parsed;

  const rows = parsed.map(e => {
    const expCell = e.expiryRaw
      ? escapeHtml(e.expiryRaw)
      : `<span class="no-expiry">없음</span>`;
    return `<tr>
      <td class="ct-code">${e.code}</td>
      <td class="ct-name">${escapeHtml(e.name)}</td>
      <td class="ct-qty">${formatAddQty(e)}</td>
      <td class="ct-exp">${expCell}</td>
    </tr>`;
  }).join('');

  document.getElementById('confirmItemsTable').innerHTML = `
    <table class="confirm-table">
      <thead><tr><th>코드</th><th>품명</th><th>수량</th><th>소비기한</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  document.getElementById('addInputView').style.display = 'none';
  document.getElementById('addConfirmView').style.display = 'block';
  document.getElementById('addFooter1').style.display = 'none';
  document.getElementById('addFooter2').style.display = 'flex';
  const title = document.querySelector('#addModal .modal-title');
  if (title) title.textContent = `${parsed.length}개 항목 — 등록 확인`;
}

function doConfirmedAdd() {
  if (!_pendingAddItems || _pendingAddItems.length === 0) return;

  const beforeIds = new Set(state.items.map(i => i.id));
  addItems(state.items, _pendingAddItems);
  const addedIds = state.items.filter(i => !beforeIds.has(i.id)).map(i => i.id);
  const label = _pendingAddItems.length === 1
    ? _pendingAddItems[0].name
    : `${_pendingAddItems[0].name} 외 ${_pendingAddItems.length - 1}개`;
  saveInventory(state.items);
  addLogEntry('add', label, { ids: addedIds });

  _pendingAddItems = null;
  closeModal('addModal');
  renderAll();
  showToast(`${addedIds.length}개 항목이 추가되었습니다.`, 'success');
}

// ─── 소비기한 편집용 정규화 ───────────────────────────────────────────────────
// 수정 폼에 표시하기 전 엑셀 일련번호를 YYYY-MM-DD 로 변환

function normalizeExpiryForEdit(raw) {
  if (!raw) return '';
  const t = raw.trim();

  // 5자리 엑셀 시리얼 (40000~60000)
  if (/^\d{5}$/.test(t)) {
    const n = parseInt(t);
    if (n > 40000 && n < 60000) return formatDate(excelSerialToDate(n));
  }

  // 쉼표 구분 다중 엑셀 시리얼 (모두 5자리 시리얼인 경우)
  if (t.includes(',')) {
    const parts = t.split(',').map(s => s.trim());
    if (parts.every(p => /^\d{5}$/.test(p) && parseInt(p) > 40000 && parseInt(p) < 60000)) {
      return parts.map(p => formatDate(excelSerialToDate(parseInt(p)))).join(',');
    }
  }

  return raw;
}

// 기존 localStorage 데이터의 엑셀 시리얼 날짜를 YYYY-MM-DD 로 일괄 변환
function migrateExpiryDates(items) {
  let changed = false;
  for (const item of items) {
    const raw = (item.expiryRaw || '').trim();
    if (!raw) continue;

    // 5자리 단일 시리얼
    if (/^\d{5}$/.test(raw)) {
      const n = parseInt(raw);
      if (n > 40000 && n < 60000) {
        item.expiryRaw = formatDate(excelSerialToDate(n));
        changed = true;
        continue;
      }
    }

    // 쉼표 구분 다중 시리얼
    if (raw.includes(',') && !raw.includes('-')) {
      const parts = raw.split(',').map(s => s.trim());
      if (parts.length > 1 && parts.every(p => /^\d{5}$/.test(p) && parseInt(p) > 40000 && parseInt(p) < 60000)) {
        item.expiryRaw = parts.map(p => formatDate(excelSerialToDate(parseInt(p)))).join(',');
        changed = true;
      }
    }
  }
  return changed;
}

// ─── 출고 물품 처리 ──────────────────────────────────────────────────────────

function fuzzyMatchBest(query) {
  if (!query.trim()) return null;
  const tokens = query.toLowerCase().trim().split(/\s+/);
  const seen = new Set();
  for (const item of state.items) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    const haystack = `${item.code} ${(item.name || '').toLowerCase()}`;
    if (tokens.every(t => haystack.includes(t))) return item;
  }
  return null;
}

function getGroupStock(code) {
  const rows = state.items.filter(i => i.code === code);
  const totalBoxes = rows.reduce((s, r) => s + (r.stockBoxes || 0), 0);
  const totalUnits = rows.reduce((s, r) => s + (r.unitQty || 0), 0);
  const totalStock = rows.reduce((s, r) => s + (r.totalStock || 0), 0);
  const withExpiry = rows
    .map(r => ({ raw: r.expiryRaw, info: parseExpiry(r.expiryRaw, r.expiryPeriod) }))
    .filter(x => x.info.daysLeft !== null && x.info.daysLeft >= 0)
    .sort((a, b) => a.info.daysLeft - b.info.daysLeft);
  return { totalBoxes, totalUnits, totalStock, earliestExpiry: withExpiry[0]?.raw || null };
}

function parseOutgoingLine(line) {
  const slashIdx = line.trim().lastIndexOf('/');
  if (slashIdx === -1) return null;
  const nameQuery = line.slice(0, slashIdx).trim();
  const qtyStr = line.slice(slashIdx + 1).trim();
  let stockBoxes = 0, unitQty = 0;
  const segments = qtyStr.split(',').map(s => s.trim());
  for (const seg of segments) {
    const boxM = seg.match(/(\d+)\s*박스/);
    const unitM = seg.match(/(\d+)\s*개/);
    if (boxM) stockBoxes = parseInt(boxM[1]);
    else if (unitM) unitQty = parseInt(unitM[1]);
    else { const n = parseInt(seg); if (!isNaN(n) && stockBoxes === 0 && unitQty === 0) stockBoxes = n; }
  }
  return { nameQuery, qtyStr, stockBoxes, unitQty, matched: fuzzyMatchBest(nameQuery), skipped: false };
}

function openOutgoingModal() {
  const modal = document.getElementById('outgoingModal');
  if (!modal) return;
  _outgoingLines = null;
  const textarea = document.getElementById('outgoingText');
  if (textarea) textarea.value = '';
  document.getElementById('outgoingInputView').style.display = 'block';
  document.getElementById('outgoingPreviewView').style.display = 'none';
  document.getElementById('outgoingFooter1').style.display = 'flex';
  document.getElementById('outgoingFooter2').style.display = 'none';
  const title = modal.querySelector('.modal-title');
  if (title) title.textContent = '출고 물품 입력';
  modal.style.display = 'flex';
}

function showOutgoingPreview() {
  const text = document.getElementById('outgoingText').value;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    showToast('출고할 항목을 입력해주세요.', 'error');
    return;
  }
  _outgoingLines = lines.map(parseOutgoingLine).filter(Boolean);
  if (_outgoingLines.length === 0) {
    showToast('올바른 형식으로 입력해주세요. (품명/ 수량)', 'error');
    return;
  }
  renderOutgoingPreview();
  document.getElementById('outgoingInputView').style.display = 'none';
  document.getElementById('outgoingPreviewView').style.display = 'block';
  document.getElementById('outgoingFooter1').style.display = 'none';
  document.getElementById('outgoingFooter2').style.display = 'flex';
  const title = document.querySelector('#outgoingModal .modal-title');
  if (title) title.textContent = `${_outgoingLines.length}개 항목 — 출고 확인`;
}

function renderOutgoingPreview() {
  const contentEl = document.getElementById('outgoingPreviewContent');
  if (!contentEl || !_outgoingLines) return;

  const unmatched = _outgoingLines.filter(l => !l.matched && !l.skipped);
  let html = '';
  if (unmatched.length > 0) {
    html += `<div class="og-warning">⚠️ ${unmatched.length}개 항목의 품명을 찾지 못했습니다. 수정하거나 건너뛰어 주세요.</div>`;
  }
  html += `<div class="og-preview-list">`;
  _outgoingLines.forEach((line, idx) => { html += renderOutgoingLine(line, idx); });
  html += `</div>`;
  contentEl.innerHTML = html;

  // 미매칭 — 재검색 input
  contentEl.querySelectorAll('.og-search-input').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    const resultsEl = inp.parentElement.querySelector('.og-search-results');
    inp.addEventListener('input', () => {
      const q = inp.value;
      if (!q.trim()) { if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; } return; }
      const hits = fuzzyMatchItems(q);
      if (!resultsEl) return;
      if (hits.length === 0) {
        resultsEl.innerHTML = '<li class="qs-no-result">검색 결과 없음</li>';
      } else {
        resultsEl.innerHTML = hits.map(item =>
          `<li class="qs-item" data-code="${item.code}" data-name="${escapeHtml(item.name)}" data-idx="${idx}">
            <span class="qs-code">${item.code}</span>
            <span class="qs-name">${escapeHtml(item.name)}</span>
            <span class="qs-stock">${(item.totalStock||0).toLocaleString()}개</span>
          </li>`
        ).join('');
        resultsEl.querySelectorAll('.qs-item').forEach(el => {
          el.addEventListener('click', () => {
            const i = parseInt(el.dataset.idx);
            _outgoingLines[i].matched = state.items.find(it => it.code === parseInt(el.dataset.code));
            _outgoingLines[i].skipped = false;
            renderOutgoingPreview();
          });
        });
      }
      resultsEl.style.display = 'block';
    });
  });

  // 건너뜀 버튼
  contentEl.querySelectorAll('.og-skip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      _outgoingLines[idx].skipped = !_outgoingLines[idx].skipped;
      if (_outgoingLines[idx].skipped) _outgoingLines[idx].matched = null;
      renderOutgoingPreview();
    });
  });

  // 검색 변경 버튼 (매칭 취소 후 재검색 허용)
  contentEl.querySelectorAll('.og-rematch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      _outgoingLines[idx].matched = null;
      _outgoingLines[idx].skipped = false;
      renderOutgoingPreview();
    });
  });

  // 출고하기 버튼 — 미매칭·미건너뜀 없을 때만 활성화
  const active = _outgoingLines.filter(l => !l.matched && !l.skipped).length === 0;
  const confirmBtn = document.getElementById('outgoingConfirmBtn');
  if (confirmBtn) {
    confirmBtn.disabled = !active;
    confirmBtn.title = active ? '' : '미매칭 항목이 있습니다. 수정하거나 건너뛰어 주세요.';
  }
}

function renderOutgoingLine(line, idx) {
  if (line.skipped) {
    return `<div class="og-row og-skipped">
      <span class="og-status-icon">⏭</span>
      <span class="og-original-query">${escapeHtml(line.nameQuery)} / ${escapeHtml(line.qtyStr)}</span>
      <button class="og-skip-btn btn btn-outline" data-idx="${idx}" style="font-size:11px;padding:2px 8px;">건너뜀 취소</button>
    </div>`;
  }

  if (line.matched) {
    const gs = getGroupStock(line.matched.code);
    const deductStr = [
      line.stockBoxes > 0 ? `${line.stockBoxes}박스` : '',
      line.unitQty > 0 ? `${line.unitQty}개` : ''
    ].filter(Boolean).join(' ');
    const afterTotal = gs.totalStock - (line.stockBoxes * (line.matched.boxQty || 1)) - line.unitQty;
    const afterOk = afterTotal >= 0;
    return `<div class="og-row og-matched">
      <div class="og-row-header">
        <span class="og-status-icon">✅</span>
        <span class="og-original-query">${escapeHtml(line.nameQuery)}</span>
        <button class="og-rematch-btn" data-idx="${idx}">검색 변경</button>
      </div>
      <div class="og-match-info">
        <span class="og-full-name">${escapeHtml(line.matched.name)}</span>
      </div>
      <div class="og-numbers">
        <span class="og-deduct">− ${deductStr}</span>
        <span class="og-stock-after" ${!afterOk ? 'style="color:var(--danger);font-weight:700"' : ''}>
          출고 후: ${afterOk ? afterTotal.toLocaleString() + '개' : '재고 부족!'}
        </span>
        ${gs.earliestExpiry ? `<span class="og-expiry">소비기한: ${escapeHtml(gs.earliestExpiry)}</span>` : ''}
      </div>
    </div>`;
  }

  // 미매칭
  return `<div class="og-row og-unmatched">
    <div class="og-row-header">
      <span class="og-status-icon">⚠️</span>
      <span class="og-original-query">${escapeHtml(line.nameQuery)} / ${escapeHtml(line.qtyStr)}</span>
      <button class="og-skip-btn btn btn-outline" data-idx="${idx}" style="font-size:11px;padding:2px 8px;">건너뜀</button>
    </div>
    <div class="og-fix-area" style="position:relative">
      <input type="text" class="og-search-input form-input" data-idx="${idx}"
             placeholder="품명 또는 코드 재검색..." style="font-size:13px;margin-bottom:0">
      <ul class="og-search-results" style="display:none;position:absolute;z-index:100;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);width:100%;list-style:none;padding:0;margin:0;max-height:180px;overflow-y:auto;top:100%;left:0"></ul>
    </div>
  </div>`;
}

function processOutgoing(outLines) {
  outLines.filter(l => l.matched && !l.skipped).forEach(line => {
    const rows = state.items.filter(i => i.code === line.matched.code)
      .sort((a, b) => {
        const da = parseExpiry(a.expiryRaw, a.expiryPeriod).daysLeft;
        const db = parseExpiry(b.expiryRaw, b.expiryPeriod).daysLeft;
        if (da === null) return 1; if (db === null) return -1; return da - db;
      });
    let remainBoxes = line.stockBoxes, remainUnits = line.unitQty;
    for (const row of rows) {
      if (remainBoxes <= 0 && remainUnits <= 0) break;
      const takeBoxes = Math.min(remainBoxes, row.stockBoxes || 0);
      row.stockBoxes = (row.stockBoxes || 0) - takeBoxes; remainBoxes -= takeBoxes;
      const takeUnits = Math.min(remainUnits, row.unitQty || 0);
      row.unitQty = (row.unitQty || 0) - takeUnits; remainUnits -= takeUnits;
      row.totalStock = row.stockBoxes * (row.boxQty || 1) + row.unitQty;
    }
  });
}

function doConfirmedOutgoing() {
  if (!_outgoingLines || _outgoingLines.length === 0) return;
  const toProcess = _outgoingLines.filter(l => l.matched && !l.skipped);
  if (toProcess.length === 0) { showToast('출고할 항목이 없습니다.', 'error'); return; }

  // 되돌리기용 스냅샷
  const snapshots = [];
  toProcess.forEach(line => {
    state.items.filter(i => i.code === line.matched.code).forEach(r => snapshots.push({ ...r }));
  });

  processOutgoing(_outgoingLines);
  saveInventory(state.items);

  const label = toProcess.length === 1
    ? toProcess[0].matched.name
    : `${toProcess[0].matched.name} 외 ${toProcess.length - 1}개`;
  addLogEntry('out', label, { snapshots });

  _outgoingLines = null;
  closeModal('outgoingModal');
  renderAll();
  showToast(`${toProcess.length}개 항목이 출고되었습니다.`, 'success');
}

// ─── 품목 축약어 퍼지 검색 ────────────────────────────────────────────────────

function fuzzyMatchItems(query) {
  if (!query.trim()) return [];
  const tokens = query.toLowerCase().trim().split(/\s+/);
  const seen = new Set();
  const results = [];
  for (const item of state.items) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    const haystack = `${item.code} ${(item.name || '').toLowerCase()}`;
    if (tokens.every(t => haystack.includes(t))) {
      results.push(item);
      if (results.length >= 8) break;
    }
  }
  return results;
}

// ─── 메인 렌더링 ─────────────────────────────────────────────────────────────

function renderAll() {
  renderInventoryTable();
  renderExpirySoonBanner();
  renderLogPanel();
  // 비로그인 시 검색/필터/테이블헤더 숨김
  const controlBar = document.querySelector('.control-bar');
  const tableHeader = document.querySelector('.table-header');
  const columnHeader = document.querySelector('.compact-row[style]');
  const legendCard = document.querySelector('.legend-card');
  const display = state.isAdmin ? '' : 'none';
  if (controlBar) controlBar.style.display = state.isAdmin ? 'flex' : 'none';
  if (tableHeader) tableHeader.style.display = state.isAdmin ? 'flex' : 'none';
  if (columnHeader) columnHeader.style.display = state.isAdmin ? '' : 'none';
  if (legendCard) legendCard.style.display = state.isAdmin ? '' : 'none';
}

function renderInventoryTable() {
  const container = document.getElementById('inventoryContainer');
  if (!container) return;

  // 비로그인 시 재고 숨김
  if (!state.isAdmin) {
    const countEl = document.getElementById('itemCount');
    if (countEl) countEl.textContent = '';
    container.innerHTML = `
      <div class="login-required-state">
        <div class="lr-icon">🔒</div>
        <p class="lr-title">로그인이 필요합니다</p>
        <p class="lr-sub">재고현황을 확인하려면 상단에서 관리자 로그인을 해주세요.</p>
      </div>`;
    return;
  }

  let filtered = state.showExpiringSoon
    ? getExpiringSoon(state.items)
    : searchInventory(state.items, state.searchQuery);

  if (state.filterCode !== null && !state.showExpiringSoon) {
    filtered = filtered.filter(i => i.code === state.filterCode);
  }

  const groups = groupByCode(filtered);

  if (groups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <p>${state.searchQuery ? `"${escapeHtml(state.searchQuery)}" 검색 결과가 없습니다.` : '재고 데이터가 없습니다.'}</p>
      </div>`;
    return;
  }

  // 상단 카운트
  const totalItems = filtered.length;
  const totalGroups = groups.length;
  const countEl = document.getElementById('itemCount');
  if (countEl) countEl.textContent = `총 ${totalGroups}종 (${totalItems}개 행)`;

  container.innerHTML = groups.map(group => renderGroup(group)).join('');

  // 이벤트 바인딩
  bindTableEvents(container);
}

function renderGroup(group) {
  // 그룹 내 총 재고 합산
  const totalStock = group.reduce((sum, i) => sum + (i.totalStock || 0), 0);
  const totalBoxes = group.reduce((sum, i) => sum + (i.stockBoxes || 0), 0);
  const totalUnits = group.reduce((sum, i) => sum + (i.unitQty || 0), 0);
  const code = group[0].code;
  const name = group[0].name;

  // 이름에서 혼적 여부 확인
  const isGroupMixed = group.some(i => (i.name || '').includes('혼적'));

  // 소비기한 정보 - 각 행의 소비기한 파싱
  const expiryInfos = group.map(i => parseExpiry(i.expiryRaw, i.expiryPeriod));
  const hasMultipleExpiry = group.length > 1 || isGroupMixed;

  // 가장 빠른 소비기한 찾기
  const datesWithDays = expiryInfos
    .filter(e => e.daysLeft !== null && e.daysLeft !== undefined)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const earliestExpiry = datesWithDays[0] || expiryInfos[0];

  const badge = getExpiryBadge(earliestExpiry);
  const isExpanded = state.expandedIds.has(code);

  // 소비기한 6개월 미만인 행 하이라이트
  const hasWarn = expiryInfos.some(e => e.daysLeft !== null && e.daysLeft <= 180 && e.daysLeft >= 0);
  const hasCritical = expiryInfos.some(e => e.daysLeft !== null && e.daysLeft < 0 || (e.daysLeft !== null && e.daysLeft <= 30));

  return `
    <div class="item-group ${hasCritical ? 'group-critical' : hasWarn ? 'group-warn' : ''}" data-code="${code}">
      <div class="item-row compact-row" data-code="${code}">
        <div class="cell cell-code">${code}</div>
        <div class="cell cell-name">
          ${escapeHtml(name)}
          ${hasMultipleExpiry ? '<span class="multi-badge">여러 로트</span>' : ''}
        </div>
        <div class="cell cell-stock">
          <span class="stock-num">${totalStock.toLocaleString()}</span>
          <span class="stock-unit">개</span>
        </div>
        <div class="cell cell-expiry">
          <span class="expiry-badge ${badge.className}">${badge.label}</span>
          ${earliestExpiry?.text ? `<span class="expiry-date">${earliestExpiry.text}</span>` : ''}
        </div>
        <div class="cell cell-actions">
          <button class="btn-expand" data-code="${code}" title="${isExpanded ? '접기' : '펼쳐보기'}">
            ${isExpanded ? '▲ 접기' : '▼ 펼쳐보기'}
          </button>
          ${state.isAdmin ? `
            <button class="btn-edit-group" data-code="${code}" title="수정">✏️</button>
            <button class="btn-delete-group" data-code="${code}" title="삭제">🗑️</button>
          ` : ''}
        </div>
      </div>
      ${isExpanded ? renderExpandedRows(group, expiryInfos) : ''}
    </div>`;
}

function renderExpandedRows(group, expiryInfos) {
  return `
    <div class="expanded-section">
      <table class="detail-table">
        <thead>
          <tr>
            <th>품목코드</th>
            <th>품명 및 규격</th>
            <th>실재고(박스)</th>
            <th>낱개수량</th>
            <th>재고수량(총)</th>
            <th>박스당수량</th>
            <th>소비기한</th>
            <th>소비기한 유형</th>
            ${state.isAdmin ? '<th>관리</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${group.map((item, idx) => {
            const info = expiryInfos[idx];
            const badge = getExpiryBadge(info);
            const isMixed = (item.name || '').includes('혼적') || info.type === 'mixed';
            const warn = info.daysLeft !== null && info.daysLeft <= 180 && info.daysLeft >= 0;
            const critical = info.daysLeft !== null && (info.daysLeft < 0 || info.daysLeft <= 30);
            return `
              <tr class="detail-row ${critical ? 'row-critical' : warn ? 'row-warn' : ''} ${isMixed ? 'row-mixed' : ''}">
                <td>${item.code}</td>
                <td class="td-name">${escapeHtml(item.name || '')}</td>
                <td class="td-num">${item.stockBoxes || 0}</td>
                <td class="td-num">${item.unitQty || 0}</td>
                <td class="td-num bold">${(item.totalStock || 0).toLocaleString()}</td>
                <td class="td-num">${item.boxQty || 0}</td>
                <td class="td-expiry">
                  ${info.text || '-'}
                  ${info.dates && info.dates.length > 1 ? `<br><small class="multi-dates">${info.dates.map(d => formatDate(d)).join(', ')}</small>` : ''}
                </td>
                <td><span class="expiry-badge ${badge.className}">${badge.label}</span></td>
                ${state.isAdmin ? `
                  <td>
                    <button class="btn-sm btn-edit" data-id="${item.id}">수정</button>
                    <button class="btn-sm btn-del" data-id="${item.id}">삭제</button>
                  </td>` : ''}
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderExpirySoonBanner() {
  const banner = document.getElementById('expirySoonBanner');
  if (!banner) return;
  // 비로그인 시 배너 숨김
  if (!state.isAdmin) {
    banner.style.display = 'none';
    return;
  }
  const count = getExpiringSoon(state.items).length;
  if (count > 0) {
    banner.style.display = 'flex';
    banner.querySelector('.expiry-count').textContent = count;
  } else {
    banner.style.display = 'none';
  }
}

// ─── 이벤트 바인딩 ────────────────────────────────────────────────────────────

function bindTableEvents(container) {
  // 펼쳐보기 토글
  container.querySelectorAll('.btn-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = parseInt(btn.dataset.code);
      if (state.expandedIds.has(code)) {
        state.expandedIds.delete(code);
      } else {
        state.expandedIds.add(code);
      }
      renderInventoryTable();
    });
  });

  // 개별 행 수정
  container.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id)));
  });

  // 개별 행 삭제
  container.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteItem(parseInt(btn.dataset.id)));
  });

  // 그룹 수정 (그룹 내 첫 항목 수정)
  container.querySelectorAll('.btn-edit-group').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = parseInt(btn.dataset.code);
      const item = state.items.find(i => i.code === code);
      if (item) openEditModal(item.id);
    });
  });

  // 그룹 삭제 (그룹 전체 삭제)
  container.querySelectorAll('.btn-delete-group').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = parseInt(btn.dataset.code);
      confirmDeleteGroup(code);
    });
  });
}

// ─── 모달 ─────────────────────────────────────────────────────────────────────

function openEditModal(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  const modal = document.getElementById('editModal');
  const form = document.getElementById('editForm');
  if (!modal || !form) return;

  document.getElementById('editId').value = id;
  document.getElementById('editCode').value = item.code || '';
  document.getElementById('editName').value = item.name || '';
  document.getElementById('editStockBoxes').value = item.stockBoxes || 0;
  document.getElementById('editUnitQty').value = item.unitQty || 0;
  document.getElementById('editBoxQty').value = item.boxQty || 1;
  document.getElementById('editExpiryRaw').value = normalizeExpiryForEdit(item.expiryRaw || '');
  document.getElementById('editExpiryPeriod').value = item.expiryPeriod || '';

  modal.style.display = 'flex';
  modal.querySelector('.modal-title').textContent = `수정: ${item.name}`;
}

function openAddModal() {
  const modal = document.getElementById('addModal');
  if (!modal) return;
  document.getElementById('addText').value = '';
  document.getElementById('addResult').innerHTML = '';
  // Step 1로 초기화
  document.getElementById('addInputView').style.display = 'block';
  document.getElementById('addConfirmView').style.display = 'none';
  document.getElementById('addFooter1').style.display = 'flex';
  document.getElementById('addFooter2').style.display = 'none';
  const title = modal.querySelector('.modal-title');
  if (title) title.textContent = '재고 추가';
  _pendingAddItems = null;
  modal.style.display = 'flex';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

function setupModals() {
  // 배경 클릭으로 닫기
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });

  // 닫기 버튼
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay').style.display = 'none';
    });
  });

  // 수정 폼 제출
  const editForm = document.getElementById('editForm');
  if (editForm) {
    editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = parseInt(document.getElementById('editId').value);
      const updates = {
        code: parseInt(document.getElementById('editCode').value) || 0,
        name: document.getElementById('editName').value.trim(),
        stockBoxes: parseInt(document.getElementById('editStockBoxes').value) || 0,
        unitQty: parseInt(document.getElementById('editUnitQty').value) || 0,
        boxQty: parseInt(document.getElementById('editBoxQty').value) || 1,
        expiryRaw: document.getElementById('editExpiryRaw').value.trim(),
        expiryPeriod: document.getElementById('editExpiryPeriod').value.trim(),
      };
      const beforeItem = { ...state.items.find(i => i.id === id) };
      const hasChanged =
        beforeItem.code !== updates.code ||
        beforeItem.name !== updates.name ||
        beforeItem.stockBoxes !== updates.stockBoxes ||
        beforeItem.unitQty !== updates.unitQty ||
        beforeItem.boxQty !== updates.boxQty ||
        (beforeItem.expiryRaw || '') !== (updates.expiryRaw || '') ||
        (beforeItem.expiryPeriod || '') !== (updates.expiryPeriod || '');
      if (hasChanged) {
        updateItem(state.items, id, updates);
        saveInventory(state.items);
        addLogEntry('edit', beforeItem.name || `항목 #${id}`, { before: beforeItem });
      }
      closeModal('editModal');
      if (hasChanged) { renderAll(); showToast('수정되었습니다.', 'success'); }
      else showToast('변경사항이 없습니다.', 'info');
    });
  }

  // 되돌리기 확인 모달
  const revertOkBtn = document.getElementById('revertOkBtn');
  if (revertOkBtn) revertOkBtn.addEventListener('click', doRevert);
  const revertCancelBtn = document.getElementById('revertCancelBtn');
  if (revertCancelBtn) revertCancelBtn.addEventListener('click', () => closeModal('revertModal'));

  // 출고 물품 모달 — 미리보기/수정/출고 버튼
  const outgoingPreviewBtn = document.getElementById('outgoingPreviewBtn');
  if (outgoingPreviewBtn) outgoingPreviewBtn.addEventListener('click', showOutgoingPreview);

  const outgoingBackBtn = document.getElementById('outgoingBackBtn');
  if (outgoingBackBtn) {
    outgoingBackBtn.addEventListener('click', () => {
      document.getElementById('outgoingInputView').style.display = 'block';
      document.getElementById('outgoingPreviewView').style.display = 'none';
      document.getElementById('outgoingFooter1').style.display = 'flex';
      document.getElementById('outgoingFooter2').style.display = 'none';
      const title = document.querySelector('#outgoingModal .modal-title');
      if (title) title.textContent = '출고 물품 입력';
      _outgoingLines = null;
    });
  }

  const outgoingConfirmBtn = document.getElementById('outgoingConfirmBtn');
  if (outgoingConfirmBtn) outgoingConfirmBtn.addEventListener('click', doConfirmedOutgoing);

  // 추가 텍스트 미리보기
  const addText = document.getElementById('addText');
  if (addText) {
    addText.addEventListener('input', () => {
      const parsed = parseTextBlock(addText.value);
      const resultEl = document.getElementById('addResult');
      if (resultEl) {
        resultEl.innerHTML = parsed.length > 0
          ? `<p class="preview-count">${parsed.length}개 항목 인식됨</p>` +
            parsed.map(p => `<div class="preview-item">
              ${p.code ? `<span class="prev-code">${p.code}</span>` : ''}
              <span class="prev-name">${escapeHtml(p.name)}</span>
              <span class="prev-qty">${p.stockBoxes}박스 ${p.unitQty}개</span>
              ${p.expiryRaw ? `<span class="prev-exp">${escapeHtml(p.expiryRaw)}</span>` : ''}
            </div>`).join('')
          : '';
      }
    });
  }

  // 추가 — 다음(확인 미리보기) 버튼
  const addPreviewBtn = document.getElementById('addPreviewBtn');
  if (addPreviewBtn) addPreviewBtn.addEventListener('click', showAddConfirm);

  // 추가 — 수정(뒤로가기) 버튼
  const addBackBtn = document.getElementById('addBackBtn');
  if (addBackBtn) {
    addBackBtn.addEventListener('click', () => {
      document.getElementById('addInputView').style.display = 'block';
      document.getElementById('addConfirmView').style.display = 'none';
      document.getElementById('addFooter1').style.display = 'flex';
      document.getElementById('addFooter2').style.display = 'none';
      const title = document.querySelector('#addModal .modal-title');
      if (title) title.textContent = '재고 추가';
      _pendingAddItems = null;
    });
  }

  // 추가 — 최종 등록 버튼
  const addConfirmBtn = document.getElementById('addConfirmBtn');
  if (addConfirmBtn) addConfirmBtn.addEventListener('click', doConfirmedAdd);
}

// ─── 삭제 확인 ────────────────────────────────────────────────────────────────

function confirmDeleteItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  if (confirm(`"${item.name}" 항목을 삭제하시겠습니까?`)) {
    const snapshot = { ...item };
    deleteItem(state.items, id);
    saveInventory(state.items);
    addLogEntry('delete', item.name, { items: [snapshot] });
    renderAll();
    showToast('삭제되었습니다.', 'success');
  }
}

function confirmDeleteGroup(code) {
  const count = state.items.filter(i => i.code === code).length;
  const name = state.items.find(i => i.code === code)?.name || code;
  if (confirm(`"${name}" 그룹 전체 (${count}개 항목)를 삭제하시겠습니까?`)) {
    const snapshots = state.items.filter(i => i.code === code).map(i => ({ ...i }));
    const ids = snapshots.map(i => i.id);
    ids.forEach(id => deleteItem(state.items, id));
    saveInventory(state.items);
    state.expandedIds.delete(code);
    const delLabel = count === 1 ? name : `${name} 외 ${count - 1}개 (그룹)`;
    addLogEntry('delete', delLabel, { items: snapshots });
    renderAll();
    showToast(`${count}개 항목이 삭제되었습니다.`, 'success');
  }
}

// ─── 전역 버튼 이벤트 ─────────────────────────────────────────────────────────

function setupGlobalEvents() {
  // 로그아웃
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      AUTH.logout();
      state.isAdmin = false;
      updateAuthUI();
      renderAll();
      showToast('로그아웃되었습니다.', 'info');
    });
  }

  // 새 물품 추가 버튼
  const addBtn = document.getElementById('addItemBtn');
  if (addBtn) addBtn.addEventListener('click', openAddModal);

  // 출고 물품 버튼
  const outgoingBtn = document.getElementById('outgoingBtn');
  if (outgoingBtn) outgoingBtn.addEventListener('click', openOutgoingModal);

  // 소비기한 임박 필터 토글
  const expiringSoonBtn = document.getElementById('expiringSoonBtn');
  if (expiringSoonBtn) {
    expiringSoonBtn.addEventListener('click', () => {
      state.showExpiringSoon = !state.showExpiringSoon;
      expiringSoonBtn.classList.toggle('active', state.showExpiringSoon);
      expiringSoonBtn.textContent = state.showExpiringSoon
        ? '🔴 임박 필터 해제'
        : '⚠️ 6개월 이내 임박';
      renderAll();
    });
  }

  // 배너 내 임박 버튼
  const bannerBtn = document.getElementById('showExpiringSoonBtn');
  if (bannerBtn) {
    bannerBtn.addEventListener('click', () => {
      state.showExpiringSoon = true;
      const btn = document.getElementById('expiringSoonBtn');
      if (btn) {
        btn.classList.add('active');
        btn.textContent = '🔴 임박 필터 해제';
      }
      renderAll();
    });
  }

  // 변경 이력 전체 삭제
  const clearLogBtn = document.getElementById('clearLogBtn');
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      if (confirm('변경 이력을 전체 삭제하시겠습니까?')) {
        saveLog([]);
        renderLogPanel();
      }
    });
  }

  // 다운로드 드롭다운
  const exportBtn    = document.getElementById('exportBtn');
  const dlDropdown   = document.getElementById('dlDropdown');
  const dlWrap       = document.getElementById('dlWrap');
  if (exportBtn && dlDropdown) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dlDropdown.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!dlWrap || !dlWrap.contains(e.target)) dlDropdown.classList.remove('open');
    });
  }
  const exportXlsxBtn = document.getElementById('exportXlsxBtn');
  if (exportXlsxBtn) exportXlsxBtn.addEventListener('click', () => {
    dlDropdown.classList.remove('open');
    exportToXLSX();
  });
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => {
    dlDropdown.classList.remove('open');
    exportToCSV();
  });

  // 전체 펼치기/접기
  const expandAllBtn = document.getElementById('expandAllBtn');
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      const groups = groupByCode(state.items);
      if (state.expandedIds.size > 0) {
        state.expandedIds.clear();
        expandAllBtn.textContent = '전체 펼치기';
      } else {
        groups.forEach(g => state.expandedIds.add(g[0].code));
        expandAllBtn.textContent = '전체 접기';
      }
      renderInventoryTable();
    });
  }
}

// ─── 내보내기 ────────────────────────────────────────────────────────────────

function getExportRows() {
  return state.items.map(item => ({
    '품목코드':   item.code,
    '품명 및 규격': item.name || '',
    '실재고(박스)': item.stockBoxes || 0,
    '낱개수량':   item.unitQty || 0,
    '재고수량(총)': item.totalStock || 0,
    '박스당수량':  item.boxQty || 1,
    '소비기한':   item.expiryRaw || '',
    '소비기한기간': item.expiryPeriod || '',
  }));
}

function exportToXLSX() {
  if (typeof XLSX === 'undefined') {
    showToast('XLSX 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'error');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(getExportRows());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '재고현황');
  XLSX.writeFile(wb, `창고재고현황_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Excel 파일로 내보냈습니다.', 'success');
}

function exportToCSV() {
  const rows = getExportRows();
  const headers = Object.keys(rows[0] || {});
  const escape = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `창고재고현황_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV 파일로 내보냈습니다.', 'success');
}

// ─── 토스트 알림 ─────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── 변경 이력 패널 렌더링 ───────────────────────────────────────────────────

function renderLogPanel() {
  const panel = document.getElementById('logPanel');
  const listEl = document.getElementById('logList');
  if (!panel || !listEl) return;

  if (!state.isAdmin) {
    panel.classList.remove('visible');
    return;
  }

  panel.classList.add('visible');
  const log = loadLog();

  if (log.length === 0) {
    listEl.innerHTML = '<p class="log-empty">변경 이력이 없습니다</p>';
    return;
  }

  const ACTION_LABEL = { add: '추가', edit: '수정', delete: '삭제', out: '출고' };
  const ACTION_CLASS = { add: 'log-add', edit: 'log-edit', delete: 'log-del', out: 'log-out' };
  const pad = n => String(n).padStart(2, '0');

  listEl.innerHTML = log.map(entry => {
    const t = new Date(entry.time);
    const timeStr = `${pad(t.getMonth()+1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
    return `
      <div class="log-entry">
        <div class="log-meta">
          <span class="log-action ${ACTION_CLASS[entry.action]}">${ACTION_LABEL[entry.action]}</span>
          <span class="log-time">${timeStr}</span>
        </div>
        <div class="log-label">${escapeHtml(entry.label)}</div>
        <button class="btn-revert" data-log-id="${entry.id}">되돌리기</button>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.btn-revert').forEach(btn => {
    btn.addEventListener('click', () => revertLogEntry(Number(btn.dataset.logId)));
  });
}

function buildRevertCompareHTML(entry) {
  const FIELDS = [
    { key: 'code',         label: '품목코드' },
    { key: 'name',         label: '품명' },
    { key: 'stockBoxes',   label: '실재고(박스)' },
    { key: 'unitQty',      label: '낱개수량' },
    { key: 'boxQty',       label: '박스당수량' },
    { key: 'totalStock',   label: '재고수량(총)' },
    { key: 'expiryRaw',    label: '소비기한' },
    { key: 'expiryPeriod', label: '소비기한기간' },
  ];

  if (entry.action === 'edit') {
    const before = entry.undoData.before;
    const after  = state.items.find(i => i.id === before.id) || {};
    const rows = FIELDS.map(f => {
      const bv = String(before[f.key] ?? '');
      const av = String(after[f.key]  ?? '');
      const changed = bv !== av;
      return `<tr class="${changed ? 'rc-changed' : ''}">
        <td class="rc-field">${f.label}</td>
        <td>${changed ? `<span class="rc-strike">${escapeHtml(bv) || '—'}</span>` : escapeHtml(bv) || '—'}</td>
        <td>${changed ? `<span class="rc-new">${escapeHtml(av) || '—'}</span>` : escapeHtml(av) || '—'}</td>
      </tr>`;
    }).join('');
    return `<p class="rc-desc">수정 작업을 되돌리면 <strong>기존 내용</strong>으로 복원됩니다. (노란 행 = 변경된 항목)</p>
      <div class="rc-scroll"><table class="rc-table">
        <thead><tr><th>항목</th><th>기존 내용</th><th>변경 내용</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  if (entry.action === 'add') {
    const items = entry.undoData.ids.map(id => state.items.find(i => i.id === id)).filter(Boolean);
    const rows = items.map(item => `<tr>
      <td class="rc-field">${item.code}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="rc-num">${(item.totalStock || 0).toLocaleString()}개</td>
    </tr>`).join('');
    return `<p class="rc-desc">추가 작업을 되돌리면 아래 항목들이 <strong>삭제</strong>됩니다.</p>
      <div class="rc-scroll"><table class="rc-table">
        <thead><tr><th>코드</th><th>품명</th><th>재고수량</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  if (entry.action === 'delete') {
    const rows = entry.undoData.items.map(item => `<tr>
      <td class="rc-field">${item.code}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="rc-num">${(item.totalStock || 0).toLocaleString()}개</td>
    </tr>`).join('');
    return `<p class="rc-desc">삭제 작업을 되돌리면 아래 항목들이 <strong>복원</strong>됩니다.</p>
      <div class="rc-scroll"><table class="rc-table">
        <thead><tr><th>코드</th><th>품명</th><th>재고수량</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  if (entry.action === 'out') {
    const rows = entry.undoData.snapshots.map(snap => {
      const cur = state.items.find(i => i.id === snap.id);
      const stockBefore = snap.totalStock  || 0;
      const stockAfter  = cur?.totalStock  || 0;
      return `<tr>
        <td class="rc-field">${snap.code}</td>
        <td>${escapeHtml(snap.name)}</td>
        <td class="rc-num rc-before-val">${stockBefore.toLocaleString()}개</td>
        <td class="rc-num rc-after-val">${stockAfter.toLocaleString()}개</td>
      </tr>`;
    }).join('');
    return `<p class="rc-desc">출고 작업을 되돌리면 아래 항목들의 재고가 <strong>복원</strong>됩니다.</p>
      <div class="rc-scroll"><table class="rc-table">
        <thead><tr><th>코드</th><th>품명</th><th>기존 재고</th><th>변경 재고</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  return `<p class="rc-desc">이 작업을 되돌리시겠습니까?</p>`;
}

function revertLogEntry(logId) {
  const log = loadLog();
  const entry = log.find(e => e.id === logId);
  if (!entry) return;

  _pendingRevertLogId = logId;
  const body = document.getElementById('revertModalBody');
  if (body) body.innerHTML = buildRevertCompareHTML(entry);
  const actionLabel = { add: '추가', edit: '수정', delete: '삭제', out: '출고' }[entry.action] || '';
  const title = document.querySelector('#revertModal .modal-title');
  if (title) title.textContent = `되돌리기 확인 — ${entry.label} (${actionLabel})`;
  document.getElementById('revertModal').style.display = 'flex';
}

function doRevert() {
  const logId = _pendingRevertLogId;
  _pendingRevertLogId = null;
  closeModal('revertModal');

  const log = loadLog();
  const entry = log.find(e => e.id === logId);
  if (!entry) return;

  if (entry.action === 'edit') {
    const idx = state.items.findIndex(i => i.id === entry.undoData.before.id);
    if (idx === -1) { showToast('항목을 찾을 수 없습니다.', 'error'); return; }
    state.items[idx] = { ...entry.undoData.before };
  } else if (entry.action === 'add') {
    entry.undoData.ids.forEach(id => {
      const idx = state.items.findIndex(i => i.id === id);
      if (idx !== -1) state.items.splice(idx, 1);
    });
  } else if (entry.action === 'delete') {
    entry.undoData.items.forEach(item => state.items.push({ ...item }));
  } else if (entry.action === 'out') {
    entry.undoData.snapshots.forEach(snap => {
      const idx = state.items.findIndex(i => i.id === snap.id);
      if (idx !== -1) state.items[idx] = { ...snap };
    });
  }

  saveInventory(state.items);
  saveLog(log.filter(e => e.id !== logId));
  renderAll();
  showToast('되돌렸습니다.', 'info');
}

// ─── DOM 준비 후 시작 ─────────────────────────────────────────────────────────

function setupScrollTop() {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 320);
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

document.addEventListener('DOMContentLoaded', async () => {
  await init();
  setupModals();
  setupGlobalEvents();
  setupScrollTop();
});
