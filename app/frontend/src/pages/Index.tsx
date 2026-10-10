import { useEffect, useState } from 'react';
import { Bot, Info, LogOut, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SESSION_KEY } from '@/lib/sky';
import { useAccount } from '@/contexts/AccountContext';
import LoginPage from '@/pages/LoginPage';
import Workbench from '@/components/sky/Workbench';
import AccountPanel from '@/components/sky/AccountPanel';
import { ConfigPanel, RolesPanel } from '@/components/sky/Settings';

const TABS = [
  ['work', '工作台'],
  ['roles', '角色'],
  ['config', '模型配置'],
  ['account', '我的账号'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Index() {
  const { status, user, isDemo, signOut } = useAccount();
  const readUrl = () => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('tab');
    const tabOk = TABS.some(([k]) => k === t) ? (t as Tab) : 'work'; // legacy ?tab=history falls back to the workbench
    const sid = Number(q.get('session')) || Number(localStorage.getItem(SESSION_KEY)) || 0;
    return { tab: tabOk, session: sid > 0 ? sid : null };
  };
  const [tab, setTabState] = useState<Tab>(() => readUrl().tab);
  const [sessionId, setSessionId] = useState<number | null>(() => readUrl().session);

  // Keep the address bar in sync so a refresh restores the same tab and session.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.delete('tab');
    q.delete('session');
    if (tab !== 'work') q.set('tab', tab);
    if (sessionId) q.set('session', String(sessionId));
    const qs = q.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [tab, sessionId]);

  const setTab = (t: Tab) => setTabState(t);
  const changeSession = (id: number | null) => {
    setSessionId(id);
    if (id) localStorage.setItem(SESSION_KEY, String(id));
    else localStorage.removeItem(SESSION_KEY);
  };

  // Drop the remembered session when the signed-in account changes.
  useEffect(() => {
    if (status === 'out') {
      setSessionId(null);
      localStorage.removeItem(SESSION_KEY);
      setTab('work');
    }
  }, [status]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95">
        <div className="mx-auto flex h-14 w-full max-w-[2200px] items-center gap-6 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setTab('work')}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="返回主页"
          >
            <Network className="h-5 w-5 text-primary" />Sky Agent
          </button>
          {status === 'in' && (
            <nav className="flex gap-1">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-2">
            {status === 'in' && isDemo && (
              <span className="hidden items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground sm:flex">
                <Info className="h-3 w-3" />
                演示账号（只读）
              </span>
            )}
            {status === 'in' && (
              <Button variant="ghost" size="sm" onClick={signOut} aria-label="退出登录">
                <LogOut className="mr-1 h-4 w-4" />
                <span className="hidden sm:inline">退出登录</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[2200px] p-4 sm:p-6">
        {status === 'loading' && <p className="py-16 text-center text-sm text-muted-foreground">正在校验登录状态…</p>}
        {status === 'out' && <LoginPage />}
        {status === 'in' && (
          <>
            {isDemo && (
              <p className="mb-3 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                当前为演示账号，数据公开共享且为只读：可以浏览示例项目、对话过程与产物，但不能创建或修改数据。注册自己的账号即可使用完整功能。
              </p>
            )}
            <div className={tab === 'work' ? '' : 'hidden'}>
              <Workbench sessionId={sessionId} onSession={changeSession} onGoRoles={() => setTab('roles')} active={tab === 'work'} />
            </div>
            {tab === 'roles' && <RolesPanel />}
            {tab === 'config' && <ConfigPanel />}
            {tab === 'account' && <AccountPanel />}
          </>
        )}
      </main>
    </div>
  );
}
