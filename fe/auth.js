(function (global) {
  const cfg = () => global.GT_WECHAT || {};
  const SESS_KEY = () => cfg().SESS_KEY || 'gentuan.session';

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESS_KEY()) || 'null');
    } catch (e) {
      return null;
    }
  }
  function setSession(s) {
    if (s) localStorage.setItem(SESS_KEY(), JSON.stringify(s));
    else localStorage.removeItem(SESS_KEY());
  }
  function isLoggedIn() {
    const s = getSession();
    return !!(s && s.access_token);
  }
  function isAdmin() {
    const s = getSession();
    if (!s || !s.access_token) return false;
    if (s.is_admin === true) return true;
    // 兼容现站：有有效 supabase token 即视为可管理（合并前）
    return !s.mock;
  }
  function startWechatLogin() {
    const base = (cfg().API_BASE || '').replace(/\/$/, '');
    if (!base) {
      alert('未配置 API_BASE');
      return;
    }
    location.href = base + '/auth/wechat/start';
  }
  function logout() {
    setSession(null);
    location.href = './index.html';
  }
  function displayName() {
    const s = getSession();
    if (!s) return '';
    return s.nickname || s.email || s.openid || '已登录';
  }

  global.GTAuth = {
    getSession,
    setSession,
    isLoggedIn,
    isAdmin,
    startWechatLogin,
    logout,
    displayName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
