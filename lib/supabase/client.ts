import { type SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

let cachedBrowserClient: SupabaseClient | null = null;

function resolveSupabaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    '';

  if (!url) {
    throw new Error(
      'Supabase URL is not configured. Please set NEXT_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL.',
    );
  }

  return url;
}

function resolveSupabaseAnonKey(): string {
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    '';

  if (!anonKey) {
    throw new Error(
      'Supabase anon key is not configured. Please set NEXT_PUBLIC_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY.',
    );
  }

  return anonKey;
}

export function getBrowserSupabaseClient(): SupabaseClient {
  if (cachedBrowserClient) {
    return cachedBrowserClient;
  }

  const url = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();

  cachedBrowserClient = createBrowserClient(url, anonKey);

  return cachedBrowserClient;
}
