import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle, ListOrdered, Menu, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, Search, Send, Square, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Artifact, PoolMessage, Project, Role, SESSION_KEY, STATUS_LABEL, api, client, deleteProject, errMsg, loadProjectData, roleLabel,
} from '@/lib/sky';
import { useAccount } from '@/contexts/AccountContext';
import { ArtifactPanel, MessagePool } from './Panels';

interface PlanItem { id: number; name: string; profile: string }
interface StepRes { message: PoolMessage; total_tokens: number; preview_issues?: string[] }
interface StartRes { project_id: number; version: number; plan: PlanItem[] }
type Session = Project & { created_at?: string; updated_at?: string };
type StepState = 'waiting' | 'running' | 'done' | 'stopped';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STEP_STYLE: Record<StepState, { dot: string; label: string }> = {
  waiting: { dot: 'bg-muted-foreground/30', label: '等待' },
  running: { dot: 'animate-pulse bg-primary', label: '进行中' },
  done: { dot: 'bg-primary', label: '完成' },
  stopped: { dot: 'bg-destructive', label: '中断' },
};

function groupOf(s: Session): string {
  const t = new Date(s.created_at || s.updated_at || 0).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (t >= today.getTime()) return '今天';
  if (t >= today.getTime() - 6 * 86400000) return '最近 7 天';
  return '更早';
}

export default function Workbench({ sessionId, onSession, onGoRoles, active }: {
  sessionId: number | null;
  onSession: (id: number | null) => void;
  onGoRoles: () => void;
  active: boolean;
}) {
  const { isDemo } = useAccount();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [input, setInput] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [plans, setPlans] = useState<Record<string, PlanItem[]>>({});
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [roles, setRoles] = useState<PlanItem[] | null>(null);
  const [stepIdx, setStepIdx] = useState(-1);
  const [messages, setMessages] = useState<PoolMessage[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [live, setLive] = useState<{ sender: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  const loadSessions = useCallback(async () => {
    const r = await client.entities.projects.query({ sort: '-id', limit: 200 });
    setSessions((r.data?.items || []) as Session[]);
  }, []);

  const refresh = useCallback(async (pid: number) => {
    const [p, data, pl] = await Promise.all([
      client.entities.projects.get({ id: String(pid) }),
      loadProjectData(pid),
      api<{ plans: Record<string, PlanItem[]> }>(`/api/v1/sky/projects/${pid}/plans`).catch(() => ({ plans: {} })),
    ]);
    setProject(p.data as Project);
    setMessages(data.messages);
    setArtifacts(data.artifacts);
    setPlans(pl.plans);
  }, []);

  useEffect(() => {
    loadSessions().catch((e) => toast.error(errMsg(e)));
  }, [loadSessions]);

  // Re-read the role order whenever the workbench becomes visible again (it may have changed on the roles page).
  useEffect(() => {
    if (!active) return;
    api<{ mine: Role[] }>('/api/v1/sky/roles')
      .then((r) => setRoles(r.mine.filter((m) => m.enabled).map(({ id, name, profile }) => ({ id, name, profile }))))
      .catch((e) => setError(errMsg(e)));
  }, [active]);

  useEffect(() => {
    if (running) return;
    setError('');
    setStepIdx(-1);
    if (!sessionId) {
      setProject(null);
      setMessages([]);
      setArtifacts([]);
      setPlans({});
      return;
    }
    refresh(sessionId).catch((e) => {
      toast.error(`会话加载失败：${errMsg(e)}`);
      onSession(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function reveal(sender: string, text: string) {
    const chunk = Math.max(30, Math.ceil(text.length / 60));
    for (let i = 0; i < text.length && !stoppedRef.current; i += chunk) {
      setLive({ sender, text: text.slice(0, i + chunk) });
      await sleep(16);
    }
  }

  async function runFrom(pid: number, items: PlanItem[], start: number) {
    setRunning(true);
    setError('');
    stoppedRef.current = false;
    for (let i = start; i < items.length; i++) {
      if (stoppedRef.current) break;
      setStepIdx(i);
      setLive({ sender: items[i].name, text: '' });
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await api<StepRes>(`/api/v1/sky/projects/${pid}/step`, 'POST', { role_id: items[i].id, step: i }, ctrl.signal);
        await reveal(items[i].name, res.message.content);
        await refresh(pid);
        setLive(null);
        if (res.preview_issues?.length && !stoppedRef.current) {
          setLive({ sender: items[i].name, text: `预览自检发现问题，正在自动修复一次：\n- ${res.preview_issues.join('\n- ')}` });
          const fix = await api<{ fixed: boolean; preview_issues: string[] }>(
            `/api/v1/sky/projects/${pid}/repair`, 'POST', { role_id: items[i].id }, ctrl.signal,
          ).catch((e) => ({ fixed: false, preview_issues: [errMsg(e)] }));
          await refresh(pid);
          setLive(null);
          if (!fix.fixed) setError(`预览可能不完整：${fix.preview_issues.join('；')}。可以发消息让 Agent 继续修复。`);
        }
      } catch (e) {
        setLive(null);
        if (stoppedRef.current) break;
        setError(`${roleLabel(items[i].name)}（${items[i].profile}）执行失败：${errMsg(e)}`);
        await api(`/api/v1/sky/projects/${pid}/finish`, 'POST', { status: 'failed' }).catch(() => {});
        await refresh(pid).catch(() => {});
        await loadSessions().catch(() => {});
        setRunning(false);
        return;
      }
    }
    abortRef.current = null;
    if (!stoppedRef.current) {
      await api(`/api/v1/sky/projects/${pid}/finish`, 'POST', { status: 'done' }).catch(() => {});
      setStepIdx(items.length);
    }
    await refresh(pid).catch(() => {});
    await loadSessions().catch(() => {});
    setRunning(false);
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    if (isDemo) {
      setError('演示账号为只读账号，注册后即可创建并保存自己的会话');
      return;
    }
    if (roles && roles.length === 0) {
      setError('请先添加至少一个角色');
      return;
    }
    setError('');
    try {
      const res = project
        ? await api<StartRes>(`/api/v1/sky/projects/${project.id}/iterate`, 'POST', { requirement: text })
        : await api<StartRes>('/api/v1/sky/projects', 'POST', { requirement: text });
      setInput('');
      setPlan(res.plan);
      onSession(res.project_id);
      await refresh(res.project_id);
      await loadSessions().catch(() => {});
      await runFrom(res.project_id, res.plan, 0);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function stop() {
    if (!project) return;
    stoppedRef.current = true;
    abortRef.current?.abort();
    setLive(null);
    try {
      await api(`/api/v1/sky/projects/${project.id}/cancel`, 'POST');
    } catch (e) {
      setError(`中断请求失败：${errMsg(e)}`);
    }
    await refresh(project.id).catch(() => {});
    await loadSessions().catch(() => {});
    setRunning(false);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    try {
      await deleteProject(target.id);
      const rest = sessions.filter((s) => s.id !== target.id);
      setSessions(rest);
      if (sessionId === target.id) onSession(rest[0]?.id ?? null);
      toast.success(`已删除「${target.title}」`);
      setPendingDelete(null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeleting(false);
    }
  }

  const pick = (id: number | null) => {
    if (running) return;
    onSession(id);
    setDrawer(false);
  };

  const version = project?.current_version || 1;
  const canRetry = !running && project && project.status === 'failed' && stepIdx >= 0 && stepIdx < plan.length;

  // Steps shown in the progress bar: live plan while running, otherwise the snapshot recorded for this version.
  const steps = useMemo((): { item: PlanItem; state: StepState }[] => {
    if (running) {
      return plan.map((item, i) => ({ item, state: i < stepIdx ? 'done' : i === stepIdx ? 'running' : 'waiting' }));
    }
    if (!project) return (roles || []).map((item) => ({ item, state: 'waiting' }));
    const current = messages.filter((m) => (m.version || 1) === version && m.sender !== 'User');
    const snapshot = plans[String(version)]
      ?? Array.from(new Map(current.map((m) => [m.sender, { id: m.id, name: m.sender, profile: '' }])).values());
    const doneNames = new Set(current.map((m) => m.sender));
    let stopMarked = false;
    return snapshot.map((item) => {
      if (doneNames.has(item.name)) return { item, state: 'done' as StepState };
      if (!stopMarked && (project.status === 'interrupted' || project.status === 'failed')) {
        stopMarked = true;
        return { item, state: 'stopped' as StepState };
      }
      return { item, state: 'waiting' as StepState };
    });
  }, [running, plan, stepIdx, project, roles, messages, plans, version]);

  const shown = sessions.filter((s) => !query.trim() || s.title.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = ['今天', '最近 7 天', '更早'].map((g) => [g, shown.filter((s) => groupOf(s) === g)] as const);

  const sessionList = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Button onClick={() => pick(null)} disabled={running} className="w-full">
        <Plus className="mr-1 h-4 w-4" />新建会话
      </Button>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索会话" className="pl-8" aria-label="搜索会话" />
      </div>
      {isDemo && <p className="text-xs text-muted-foreground">演示账号为只读账号，示例会话不可删除。</p>}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {sessions.length === 0 && <p className="px-1 text-sm text-muted-foreground">还没有会话。</p>}
        {sessions.length > 0 && shown.length === 0 && <p className="px-1 text-sm text-muted-foreground">没有匹配的会话。</p>}
        {groups.map(([g, list]) => list.length > 0 && (
          <section key={g} className="space-y-1">
            <h3 className="px-1 text-xs font-semibold text-muted-foreground">{g}</h3>
            {list.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 ${sessionId === s.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'}`}
              >
                <button
                  type="button"
                  onClick={() => pick(s.id)}
                  disabled={running && sessionId !== s.id}
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  aria-current={sessionId === s.id}
                >
                  <div className="truncate text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-muted-foreground">v{s.current_version || 1} · {STATUS_LABEL[s.status] || s.status}</div>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  disabled={isDemo || (running && sessionId === s.id)}
                  onClick={() => setPendingDelete(s)}
                  aria-label={`删除会话 ${s.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`grid gap-4 ${collapsed ? 'lg:grid-cols-[minmax(0,1fr)]' : 'lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]'}`}>
      {!collapsed && (
        <Card className="hidden h-[calc(100vh-7rem)] min-w-0 p-3 lg:sticky lg:top-20 lg:block">{sessionList}</Card>
      )}

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setDrawer(true)}>
            <Menu className="mr-1 h-4 w-4" />会话列表
          </Button>
          <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? '展开会话栏' : '折叠会话栏'}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{project ? project.title : '新建会话'}</h2>
            {project && (
              <p className="text-xs text-muted-foreground">
                当前 v{version} · {STATUS_LABEL[project.status] || project.status} · <span className="font-mono">{project.total_tokens} tokens</span>
              </p>
            )}
          </div>
        </div>

        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {running ? '执行进度' : project ? `v${version} 执行记录` : '本次将按以下顺序执行'}
            </h3>
            <button type="button" onClick={onGoRoles} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <ListOrdered className="h-3 w-3" />调整角色顺序
            </button>
          </div>
          {roles && roles.length === 0 && !project ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              请先添加至少一个角色。
              <Button size="sm" variant="outline" onClick={onGoRoles}>去添加角色</Button>
            </div>
          ) : steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">这次运行没有记录到角色。</p>
          ) : (
            <ol className="flex flex-wrap items-center gap-2" aria-label="执行进度">
              {steps.map(({ item, state }, i) => (
                <li key={`${item.id}-${i}`} className="flex items-center gap-2">
                  {i > 0 && <span className="text-muted-foreground" aria-hidden>→</span>}
                  <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${state === 'running' ? 'border-primary bg-primary/10' : 'bg-background'}`}>
                    <span className={`h-2 w-2 rounded-full ${STEP_STYLE[state].dot}`} />
                    <span className="font-medium">{roleLabel(item.name)}</span>
                    <span className="text-muted-foreground">{STEP_STYLE[state].label}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <Textarea
            rows={3}
            value={input}
            disabled={running || isDemo}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
            }}
            placeholder={
              isDemo
                ? '演示账号为只读账号，可在左侧打开示例会话查看；注册后即可创建自己的会话'
                : project
                  ? '继续迭代，例如：加一个暗色模式切换按钮；把 PRD 改得更简洁（Ctrl/⌘ + Enter 发送）'
                  : '描述你的需求，例如：做一个待办清单网页 demo（Ctrl/⌘ + Enter 发送）'
            }
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {project?.status === 'interrupted' && !running && (
              <p className="mr-auto text-xs text-muted-foreground">任务已中断，已生成的消息和产物都已保存，可以继续发送消息迭代。</p>
            )}
            {running ? (
              <Button variant="destructive" onClick={stop}><Square className="mr-1 h-4 w-4" />停止任务</Button>
            ) : (
              <Button disabled={!input.trim() || isDemo} onClick={send}>
                <Send className="mr-1 h-4 w-4" />{project ? `发送并生成 v${version + 1}` : '启动 Agent 团队'}
              </Button>
            )}
          </div>
          {error && (
            <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>
              {canRetry && (
                <Button size="sm" variant="outline" onClick={() => runFrom(project.id, plan, stepIdx)}>
                  <RotateCcw className="mr-1 h-3 w-3" />从失败步骤重试
                </Button>
              )}
            </div>
          )}
        </Card>

        <div className="grid gap-4 2xl:grid-cols-2">
          <Card className="min-w-0 p-4">
            <h3 className="mb-3 font-semibold">对话与共享消息池</h3>
            <MessagePool messages={messages} live={live} />
          </Card>
          <Card className="min-w-0 p-4">
            <h3 className="mb-3 font-semibold">产物</h3>
            <ArtifactPanel artifacts={artifacts} name={`sky-project-${project?.id ?? 'new'}`} />
          </Card>
        </div>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="flex w-80 flex-col">
          <SheetHeader><SheetTitle>会话</SheetTitle></SheetHeader>
          <div className="min-h-0 flex-1">{sessionList}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个会话？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{pendingDelete?.title}」及其全部对话消息和产物，删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleting ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { SESSION_KEY };
