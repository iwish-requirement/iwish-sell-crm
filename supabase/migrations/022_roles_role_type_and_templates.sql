-- 022_roles_role_type_and_templates.sql
-- 为 roles 表增加 role_type 字段，用于区分销售顾问/销售经理/市场/业务负责人/技术维护等角色类型。
-- 角色类型本身不参与权限判定，仅用于在前端提供推荐权限模板与差异提示。

begin;

-- 1) 创建枚举类型（如果尚不存在）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role_type_enum') THEN
    CREATE TYPE role_type_enum AS ENUM (
      'sales_rep',       -- 销售顾问 / 一线销售
      'sales_manager',   -- 销售经理 / 主管
      'marketing',       -- 市场角色
      'biz_owner',       -- 业务负责人 / 总经理
      'tech_maintainer', -- 技术维护 / 系统维护
      'other'            -- 其他未分类
    );
  END IF;
END$$;

-- 2) 为 roles 表增加 role_type 字段，默认 other，避免影响现有数据
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS role_type role_type_enum NOT NULL DEFAULT 'other';

-- 3) 尝试根据现有角色名称做一次初始归类（仅 heuristic，后续可在前端修改）
-- 注意：这里默认角色名称为中文，可按关键字粗略分类
UPDATE public.roles
SET role_type = 'sales_manager'
WHERE role_type = 'other'
  AND (name LIKE '%销售经理%' OR name LIKE '%主管%' OR name LIKE '%总监%');

UPDATE public.roles
SET role_type = 'sales_rep'
WHERE role_type = 'other'
  AND (name LIKE '%销售顾问%' OR name LIKE '%销售%' OR name LIKE '%BD%' OR name LIKE '%商务%');

UPDATE public.roles
SET role_type = 'marketing'
WHERE role_type = 'other'
  AND (name LIKE '%市场%' OR name LIKE '%投放%' OR name LIKE '%运营%');

UPDATE public.roles
SET role_type = 'biz_owner'
WHERE role_type = 'other'
  AND (name LIKE '%总经理%' OR name LIKE '%负责人%' OR name LIKE '%老板%' OR name LIKE '%合伙人%');

UPDATE public.roles
SET role_type = 'tech_maintainer'
WHERE role_type = 'other'
  AND (name LIKE '%技术维护%' OR name LIKE '%系统管理%' OR name LIKE '%运维%');

-- 其余未命中的角色保持为 other，后续可在前端手动调整。

commit;