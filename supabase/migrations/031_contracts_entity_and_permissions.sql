-- 031_contracts_entity_and_permissions.sql
-- Define contracts entity linked to leads, with permissions and RLS

-- 1) contract_status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_status') THEN
    CREATE TYPE contract_status AS ENUM ('pending','active','closed','cancelled');
  END IF;
END $$;

-- 2) contracts table
CREATE TABLE IF NOT EXISTS public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contract_number text NOT NULL,
  title text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  signed_at timestamptz NOT NULL,
  start_date date,
  end_date date,
  is_renewal boolean NOT NULL DEFAULT false,
  original_contract_id uuid REFERENCES public.contracts(id),
  status contract_status NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contracts_lead_unique UNIQUE (lead_id)
);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_contracts_updated_at ON public.contracts;
CREATE TRIGGER trg_contracts_updated_at
BEFORE UPDATE ON public.contracts
FOR EACH ROW EXECUTE FUNCTION iwish.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_contracts_lead ON public.contracts(lead_id);
CREATE INDEX IF NOT EXISTS idx_contracts_signed_at ON public.contracts(signed_at DESC);

-- 3) permissions for contracts
INSERT INTO public.permissions(key, resource, action, name, description, is_system, is_enabled)
VALUES
  ('contracts.read','contracts','read','Read Contracts','View contract records for allowed leads',true,true),
  ('contracts.manage','contracts','manage','Manage Contracts','Create and update contracts',true,true)
ON CONFLICT (key) DO NOTHING;

-- 4) seed role_permissions for contracts
-- Sales: can read own contracts
INSERT INTO public.role_permissions(role_id, permission_key, effect, scope_type)
SELECT r.id, 'contracts.read', 'allow', 'self'
FROM public.roles r
WHERE r.name = 'Sales'
ON CONFLICT DO NOTHING;

-- Manager: can read/manage team contracts
INSERT INTO public.role_permissions(role_id, permission_key, effect, scope_type)
SELECT r.id, p.key, 'allow', 'team'
FROM public.roles r
JOIN public.permissions p ON p.key IN ('contracts.read','contracts.manage')
WHERE r.name = 'Manager'
ON CONFLICT DO NOTHING;

-- Admin & SuperAdmin: org-wide contracts
INSERT INTO public.role_permissions(role_id, permission_key, effect, scope_type)
SELECT r.id, p.key, 'allow', 'org'
FROM public.roles r
JOIN public.permissions p ON p.key IN ('contracts.read','contracts.manage')
WHERE r.name IN ('Admin','SuperAdmin')
ON CONFLICT DO NOTHING;

-- 5) RLS for contracts (mirror leads scope semantics)
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- read contracts only when user can read the underlying lead in scope
DROP POLICY IF EXISTS contracts_select_scope ON public.contracts;
CREATE POLICY contracts_select_scope
ON public.contracts
FOR SELECT
USING (
  iwish.is_active_user(auth.uid())
  AND iwish.has_permission(auth.uid(),'contracts.read')
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = contracts.lead_id
      AND iwish.has_permission(auth.uid(),'leads.read')
      AND iwish.in_scope_for_lead(auth.uid(), l, 'leads.read')
  )
);

-- insert contracts only when user can update the lead in scope
DROP POLICY IF EXISTS contracts_insert_scope ON public.contracts;
CREATE POLICY contracts_insert_scope
ON public.contracts
FOR INSERT
WITH CHECK (
  iwish.is_active_user(auth.uid())
  AND iwish.has_permission(auth.uid(),'contracts.manage')
  AND created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = contracts.lead_id
      AND iwish.in_scope_for_lead(auth.uid(), l, 'leads.update')
  )
);

-- update/delete contracts only for users with manage permission; scope is enforced via joins if they touch rows
DROP POLICY IF EXISTS contracts_update_scope ON public.contracts;
CREATE POLICY contracts_update_scope
ON public.contracts
FOR UPDATE
USING (
  iwish.is_active_user(auth.uid())
  AND iwish.has_permission(auth.uid(),'contracts.manage')
)
WITH CHECK (
  iwish.is_active_user(auth.uid())
  AND iwish.has_permission(auth.uid(),'contracts.manage')
);

DROP POLICY IF EXISTS contracts_delete_scope ON public.contracts;
CREATE POLICY contracts_delete_scope
ON public.contracts
FOR DELETE
USING (
  iwish.is_active_user(auth.uid())
  AND iwish.has_permission(auth.uid(),'contracts.manage')
);

-- 6) secure view for frontend consumption (optional but consistent with leads)
CREATE OR REPLACE VIEW public.contracts_secure_view AS
SELECT
  c.id,
  c.lead_id,
  c.contract_number,
  c.title,
  c.amount,
  c.currency,
  c.signed_at,
  c.start_date,
  c.end_date,
  c.is_renewal,
  c.original_contract_id,
  c.status,
  c.created_by,
  c.created_at,
  c.updated_at
FROM public.contracts c;
