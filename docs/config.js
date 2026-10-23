/** 前端配置：按部署环境改 API_BASE */
window.GT_WECHAT = {
  // 本地 Worker
  API_BASE: 'http://127.0.0.1:8787',
  // 与现站相同的 session key，方便日后合并
  SESS_KEY: 'gentuan.session',
  // 登录成功后默认跳转（可改成主站跟团页）
  AFTER_LOGIN: './app.html',
};
