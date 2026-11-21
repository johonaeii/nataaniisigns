import type { Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabaseClient';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unconfigured' }
  | { status: 'signed_out' }
  | { status: 'recovery'; session: Session }
  | { status: 'signed_in'; session: Session; isAdmin: boolean | null };

interface AuthContextValue {
  auth: AuthState;
  /** A fresh access token for calling admin Netlify functions. */
  getAccessToken(): Promise<string>;
  signOut(): Promise<void>;
  finishRecovery(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(supabase ? { status: 'loading' } : { status: 'unconfigured' });
  const userId = auth.status === 'signed_in' ? auth.session.user.id : null;

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAuth((current) =>
        current.status !== 'loading'
          ? current
          : data.session
            ? { status: 'signed_in', session: data.session, isAdmin: null }
            : { status: 'signed_out' },
      );
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Don't call other Supabase methods inside this callback (it can deadlock).
      if (event === 'PASSWORD_RECOVERY' && session) {
        setAuth({ status: 'recovery', session });
      } else if (!session) {
        setAuth({ status: 'signed_out' });
      } else {
        setAuth((current) =>
          current.status === 'recovery'
            ? current
            : {
                status: 'signed_in',
                session,
                isAdmin:
                  current.status === 'signed_in' && current.session.user.id === session.user.id
                    ? current.isAdmin
                    : null,
              },
        );
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Ask the database whether this user is an admin. (The UI uses this only to
  // choose what to show; RLS and the server enforce it regardless.)
  useEffect(() => {
    if (!supabase || !userId) return;
    let active = true;
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (!active) return;
      setAuth((current) =>
        current.status === 'signed_in' && current.session.user.id === userId
          ? { ...current, isAdmin: !error && data === true }
          : current,
      );
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      async getAccessToken() {
        const { data } = await supabase!.auth.getSession();
        if (!data.session) throw new Error('Not signed in');
        return data.session.access_token;
      },
      async signOut() {
        await supabase?.auth.signOut();
      },
      finishRecovery() {
        setAuth((current) =>
          current.status === 'recovery' ? { status: 'signed_in', session: current.session, isAdmin: null } : current,
        );
      },
    }),
    [auth],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAdminAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>');
  return value;
}
