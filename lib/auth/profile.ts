import type { SupabaseClient } from '@supabase/supabase-js';

export type ProfileStatus = 'pending' | 'active' | 'disabled' | 'rejected';

export interface UserProfile {
  id: string;
  status: ProfileStatus;
  teamId: number | null;
  roleId: string | null;
}

export interface UserPublicProfile {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  status: string | null;
  email: string | null;
}

// 仅在浏览器侧做简单缓存：避免同一会话反复查询当前用户 Profile。
// ⚠️ 服务端（含 Middleware/SSR/Edge Runtime）禁止使用模块级缓存，否则会跨请求/跨用户污染。
let cachedProfile: UserProfile | null | undefined;
let cachedPublicProfile: UserPublicProfile | null | undefined;

function isBrowserRuntime() {
  return typeof window !== 'undefined';
}

export async function fetchCurrentUserProfile(
  supabaseClient: SupabaseClient,
): Promise<UserProfile | null> {
  const canUseCache = isBrowserRuntime();

  if (canUseCache && cachedProfile !== undefined) {
    return cachedProfile;
  }

  // 先拿当前会话的 user.id，避免在拥有 profiles.manage 权限时查询出多行
  const {
    data: { user },
    error: userError,
  } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    if (userError) {
      console.error('Failed to get auth user before loading current profile', userError);
    }

    if (canUseCache) {
      cachedProfile = null;
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
      if (canUseCache) {
        cachedProfile = null;
      }
      return null;
    }

    console.error('Failed to load current user profile', error);
    if (canUseCache) {
      cachedProfile = null;
    }
    return null;
  }

  if (!data) {
    if (canUseCache) {
      cachedProfile = null;
    }
    return null;
  }

  const result: UserProfile = {
    id: data.id as string,
    status: data.status as ProfileStatus,
    teamId: (data as any).team_id ?? null,
    roleId: (data as any).role_id ?? null,
  };

  if (canUseCache) {
    cachedProfile = result;
  }

  return result;
}

export async function fetchCurrentUserPublicProfile(
  supabaseClient: SupabaseClient,
): Promise<UserPublicProfile | null> {
  const canUseCache = isBrowserRuntime();

  if (canUseCache && cachedPublicProfile !== undefined) {
    return cachedPublicProfile;
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    if (userError) {
      console.error('Failed to get auth user before loading current public profile', userError);
    }

    if (canUseCache) {
      cachedPublicProfile = null;
    }

    return null;
  }

  const { data, error } = await supabaseClient
    .from('profiles_public')
    .select('id, full_name, avatar_url, status')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Failed to load current user public profile', error);
    }

    const fallback: UserPublicProfile = {
      id: user.id,
      fullName: user.email ?? '当前用户',
      avatarUrl: null,
      status: null,
      email: user.email ?? null,
    };

    if (canUseCache) {
      cachedPublicProfile = fallback;
    }

    return fallback;
  }

  if (!data) {
    const fallback: UserPublicProfile = {
      id: user.id,
      fullName: user.email ?? '当前用户',
      avatarUrl: null,
      status: null,
      email: user.email ?? null,
    };

    if (canUseCache) {
      cachedPublicProfile = fallback;
    }

    return fallback;
  }

  const result: UserPublicProfile = {
    id: data.id as string,
    fullName: ((data as any).full_name as string | null) ?? user.email ?? '当前用户',
    avatarUrl: ((data as any).avatar_url as string | null) ?? null,
    status: ((data as any).status as string | null) ?? null,
    email: user.email ?? null,
  };

  if (canUseCache) {
    cachedPublicProfile = result;
  }

  return result;
}
