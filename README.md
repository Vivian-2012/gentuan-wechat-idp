# gentuan-wechat-idp

微信作为 **IdP（身份登录）** 的独立试验仓库：静态前端 + Cloudflare Worker 后端。  
与现有 GitHub Pages 站点（邮箱登录）分离，互不影响。

> **不包含微信支付。** 登录认证 ≠ 收款；约 1000 终端用户规模下，仅 IdP 无微信支付月费。

## 结构

```
docs/     静态前端（可另部署到 GitHub Pages / Cloudflare Pages）
be/     Cloudflare Worker：微信 OAuth + 签发 Supabase 会话
```

## 登录流程

```
用户点「微信登录」
  → FE 跳到 BE /auth/wechat/start
  → 微信扫码（或 MOCK 模式）
  → BE /auth/wechat/callback 用 code 换 openid
  → 若配置了 SUPABASE_SERVICE_ROLE_KEY：为该微信用户创建/登录 Supabase 用户并拿 session
  → 跳回 FE /auth/callback.html，写入 localStorage（兼容 gentuan.session）
```

管理员判定：`ADMIN_OPENIDS` 含该用户的 `openid` / `unionid`。

## 本地运行

### 1. 后端

```bash
cd be
cp ../.env.example .dev.vars   # 编辑填入密钥；本地可先 MOCK_WECHAT=1
npm install
npm run dev                    # http://127.0.0.1:8787
```

### 2. 前端

用任意静态服务器打开 `docs/`，例如：

```bash
cd docs
python3 -m http.server 5500
```

浏览器打开 `http://127.0.0.1:5500`，确认 `config.js` 里 `API_BASE` 指向 Worker。

## 生产部署

1. **后端**：`cd be && npx wrangler secret put WECHAT_APP_SECRET`（等逐项），再 `npm run deploy`  
2. **前端**：把 `docs/` 推到**另一个** GitHub repo 的 Pages，或 Cloudflare Pages  
3. 微信开放平台配置授权回调域名为 Worker 域名；`redirect_uri` 为  
   `https://<worker>/auth/wechat/callback`  
4. 开放平台网站应用需主体认证（常见一次性认证费，以微信当前规则为准）

## 和现站关系

| | 现站 transport-china-sweden | 本仓库 |
|--|------------------------------|--------|
| 登录 | Supabase 邮箱密码 | 微信扫码 IdP |
| 区域密码 | 有 | 前端可继续复用同一 Supabase |
| 部署 | 已有 Pages | 建议独立 Pages / Worker |

验证稳定后再考虑把微信登录合并回主站。

## 安全

- `WECHAT_APP_SECRET`、`SUPABASE_SERVICE_ROLE_KEY` **只放 Worker secrets**，禁止提交 git  
- 前端只持有 anon key（与现站相同）
