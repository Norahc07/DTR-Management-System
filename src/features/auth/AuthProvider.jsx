import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '@/lib/supabase';
import { AuthContext } from './authContext';
import { can as canRole } from './permissions';
import { clearAsyncCache } from '@/hooks/useAsync';

async function loadProfile(userId) {
  const [{ data: profile, error }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, role, status, employee_id').eq('id', userId).maybeSingle(),
    supabase.from('organization_settings').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (error) throw new Error(friendlyError(error));
  return { profile, settings };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState(null);

  const refresh = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      setSettings(null);
      return;
    }
    try {
      const r = await loadProfile(userId);
      setProfile(r.profile);
      setSettings(r.settings);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await refresh(data.session?.user?.id);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Defer DB calls out of the auth callback (supabase-js recommendation).
      setTimeout(() => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') refresh(next?.user?.id);
        if (event === 'SIGNED_OUT') {
          clearAsyncCache();
          refresh(null);
        }
      }, 0);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [refresh]);

  const value = useMemo(() => {
    const role = profile?.status === 'active' ? profile.role : null;
    return {
      session,
      user: session?.user ?? null,
      profile,
      role,
      settings,
      loading,
      error,
      timezone: settings?.timezone || 'Asia/Manila',
      can: (perm) => canRole(role, perm),
      refreshProfile: () => refresh(session?.user?.id),
      async signIn(email, password) {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        if (e) throw new Error(e.message === 'Invalid login credentials' ? 'Incorrect email or password.' : e.message);
        supabase.rpc('log_client_event', { p_action: 'login' }).then(() => {});
      },
      async signOut() {
        await supabase.rpc('log_client_event', { p_action: 'logout' }).then(() => {}, () => {});
        await supabase.auth.signOut();
        clearAsyncCache();
      },
    };
  }, [session, profile, settings, loading, error, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
