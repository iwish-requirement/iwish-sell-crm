import { getBrowserSupabaseClient } from "@/lib/supabase/client"

export type ScopeType = "self" | "team" | "org" | "custom"

export type RolePermissionMatrixItem = {
  permission_key: string
  effect: "allow" | "deny" | null
  scope_type?: ScopeType
  scope_rule?: any
}

export type RolePermissionMatrixRow = {
  permission_key: string
  effect: string
  scope_type: ScopeType
  scope_rule: any
}

export type RpcGetRolePermissionsPayload = {
  permissions: RolePermissionMatrixRow[]
}

export async function rpcRolePermissionsSetMatrix(p_role_id: string, p_items: RolePermissionMatrixItem[]) {
  const supabase = getBrowserSupabaseClient()

  const { error } = await supabase.rpc("rpc_role_permissions_set_matrix", {
    p_role_id,
    p_items,
  })

  return { error }
}

export async function rpcGetRolePermissions(p_role_id: string) {
  const supabase = getBrowserSupabaseClient()

  const { data, error } = await supabase.rpc("rpc_get_role_permissions", {
    p_role_id,
  })

  return { data: (data as RpcGetRolePermissionsPayload | null) ?? null, error }
}
