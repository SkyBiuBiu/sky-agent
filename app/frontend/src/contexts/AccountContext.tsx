import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { client } from '../lib/api';
import { AccountInfo, accountApi, clearSession, hasStoredSession, saveSession } from '../lib/accounts';

type Status = 'loading' | 'in' | 'out';

interface AccountContextValue {
  status: Status;
  user: AccountInfo | null;
  /** Accessor for the parsed user object the server returns from the account session endpoint. */
  isDemo: boolean;
  signIn: (identifier: string, password: string, remember: boolean) => Promise<void>;
  signUp: (email: string, password: string, confirm: string, name?: string) => Promise<void>;
  signInDemo: () => Promise<void>;
  signOut: () => void;
  changePassword: (current: string, next: string, confirm: string) => Promise<string>;
  refresh: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within an AccountProvider');
  return ctx;
}

interface ServerUser {
  id: string;
  email: string;
  name?: string;
  role: string;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AccountInfo | null>(null);

  const load = useCallback(async () => {
    if (!hasStoredSession()) {
      setUser(null);
      setStatus('out');
      return;
    }
    try {
      const res = await client.auth.me();
      const serverUser = res?.data as ServerUser | undefined;
      if (!serverUser?.id) {
        clearSession();
        setUser(null);
        setStatus('out');
        return;
      }
      const local = await accountApi.session().catch(() => null);
      setUser(
        local ?? {
          id: serverUser.id,
          email: serverUser.email,
          name: serverUser.name || serverUser.email,
          role: serverUser.role,
          is_demo: false,
        },
      );
      setStatus('in');
    } catch {
      clearSession();
      setUser(null);
      setStatus('out');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applySession = useCallback((session: { account: AccountInfo; token: string; expires_at: number }) => {
    saveSession(session);
    setUser(session.account);
    setStatus('in');
  }, []);

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      user,
      isDemo: !!user?.is_demo,
      signIn: async (identifier, password, remember) => applySession(await accountApi.login(identifier, password, remember)),
      signUp: async (email, password, confirm, name) => applySession(await accountApi.register(email, password, confirm, name)),
      signInDemo: async () => applySession(await accountApi.demo()),
      signOut: () => {
        clearSession();
        setUser(null);
        setStatus('out');
      },
      changePassword: async (current, next, confirm) => (await accountApi.changePassword(current, next, confirm)).detail,
      refresh: load,
    }),
    [status, user, applySession, load],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
