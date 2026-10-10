import { useEffect, useState } from 'react';
import { Bot, Info, LogOut, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SESSION_KEY } from '@/lib/sky';
import { useAccount } from '@/contexts/AccountContext';
import LoginPage from '@/pages/LoginPage';
import Workbench from '@/components/sky/Workbench';
import AccountPanel from '@/components/sky/AccountPanel';
import { ConfigPanel, HistoryPanel, RolesPanel } from '@/components/sky/Settings';

const TABS = [
  ['work', '工作台'],
  ['roles', '角色'],
  ['history', '历史'],
  ['config', '模型配置'],
  ['account', '我的账号'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Index() {
  const { status, user, isDemo, signOut } = useAccount();
  const [tab, setTab] = useState<Tab>('work');
  const [historyKey, setHistoryKey] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(SESSION_KEY));
    return v > 0 ? v : null;
  });
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
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4">
          <div className="flex items-center gap-2 font-semibold">
            <Network className="h-5 w-5 text-primary" />Sky Agent
          </div>
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

      <main className="mx-auto max-w-[1600px] p-4">
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
              <Workbench sessionId={sessionId} onSession={changeSession} onDone={() => setHistoryKey((k) => k + 1)} />
            </div>
            {tab === 'roles' && <RolesPanel />}
            {tab === 'history' && (
              <HistoryPanel
                key={historyKey}
                onContinue={(id) => {
                  changeSession(id);
                  setTab('work');
                }}
              />
            )}
            {tab === 'config' && <ConfigPanel />}
            {tab === 'account' && <AccountPanel />}
          </>
        )}
      </main>
    </div>
  );
}
