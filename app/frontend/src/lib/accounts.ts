import { client } from './api';
import { SESSION_KEY, api } from './sky';

/** The platform SDK reads this key to attach `Authorization: Bearer <token>` to API calls. */
export const TOKEN_KEY = 'token';
const EXPIRES_KEY = 'sky_token_expires_at';
const LOGOUT_FLAG = 'isLougOutManual';

export interface AccountInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  is_demo: boolean;
}

export interface Session {
  account: AccountInfo;
  token: string;
  expires_at: number;
}

export function saveSession(session: Session) {
  try {
    localStorage.setItem(TOKEN_KEY, session.token);
    localStorage.setItem(EXPIRES_KEY, String(session.expires_at));
    localStorage.setItem(LOGOUT_FLAG, 'false');
  } catch {
    /* storage unavailable: the session simply won't survive a reload */
  }
}

/** Drop the session and any per-user working state so the next visitor starts clean. */
export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.setItem(LOGOUT_FLAG, 'true');
  } catch {
    /* ignore */
  }
}

/** True when a locally issued session exists and has not expired yet. */
export function hasStoredSession(): boolean {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    const expires = Number(localStorage.getItem(EXPIRES_KEY) || 0);
    if (expires && expires * 1000 < Date.now()) {
      clearSession();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const accountApi = {
  register: (email: string, password: string, confirm: string, name = '') =>
    api<Session>('/api/v1/sky/accounts/register', 'POST', { email, password, confirm, name }),

  login: (identifier: string, password: string, remember: boolean) =>
    api<Session>('/api/v1/sky/accounts/login', 'POST', { identifier, password, remember }),

  demo: () => api<Session>('/api/v1/sky/accounts/demo', 'POST'),

  changePassword: (current_password: string, new_password: string, confirm: string) =>
    api<{ ok: boolean; detail: string }>('/api/v1/sky/accounts/change-password', 'POST', {
      current_password,
      new_password,
      confirm,
    }),

  /** Resolve the local account behind the current token (null for platform OIDC sessions). */
  session: async (): Promise<AccountInfo | null> => {
    const res = await client.apiCall.invoke({ url: '/api/v1/sky/accounts/session', method: 'GET', data: {} });
    const data = res.data as { authenticated: boolean; account?: AccountInfo };
    return data?.authenticated && data.account ? data.account : null;
  },
};

/** Email and password strength feedback shared by the sign-up form. */
export function emailProblem(email: string): string {
  const value = email.trim();
  if (!value) return '请填写邮箱';
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) ? '' : '邮箱格式不正确，请检查后重试';
}

export function passwordProblem(password: string): string {
  if (!password) return '请填写密码';
  if (password.length < 6) return '密码至少 6 位';
  if (/^\d+$/.test(password)) return '密码需同时包含字母和数字';
  if (/^[A-Za-z]+$/.test(password)) return '密码需同时包含字母和数字';
  if (password.length < 10 && /123456|password|qwerty/i.test(password)) return '密码过于简单，请使用更复杂的密码';
  return '';
}

/** 0-3 strength score used for the inline strength meter. */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 14) score += 1;
  return Math.min(score, 3);
}
