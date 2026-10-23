/**
 * Cloudflare Worker · 微信 IdP
 *
 * GET  /health
 * GET  /auth/wechat/start
 * GET  /auth/wechat/callback?code=&state=
 * GET  /auth/me   (Authorization: Bearer <access_token>) — 轻量探测
 */

import { randomState, signState, verifyState } from './crypto.js';
import { buildQrConnectUrl, exchangeCodeForUser } from './wechat.js';
import { createSupabaseSessionForWechat, mockLocalSession } from './supabase.js';

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      ...extra,
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function isAdminOpenId(env, profile) {
  const raw = String(env.ADMIN_OPENIDS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!raw.length) {
    // 未配置白名单时：MOCK 模式下默认管理员，方便本地调试
    return String(env.MOCK_WECHAT || '') === '1';
  }
  const ids = new Set(raw);
  return ids.has(profile.openid) || (profile.unionid && ids.has(profile.unionid));
}

function frontendUrl(env) {
  return String(env.FRONTEND_URL || 'http://127.0.0.1:5500').replace(/\/$/, '');
}

function apiPublicUrl(env, request) {
  if (env.PUBLIC_API_URL) return String(env.PUBLIC_API_URL).replace(/\/$/, '');
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

function redirectWithSession(env, session) {
  const fe = frontendUrl(env);
  const payload = encodeURIComponent(JSON.stringify(session));
  return Response.redirect(`${fe}/auth/callback.html#session=${payload}`, 302);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    try {
      if (path === '/health' || path === '/') {
        return json({
          ok: true,
          service: 'gentuan-wechat-idp',
          mock: String(env.MOCK_WECHAT || '') === '1',
          hasWechat: !!(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET),
          hasSupabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        });
      }

      if (path === '/auth/wechat/start') {
        const secret = env.SESSION_SECRET || 'dev-only-insecure';
        const state = await signState(secret, { ts: Math.floor(Date.now() / 1000), n: randomState(8) });
        const redirectUri = `${apiPublicUrl(env, request)}/auth/wechat/callback`;

        if (String(env.MOCK_WECHAT || '') === '1') {
          // 本地无微信凭证：直接假回调
          const mockUrl = new URL(`${apiPublicUrl(env, request)}/auth/wechat/callback`);
          mockUrl.searchParams.set('code', 'mock-code');
          mockUrl.searchParams.set('state', state);
          return Response.redirect(mockUrl.toString(), 302);
        }

        if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) {
          return json({ error: 'WECHAT_APP_ID / WECHAT_APP_SECRET 未配置，或设置 MOCK_WECHAT=1' }, 500);
        }

        const go = buildQrConnectUrl({
          appId: env.WECHAT_APP_ID,
          redirectUri,
          state,
        });
        return Response.redirect(go, 302);
      }

      if (path === '/auth/wechat/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const secret = env.SESSION_SECRET || 'dev-only-insecure';

        if (!code) {
          return html('<h1>登录取消</h1><p>未返回 code。</p><a href="/">返回</a>', 400);
        }
        const st = await verifyState(secret, state);
        if (!st) {
          return html('<h1>state 无效或过期</h1><p>请重新发起登录。</p>', 400);
        }

        let profile;
        if (String(env.MOCK_WECHAT || '') === '1') {
          profile = {
            openid: env.MOCK_OPENID || 'mock-admin-openid',
            unionid: 'mock-unionid',
            nickname: 'Mock微信用户',
            headimgurl: null,
          };
        } else {
          profile = await exchangeCodeForUser({
            appId: env.WECHAT_APP_ID,
            appSecret: env.WECHAT_APP_SECRET,
            code,
          });
        }

        const admin = isAdminOpenId(env, profile);
        let session = await createSupabaseSessionForWechat(env, profile, admin);
        if (!session) {
          session = mockLocalSession(profile, admin);
        }
        session.is_admin = admin;
        return redirectWithSession(env, session);
      }

      if (path === '/auth/me') {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        if (!token) return json({ error: 'unauthorized' }, 401);
        if (token.startsWith('mock.')) {
          return json({ mock: true, openid: token.slice(5), note: '本地 mock 会话，未连接 Supabase' });
        }
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
          return json({ error: 'supabase not configured' }, 500);
        }
        const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
          headers: {
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
        });
        const d = await r.json();
        if (!r.ok) return json({ error: d }, r.status);
        return json({ user: d });
      }

      return json({ error: 'not found', path }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: String(e.message || e) }, 500);
    }
  },
};
