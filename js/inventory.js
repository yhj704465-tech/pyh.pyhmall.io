// inventory.js - 재고 데이터 관리, 날짜 파싱, CRUD, 검색

const STORAGE_KEY = 'warehouse_inventory';

// ─── 날짜 유틸 ──────────────────────────────────────────────────────────────

// 엑셀 시리얼 → JS Date (엑셀 에폭 1899-12-30 기준, Unix 에폭 보정값 25569)
function excelSerialToDate(serial) {
  const d = new Date((serial - 25569) * 86400 * 1000);
  // UTC로 변환 시 날짜가 하루 밀릴 수 있어 로컬 날짜로 조정
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// 날짜 문자열 파싱 (YYYY-MM-DD, YYYY.MM.DD, YY-MM-DD 등)
function parseSimpleDate(str) {
  if (!str) return null;
  str = str.trim();
  // YYYY-MM-DD or YYYY.MM.DD
  let m = str.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // YY-MM-DD or YY.MM.DD
  m = str.match(/(\d{2})[-./](\d{2})[-./](\d{2})/);
  if (m) return new Date(2000 + +m[1], +m[2] - 1, +m[3]);
  return null;
}

// 날짜 → 표시 문자열 (YYYY-MM-DD)
function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 오늘 기준 D-day 계산 (양수 = 남은 날, 음수 = 지난 날)
function daysUntil(date) {
  if (!date || isNaN(date)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// ─── 소비기한 파싱 ────────────────────────────────────────────────────────────
// 반환: { type, date, dates, text, daysLeft }
// type: 'expiry'|'manufactured'|'mixed'|'multi'|'no_mfg_date'|'none'|'text'|'hardware'

function parseExpiry(expiryRaw, expiryPeriod) {
  const raw = (expiryRaw || '').trim();
  const period = (expiryPeriod || '').trim();

  if (!raw || raw === '.' || raw === '') {
    return { type: 'none', date: null, text: '' };
  }

  // 잡화 처리
  if (raw === '잡화') {
    return { type: 'hardware', date: null, text: '잡화' };
  }

  // 소비기한년수가 "제조일자 없음"인 경우
  if (period === '제조일자 없음') {
    // expiryRaw에 날짜가 있으면 그걸 소비기한으로 사용
    if (/^\d{5}$/.test(raw)) {
      const n = parseInt(raw);
      if (n > 40000 && n < 60000) {
        const date = excelSerialToDate(n);
        return { type: 'expiry', date, text: formatDate(date), daysLeft: daysUntil(date) };
      }
    }
    const d = parseSimpleDate(raw);
    if (d) return { type: 'expiry', date: d, text: formatDate(d), daysLeft: daysUntil(d) };
    return { type: 'no_mfg_date', date: null, text: '제조일자 없음' };
  }

  // 혼적 포함 여부 확인 (이름 또는 날짜에 있을 수 있음)
  const isMixed = raw.includes('혼적');

  if (isMixed) {
    // 날짜 추출: "2026-08-19, 2026-09-15 혼적", "2027-05-05 이후 혼적" 등
    const cleaned = raw.replace(/혼적.*$/i, '').replace(/이후/g, '').trim();
    const parts = cleaned.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean);
    const dates = parts.map(p => parseSimpleDate(p)).filter(Boolean);
    if (dates.length > 0) {
      dates.sort((a, b) => a - b);
      const earliest = dates[0];
      return {
        type: 'mixed', date: earliest, dates,
        text: formatDate(earliest),
        daysLeft: daysUntil(earliest)
      };
    }
    return { type: 'mixed', date: null, dates: [], text: '혼적' };
  }

  // 다중 날짜 (쉼표 구분, 줄바꿈 구분)
  if (raw.includes(',') || (raw.includes('\n') && raw.match(/\d{4}/g)?.length > 1)) {
    const parts = raw.split(/[,\n\r]+/).map(s => s.trim()).filter(Boolean);
    const dates = parts.map(p => {
      const num = parseFloat(p);
      if (!isNaN(num) && num > 40000) return excelSerialToDate(num);
      return parseSimpleDate(p);
    }).filter(Boolean);

    if (dates.length > 1) {
      dates.sort((a, b) => a - b);
      return {
        type: 'multi', date: dates[0], dates,
        text: formatDate(dates[0]),
        daysLeft: daysUntil(dates[0])
      };
    }
  }

  // 제조일 표시 처리
  if (raw.includes('제조') || raw.toLowerCase().includes('도정')) {
    const cleaned = raw.replace(/제조일자없음|제조일자\s*없음/gi, '')
      .replace(/제조\s*:\s*/gi, '').replace(/도정\s*/gi, '').replace(/제조/g, '').trim();
    const mfgDate = parseSimpleDate(cleaned);

    if (mfgDate) {
      // 소비기한년수에서 개월 수 추출
      const monthMatch = period.match(/(\d+)개월/);
      if (monthMatch) {
        const months = parseInt(monthMatch[1]);
        const expiry = new Date(mfgDate);
        expiry.setMonth(expiry.getMonth() + months);
        return {
          type: 'manufactured', date: expiry, mfgDate,
          text: formatDate(expiry),
          daysLeft: daysUntil(expiry)
        };
      }
      return { type: 'manufactured', date: null, mfgDate, text: `제조 ${formatDate(mfgDate)}`, daysLeft: null };
    }
    return { type: 'manufactured', date: null, text: raw };
  }

  // YYYYMMDD (8자리: 20250505 → 2025-05-05)
  if (/^\d{8}$/.test(raw)) {
    const yyyy = parseInt(raw.slice(0, 4)), mm = parseInt(raw.slice(4, 6)), dd = parseInt(raw.slice(6, 8));
    if (yyyy >= 1900 && yyyy <= 2200 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const date = new Date(yyyy, mm - 1, dd);
      return { type: 'expiry', date, text: formatDate(date), daysLeft: daysUntil(date) };
    }
  }

  // YYMMDD (6자리: 250505 → 2025-05-05)
  if (/^\d{6}$/.test(raw)) {
    const yy = parseInt(raw.slice(0, 2)), mm = parseInt(raw.slice(2, 4)), dd = parseInt(raw.slice(4, 6));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const date = new Date(yy <= 50 ? 2000 + yy : 1900 + yy, mm - 1, dd);
      return { type: 'expiry', date, text: formatDate(date), daysLeft: daysUntil(date) };
    }
  }

  // 엑셀 시리얼 숫자 (5자리, 40000~60000 범위)
  if (/^\d{5}$/.test(raw)) {
    const num = parseInt(raw);
    if (num > 40000 && num < 60000) {
      const date = excelSerialToDate(num);
      return { type: 'expiry', date, text: formatDate(date), daysLeft: daysUntil(date) };
    }
  }

  // 일반 날짜 문자열
  const d = parseSimpleDate(raw);
  if (d) return { type: 'expiry', date: d, text: formatDate(d), daysLeft: daysUntil(d) };

  // 알 수 없는 텍스트
  return { type: 'text', date: null, text: raw };
}

// ─── 소비기한 유형별 뱃지 정보 ─────────────────────────────────────────────
function getExpiryBadge(expiryInfo) {
  if (!expiryInfo) return { label: '-', className: 'badge-none' };
  const { type, daysLeft, date } = expiryInfo;

  if (type === 'hardware') return { label: '잡화', className: 'badge-hardware' };
  if (type === 'none') return { label: '소비기한 없음', className: 'badge-none' };
  if (type === 'no_mfg_date') return { label: '제조일자 없음', className: 'badge-no-mfg' };
  if (type === 'mixed') return { label: '혼적', className: 'badge-mixed' };
  if (type === 'multi') return { label: '다중소비기한', className: 'badge-multi' };
  if (type === 'manufactured') {
    if (!date) return { label: '제조일 기준', className: 'badge-mfg' };
  }
  if (type === 'text') return { label: expiryInfo.text || '-', className: 'badge-text' };

  // 날짜 기반 - 잔여일 계산
  if (daysLeft !== null) {
    if (daysLeft < 0) return { label: '만료됨', className: 'badge-expired' };
    if (daysLeft <= 30) return { label: `D-${daysLeft}`, className: 'badge-critical' };
    if (daysLeft <= 180) return { label: `D-${daysLeft}`, className: 'badge-warning' };
    return { label: `D-${daysLeft}`, className: 'badge-normal' };
  }
  return { label: expiryInfo.text || '-', className: 'badge-normal' };
}

// ─── 데이터 저장소 ─────────────────────────────────────────────────────────

function loadInventory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data; // 빈 배열도 명시적으로 저장된 상태로 존중
    }
  } catch {}
  // localStorage에 키 자체가 없을 때만 초기 데이터 사용
  const initial = JSON.parse(JSON.stringify(INITIAL_INVENTORY));
  saveInventory(initial);
  return initial;
}

function saveInventory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// nextId 계산
function getNextId(items) {
  return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
}

// ─── 검색 ─────────────────────────────────────────────────────────────────

function searchInventory(items, query) {
  if (!query || !query.trim()) return items;
  const q = query.trim().toLowerCase();
  return items.filter(item =>
    String(item.code).includes(q) ||
    (item.name || '').toLowerCase().includes(q) ||
    (item.expiryRaw || '').toLowerCase().includes(q)
  );
}

// 자동완성 후보 (품명 + 코드)
function getAutocompleteSuggestions(items, query, maxResults = 8) {
  if (!query || query.length < 1) return [];
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const results = [];

  for (const item of items) {
    const nameMatch = (item.name || '').toLowerCase().includes(q);
    const codeMatch = String(item.code).startsWith(q);
    if (!nameMatch && !codeMatch) continue;

    const key = `${item.code}|${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ code: item.code, name: item.name });
    if (results.length >= maxResults) break;
  }
  return results;
}

// ─── 그룹핑: 같은 코드 항목 묶기 ─────────────────────────────────────────

function groupByCode(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.code)) {
      map.set(item.code, []);
    }
    map.get(item.code).push(item);
  }
  return Array.from(map.values());
}

// ─── CRUD 텍스트 파서 ─────────────────────────────────────────────────────
// 형식: 품목코드/품명/박스수 박스,낱개수 개/소비기한
// 또는: 품명/수량/소비기한 (코드 없이)
// 수량: "3박스", "50개", "3박스,5개", "3 박스", "5 개"

function parseTextEntry(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('/').map(s => s.trim());
  if (parts.length < 2) return null;

  let code = null, name = '', qtyStr = '', expiryStr = '', period = '';

  if (parts.length >= 4) {
    // code/name/qty/expiry
    code = parseInt(parts[0]);
    name = parts[1];
    qtyStr = parts[2];
    expiryStr = parts[3];
    period = parts[4] || '';
  } else if (parts.length === 3) {
    if (/^\d+$/.test(parts[0].trim())) {
      // code/name/qty (소비기한 미기재)
      code = parseInt(parts[0]);
      name = parts[1];
      qtyStr = parts[2];
    } else {
      // name/qty/expiry (코드 없음)
      name = parts[0];
      qtyStr = parts[1];
      expiryStr = parts[2];
    }
  } else {
    // name/qty
    name = parts[0];
    qtyStr = parts[1];
  }

  if (!name) return null;

  // 수량 파싱
  let stockBoxes = 0, unitQty = 0;
  const segments = qtyStr.split(',').map(s => s.trim());
  for (const seg of segments) {
    const boxMatch = seg.match(/(\d+)\s*박스/);
    const unitMatch = seg.match(/(\d+)\s*개/);
    if (boxMatch) stockBoxes = parseInt(boxMatch[1]);
    else if (unitMatch) unitQty = parseInt(unitMatch[1]);
    else {
      // 순수 숫자면 박스로 처리
      const num = parseInt(seg);
      if (!isNaN(num) && stockBoxes === 0) stockBoxes = num;
    }
  }

  // 소비기한에서 혼적 처리
  let expiryRaw = expiryStr;
  if (expiryStr.includes('혼적')) {
    // 혼적 형식 그대로 보존
    expiryRaw = expiryStr;
  }

  return {
    code: isNaN(code) ? null : code,
    name,
    stockBoxes,
    unitQty,
    expiryRaw,
    expiryPeriod: period,
    boxQty: 1
  };
}

// 여러 줄 텍스트를 파싱하여 항목 배열 반환
function parseTextBlock(text) {
  return text.split('\n')
    .map(parseTextEntry)
    .filter(Boolean);
}

// 동일 코드 그룹에서 가장 늦은 소비기한 raw 문자열 반환
function getLatestExpiryForCode(items, code) {
  const rows = items.filter(i => i.code === code && i.expiryRaw);
  if (rows.length === 0) return null;
  let latest = null, latestDate = null;
  for (const r of rows) {
    const info = parseExpiry(r.expiryRaw, r.expiryPeriod);
    if (info.date && (!latestDate || info.date > latestDate)) {
      latestDate = info.date;
      latest = r.expiryRaw;
    }
  }
  return latest;
}

// ─── CRUD 작업 ─────────────────────────────────────────────────────────────

function addItems(items, newItems) {
  let nextId = getNextId(items);
  const added = [];
  const maxCode = items.length > 0 ? Math.max(...items.map(i => i.code || 0)) : 0;
  let autoCode = maxCode;

  for (const entry of newItems) {
    const boxQty = entry.boxQty || 1;

    // 소비기한 미기재 시 동일 코드의 최신 소비기한으로 자동 채움
    let expiryRaw = entry.expiryRaw || '';
    if (!expiryRaw && entry.code) {
      expiryRaw = getLatestExpiryForCode(items, entry.code) || '';
    }

    // 동일 코드 + 동일 소비기한 → 기존 로트에 재고 합산 (병합)
    if (entry.code) {
      const existing = items.find(i =>
        i.code === entry.code && (i.expiryRaw || '') === (expiryRaw || '')
      );
      if (existing) {
        existing.stockBoxes = (existing.stockBoxes || 0) + (entry.stockBoxes || 0);
        existing.unitQty    = (existing.unitQty    || 0) + (entry.unitQty    || 0);
        existing.totalStock = existing.stockBoxes * (existing.boxQty || 1) + existing.unitQty;
        // 병합 항목도 added 에 넣어 doConfirmedAdd 에서 카운트 가능하게
        added.push(existing);
        continue;
      }
    }

    // 코드 없는 신규 → 자동 코드 부여
    const finalCode = entry.code || (++autoCode);

    const totalStock = (entry.stockBoxes || 0) * boxQty + (entry.unitQty || 0);
    const item = {
      id: nextId++,
      code: finalCode,
      name: entry.name,
      stockBoxes: entry.stockBoxes || 0,
      unitQty:    entry.unitQty    || 0,
      totalStock,
      boxQty,
      expiryRaw,
      expiryPeriod: entry.expiryPeriod || '',
      hasMulti: false
    };
    items.push(item);
    added.push(item);
  }
  return added;
}

function updateItem(items, id, updates) {
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return false;
  const item = items[idx];
  Object.assign(item, updates);
  if ('stockBoxes' in updates || 'unitQty' in updates || 'boxQty' in updates) {
    item.totalStock = (item.stockBoxes || 0) * (item.boxQty || 1) + (item.unitQty || 0);
  }
  return true;
}

function deleteItem(items, id) {
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return false;
  items.splice(idx, 1);
  return true;
}

// ─── 6개월 미만 항목 필터 ─────────────────────────────────────────────────

function getExpiringSoon(items, withinDays = 180) {
  return items.filter(item => {
    const info = parseExpiry(item.expiryRaw, item.expiryPeriod);
    if (!info.daysLeft && info.daysLeft !== 0) return false;
    return info.daysLeft <= withinDays;
  });
}
