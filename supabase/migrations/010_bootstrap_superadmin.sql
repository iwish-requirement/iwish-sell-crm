-- 010_bootstrap_superadmin.sql
-- Ensure there is at least one SuperAdmin profile so that role_permissions.manage
-- and相关权限配置能力可以实际被使用（否则任何账号都无法管理角色权限矩阵）。

DO $$
DECLARE
  v_super_role_id uuid;
  v_existing_super uuid;
  v_target_profile_id uuid;
BEGIN
  -- 如果没有 SuperAdmin 角色，直接返回（说明还没跑 005 种子）
  SELECT id INTO v_super_role_id
  FROM public.roles
  WHERE name = 'SuperAdmin';

  IF v_super_role_id IS NULL THEN
    RETURN;
  END IF;

  -- 若已经存在绑定了 SuperAdmin 角色的用户，则不做任何变更
  SELECT p.id INTO v_existing_super
  FROM public.profiles p
  WHERE p.role_id = v_super_role_id
  LIMIT 1;

  IF v_existing_super IS NOT NULL THEN
    RETURN;
  END IF;

  -- 优先选择已是 Admin 角色的用户作为首个 SuperAdmin（按创建时间最早优先）
  SELECT p.id INTO v_target_profile_id
  FROM public.profiles p
  JOIN public.roles r ON p.role_id = r.id
  WHERE r.name = 'Admin'
  ORDER BY p.created_at ASC
  LIMIT 1;

  -- 若没有 Admin 用户，则退化为“最早创建的 active 用户”
  IF v_target_profile_id IS NULL THEN
    SELECT p.id INTO v_target_profile_id
    FROM public.profiles p
    WHERE p.status = 'active'
    ORDER BY p.created_at ASC
    LIMIT 1;
  END IF;

  -- 如果连 active 用户都没有（全新空库），则什么也不做
  IF v_target_profile_id IS NULL THEN
    RETURN;
  END IF;

  -- 将选中的用户升级为 SuperAdmin
  UPDATE public.profiles
  SET role_id = v_super_role_id
  WHERE id = v_target_profile_id;
END $$;