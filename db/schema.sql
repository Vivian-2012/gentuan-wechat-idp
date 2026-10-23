-- ============================================================
-- gentuan-wechat-idp · DB（建议与现站同一 Supabase 项目）
-- Supabase → SQL Editor 整段执行（可重复执行）
--
-- Auth：仍用 auth.users（由 Worker Service Role 创建）
-- 本文件：微信身份映射 + 管理员白名单
-- ============================================================

-- 微信身份 ↔ Supabase 用户
CREATE TABLE IF NOT EXISTS public.wechat_identities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  openid        text NOT NULL,
  unionid       text,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nickname      text,
  avatar_url    text,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wechat_identities_openid_key UNIQUE (openid)
);

CREATE UNIQUE INDEX IF NOT EXISTS wechat_identities_unionid_uidx
  ON public.wechat_identities (unionid)
  WHERE unionid IS NOT NULL;

COMMENT ON TABLE public.wechat_identities IS '微信 IdP 身份映射；openid 唯一';

-- 管理员白名单（openid 或 unionid，二选一即可）
CREATE TABLE IF NOT EXISTS public.wechat_admin_allowlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  openid     text,
  unionid    text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wechat_admin_need_id CHECK (openid IS NOT NULL OR unionid IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS wechat_admin_openid_uidx
  ON public.wechat_admin_allowlist (openid)
  WHERE openid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wechat_admin_unionid_uidx
  ON public.wechat_admin_allowlist (unionid)
  WHERE unionid IS NOT NULL;

COMMENT ON TABLE public.wechat_admin_allowlist IS '微信管理员白名单；也可继续用 Worker 环境变量 ADMIN_OPENIDS';

-- updated_at 触发器
CREATE OR REPLACE FUNCTION public.wechat_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wechat_identities_updated_at ON public.wechat_identities;
CREATE TRIGGER wechat_identities_updated_at
  BEFORE UPDATE ON public.wechat_identities
  FOR EACH ROW EXECUTE FUNCTION public.wechat_set_updated_at();

-- RLS：默认拒绝 anon；仅 service_role / 登录本人可读自己的行
ALTER TABLE public.wechat_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wechat_admin_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wechat_identities_select_own ON public.wechat_identities;
CREATE POLICY wechat_identities_select_own ON public.wechat_identities
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- allowlist 不给前端读（防枚举）；仅 service_role 通过绕过 RLS 读写
DROP POLICY IF EXISTS wechat_admin_deny_all ON public.wechat_admin_allowlist;
-- 无 policy = authenticated/anon 无法访问；service_role 绕过 RLS

-- RPC：判断当前用户是否管理员（供前端/现站调用）
CREATE OR REPLACE FUNCTION public.is_wechat_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wechat_identities i
    JOIN public.wechat_admin_allowlist a
      ON (a.openid IS NOT NULL AND a.openid = i.openid)
      OR (a.unionid IS NOT NULL AND i.unionid IS NOT NULL AND a.unionid = i.unionid)
    WHERE i.user_id = auth.uid()
  )
  OR COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean, false);
$$;

GRANT EXECUTE ON FUNCTION public.is_wechat_admin() TO authenticated, anon;

-- 示例：插入管理员（把下面换成你的真实 openid）
-- INSERT INTO public.wechat_admin_allowlist (openid, note)
-- VALUES ('oXXXX', '站长')
-- ON CONFLICT DO NOTHING;
