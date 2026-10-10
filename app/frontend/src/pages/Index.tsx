import { useEffect, useState } from 'react';
import { Bot, LogOut, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SESSION_KEY, client } from '@/lib/sky';
import Workbench from '@/components/sky/Workbench';
import { ConfigPanel, HistoryPanel, RolesPanel } from '@/components/sky/Settings';

const TABS = [
  ['work', '工作台'],
  ['roles', '角色'],
  ['history', '历史'],
  ['config', '模型配置'],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Index() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');
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

  useEffect(() => {
    client.auth.me().then((r) => setAuth(r?.data ? 'in' : 'out')).catch(() => setAuth('out'));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4">
          <div className="flex items-center gap-2 font-semibold"><Network className="h-5 w-5 text-primary" />Sky Agent</div>
          {auth === 'in' && (
            <nav className="flex gap-1">
              {TABS.map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
              ))}
            </nav>
          )}
          <div className="ml-auto">
            {auth === 'in' ? (
              <Button variant="ghost" size="sm" onClick={() => client.auth.logout()} aria-label="退出登录"><LogOut className="h-4 w-4" /></Button>
            ) : auth === 'out' ? (
              <Button size="sm" onClick={() => client.auth.toLogin()}>登录</Button>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4">
        {auth === 'loading' && <p className="text-sm text-muted-foreground">加载中…</p>}
        {auth === 'out' && (
          <section className="mx-auto max-w-3xl py-16">
            <p className="mb-3 font-mono text-sm text-primary">多 Agent 协作 · 从需求到可运行产物</p>
            <h1 className="text-4xl font-bold leading-tight">一句话需求，交给一支 AI 软件团队</h1>
            <p className="mt-4 text-muted-foreground">Sky Agent 是一个多 Agent 协作站点：产品经理、架构师、工程师等角色通过共享消息池发布与订阅消息，按 SOP 顺序协作，产出 PRD、系统设计和可直接下载的代码。使用你自己的 OpenAI 兼容 API Key。</p>
            <div className="mt-8 flex flex-wrap items-center gap-2 text-sm">
              {['用户需求', 'Emma · 产品经理', 'Bob · 架构师', 'Alex · 工程师', '代码产物'].map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <span className="flex items-center gap-1 rounded-md border bg-card px-3 py-2"><Bot className="h-4 w-4 text-primary" />{s}</span>
                </span>
              ))}
            </div>
            <Button className="mt-8" size="lg" onClick={() => client.auth.toLogin()}>登录后开始</Button>
          </section>
        )}
        {auth === 'in' && (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}
