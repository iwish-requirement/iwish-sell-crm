import type { SupabaseClient } from '@supabase/supabase-js';

export type ProfileStatus = 'pending' | 'active' | 'disabled' | 'rejected';

export interface UserProfile {
  id: string;
  status: ProfileStatus;
  teamId: number | null;
  roleId: string | null;
}


export async function fetchCurrentUserProfile(
  supabaseClient: SupabaseClient,
): Promise<UserProfile | null> {
  // 先拿当前会话的 user.id，避免在拥有 profiles.manage 权限时查询出多行
  const {
    data: { user },
    error: userError,
  } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    if (userError) {
      console.error('Failed to get auth user before loading current profile', userError);
    }
    return null;
  }

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, status, team_id, role_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    // PGRST116 表示没有记录，其他错误视为异常
    if (error.code === 'PGRST116') {
      return null;
    }

    console.error('Failed to load current user profile', error);
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id as string,
    status: data.status as ProfileStatus,
    teamId: (data as any).team_id ?? null,
    roleId: (data as any).role_id ?? null,
  };
}


