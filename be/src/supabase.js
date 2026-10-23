/**
 * 用 Service Role 为微信用户创建/登录 Supabase Auth，返回与现站兼容的 session 字段。
 * email 使用确定性伪邮箱：wx_<openid>@wechat.local（不可收信，仅作 Auth 标识）
 */

function wxEmail(openid) {
  const safe = String(openid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return `wx_${safe}@wechat.idp.local`;
}

async function sbFetch(env, path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${env.SUPABASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) {
    const msg = (data && (data.msg || data.error_description || data.message || data.error)) || text || r.status;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

/** 确保用户存在，返回 user id */
async function ensureUser(env, { openid, unionid, nickname, isAdmin }) {
  const email = wxEmail(openid);
  const password = `Wx!${await sha256Short(env.SESSION_SECRET + openid)}`;

  // 尝试创建；已存在则忽略
  try {
    await sbFetch(env, '/auth/v1/admin/users', {
      method: 'POST',
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          provider: 'wechat',
          openid,
          unionid,
          nickname,
          is_admin: !!isAdmin,
        },
      },
    });
  } catch (e) {
    const m = String(e.message || e);
    if (!/already|registered|exists|duplicate/i.test(m)) {
      // 继续尝试用密码登录；若失败再抛
      console.log('create user note:', m);
    }
  }

  // password grant 拿 session（优先 anon key）
  const apiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const tr = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const token = await tr.json();
  if (!tr.ok || !token.access_token) {
    throw new Error(token.error_description || token.msg || token.error || 'password grant failed');
  }

  // 更新 metadata（管理员标记可能变化）
  if (token.user && token.user.id) {
    try {
      await sbFetch(env, `/auth/v1/admin/users/${token.user.id}`, {
        method: 'PUT',
        body: {
          user_metadata: {
            provider: 'wechat',
            openid,
            unionid,
            nickname,
            is_admin: !!isAdmin,
          },
        },
      });
    } catch (_) {}
  }

  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: token.expires_at,
    email: (token.user && token.user.email) || email,
    user_id: token.user && token.user.id,
    openid,
    unionid,
    nickname,
    is_admin: !!isAdmin,
    provider: 'wechat',
  };
}

async function sha256Short(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export async function createSupabaseSessionForWechat(env, profile, isAdmin) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return ensureUser(env, { ...profile, isAdmin });
}

/** 无 Supabase 时的本地演示会话（不能调受 RLS 保护的 API） */
export function mockLocalSession(profile, isAdmin) {
  return {
    access_token: `mock.${profile.openid}`,
    refresh_token: null,
    expires_at: Math.floor(Date.now() / 1000) + 86400 * 7,
    email: profile.nickname || profile.openid,
    openid: profile.openid,
    unionid: profile.unionid,
    nickname: profile.nickname,
    is_admin: !!isAdmin,
    provider: 'wechat',
    mock: true,
  };
}
