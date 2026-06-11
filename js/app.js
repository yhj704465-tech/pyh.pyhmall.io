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

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function init() {
  state.items = loadInventory();
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

// ─── 메인 렌더링 ─────────────────────────────────────────────────────────────

function renderAll() {
  renderInventoryTable();
  renderExpirySoonBanner();
}

function renderInventoryTable() {
  const container = document.getElementById('inventoryContainer');
  if (!container) return;

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
  document.getElementById('editExpiryRaw').value = item.expiryRaw || '';
  document.getElementById('editExpiryPeriod').value = item.expiryPeriod || '';

  modal.style.display = 'flex';
  modal.querySelector('.modal-title').textContent = `수정: ${item.name}`;
}

function openAddModal() {
  const modal = document.getElementById('addModal');
  if (!modal) return;
  document.getElementById('addText').value = '';
  document.getElementById('addResult').innerHTML = '';
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
      updateItem(state.items, id, updates);
      saveInventory(state.items);
      closeModal('editModal');
      renderAll();
      showToast('수정되었습니다.', 'success');
    });
  }

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

  // 추가 폼 제출
  const addForm = document.getElementById('addForm');
  if (addForm) {
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = document.getElementById('addText').value;
      const parsed = parseTextBlock(text);
      if (parsed.length === 0) {
        showToast('추가할 항목이 없습니다.', 'error');
        return;
      }
      addItems(state.items, parsed);
      saveInventory(state.items);
      closeModal('addModal');
      renderAll();
      showToast(`${parsed.length}개 항목이 추가되었습니다.`, 'success');
    });
  }
}

// ─── 삭제 확인 ────────────────────────────────────────────────────────────────

function confirmDeleteItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  if (confirm(`"${item.name}" 항목을 삭제하시겠습니까?`)) {
    deleteItem(state.items, id);
    saveInventory(state.items);
    renderAll();
    showToast('삭제되었습니다.', 'success');
  }
}

function confirmDeleteGroup(code) {
  const count = state.items.filter(i => i.code === code).length;
  const name = state.items.find(i => i.code === code)?.name || code;
  if (confirm(`"${name}" 그룹 전체 (${count}개 항목)를 삭제하시겠습니까?`)) {
    const ids = state.items.filter(i => i.code === code).map(i => i.id);
    ids.forEach(id => deleteItem(state.items, id));
    saveInventory(state.items);
    state.expandedIds.delete(code);
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

  // 추가 버튼
  const addBtn = document.getElementById('addItemBtn');
  if (addBtn) addBtn.addEventListener('click', openAddModal);

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

  // 데이터 초기화 (관리자 전용)
  const resetBtn = document.getElementById('resetDataBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('모든 재고 데이터를 초기 데이터(엑셀 기준)로 리셋하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
        localStorage.removeItem(STORAGE_KEY);
        state.items = loadInventory();
        state.expandedIds.clear();
        renderAll();
        showToast('데이터가 초기화되었습니다.', 'info');
      }
    });
  }

  // 엑셀 내보내기 (CSV)
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportToCSV);

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

// ─── CSV 내보내기 ─────────────────────────────────────────────────────────────

function exportToCSV() {
  const headers = ['품목코드', '품명 및 규격', '실재고', '낱개수량', '재고수량', '박스당수량', '소비기한', '소비기한년수'];
  const rows = state.items.map(item => [
    item.code, `"${(item.name || '').replace(/"/g, '""')}"`,
    item.stockBoxes, item.unitQty, item.totalStock, item.boxQty,
    `"${(item.expiryRaw || '').replace(/"/g, '""')}"`,
    `"${(item.expiryPeriod || '').replace(/"/g, '""')}"`
  ]);

  const csv = '﻿' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
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

// ─── DOM 준비 후 시작 ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await init();
  setupModals();
  setupGlobalEvents();
});
