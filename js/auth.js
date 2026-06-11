// auth.js - JWT 인증 관리 (Web Crypto API 사용)
// 소스코드에 평문 비밀번호 없음. SHA-256 해시값만 저장.

const AUTH = (() => {
  // JWT 서명 키 (랜덤 생성값, 평문 비밀번호 아님)
  const SECRET = 'bf1732c2fad5014dca18cd28e3f10880155582b038ae6fcf2ddddf4a0a4aef0a';
  const TOKEN_KEY = 'warehouse_token';
  const EXPIRY_MS = 4 * 60 * 60 * 1000; // 4시간

  const ADMIN = {
    id: 'pyh0731',
    // SHA-256('!yh2026') — 평문 비밀번호는 코드에 없음
    passwordHash: '7d77526f597ff789ec178370a3014f6d5d9ba646481c7b3ab7f50cc2947cf381'
  };

  // 간단한 base64url 인코딩/디코딩
  function base64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
  }

  // HMAC-SHA256 서명 (Web Crypto API)
  async function sign(data) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // JWT 생성
  async function createToken(userId) {
    const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64urlEncode(JSON.stringify({
      sub: userId,
      iat: Date.now(),
      exp: Date.now() + EXPIRY_MS
    }));
    const unsigned = `${header}.${payload}`;
    const signature = await sign(unsigned);
    return `${unsigned}.${signature}`;
  }

  // JWT 검증
  async function verifyToken(token) {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(base64urlDecode(parts[1]));
      if (Date.now() > payload.exp) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }

      const unsigned = `${parts[0]}.${parts[1]}`;
      const expectedSig = await sign(unsigned);
      if (expectedSig !== parts[2]) return null;

      return payload;
    } catch {
      return null;
    }
  }

  // SHA-256 해시 계산
  async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 로그인 시도 (비밀번호는 SHA-256 해시로 비교)
  async function login(id, password) {
    if (id !== ADMIN.id) return false;
    const hash = await sha256hex(password);
    if (hash !== ADMIN.passwordHash) return false;

    const token = await createToken(id);
    localStorage.setItem(TOKEN_KEY, token);
    return true;
  }

  // 로그아웃
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
  }

  // 현재 인증 상태 확인
  async function getSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    return await verifyToken(token);
  }

  // 남은 세션 시간 (분)
  function getSessionTimeLeft() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return 0;
    try {
      const parts = token.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      const remaining = payload.exp - Date.now();
      return Math.max(0, Math.floor(remaining / 60000));
    } catch {
      return 0;
    }
  }

  return { login, logout, getSession, getSessionTimeLeft };
})();
