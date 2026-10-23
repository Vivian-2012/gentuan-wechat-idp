/**
 * 微信开放平台 · 网站应用扫码登录 (snsapi_login)
 * 文档: https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html
 */

export function buildQrConnectUrl({ appId, redirectUri, state }) {
  const u = new URL('https://open.weixin.qq.com/connect/qrconnect');
  u.searchParams.set('appid', appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'snsapi_login');
  u.searchParams.set('state', state);
  return u.toString() + '#wechat_redirect';
}

export async function exchangeCodeForUser({ appId, appSecret, code }) {
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.searchParams.set('appid', appId);
  tokenUrl.searchParams.set('secret', appSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');

  const tr = await fetch(tokenUrl.toString());
  const td = await tr.json();
  if (td.errcode || !td.access_token || !td.openid) {
    throw new Error(td.errmsg || `wechat token error: ${JSON.stringify(td)}`);
  }

  const infoUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  infoUrl.searchParams.set('access_token', td.access_token);
  infoUrl.searchParams.set('openid', td.openid);
  const ir = await fetch(infoUrl.toString());
  const info = await ir.json();
  if (info.errcode) {
    // userinfo 失败时仍可用 openid
    return {
      openid: td.openid,
      unionid: td.unionid || null,
      nickname: null,
      headimgurl: null,
    };
  }
  return {
    openid: info.openid || td.openid,
    unionid: info.unionid || td.unionid || null,
    nickname: info.nickname || null,
    headimgurl: info.headimgurl || null,
  };
}
