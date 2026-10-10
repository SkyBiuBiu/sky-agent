import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Plus, RotateCcw, Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  Artifact, PoolMessage, Project, Role, SESSION_KEY, STATUS_LABEL, api, client, errMsg, loadProjectData,
} from '@/lib/sky';
import { useAccount } from '@/contexts/AccountContext';
import { ArtifactPanel, MessagePool } from './Panels';

interface PlanItem { id: number; name: string; profile: string }
interface StepRes { message: PoolMessage; total_tokens: number; preview_issues?: string[] }
interface StartRes { project_id: number; version: number; plan: PlanItem[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Workbench({ sessionId, onSession, onDone }: {
  sessionId: number | null;
  onSession: (id: number | null) => void;
  onDone: () => void;
}) {
  const { isDemo } = useAccount();
  const [input, setInput] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [stepIdx, setStepIdx] = useState(-1);
  const [messages, setMessages] = useState<PoolMessage[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [live, setLive] = useState<{ sender: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  const refresh = useCallback(async (pid: number) => {
    const [p, data] = await Promise.all([client.entities.projects.get({ id: String(pid) }), loadProjectData(pid)]);
    setProject(p.data as Project);
    setMessages(data.messages);
    setArtifacts(data.artifacts);
  }, []);

  useEffect(() => {
    (async () => {
      await api('/api/v1/sky/roles/init');
      const r = await client.entities.agent_roles.query({ sort: 'sop_order', limit: 100 });
      setPlan(((r.data?.items || []) as Role[]).filter((x) => x.enabled).map(({ id, name, profile }) => ({ id, name, profile })));
    })().catch((e) => setError(errMsg(e)));
  }, []);

  useEffect(() => {
    if (running) return;
    if (!sessionId) {
      setProject(null);
      setMessages([]);
      setArtifacts([]);
      setStepIdx(-1);
      return;
    }
    refresh(sessionId).catch((e) => {
      setError(`会话加载失败：${errMsg(e)}`);
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
        setError(`${items[i].name}（${items[i].profile}）执行失败：${errMsg(e)}`);
        await api(`/api/v1/sky/projects/${pid}/finish`, 'POST', { status: 'failed' }).catch(() => {});
        await refresh(pid).catch(() => {});
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
    setRunning(false);
    onDone();
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    if (isDemo) {
      setError('演示账号为只读账号，注册后即可创建并保存自己的项目');
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
    setRunning(false);
    onDone();
  }

  const version = project?.current_version || 1;
  const canRetry = !running && project && project.status === 'failed' && stepIdx >= 0 && stepIdx < plan.length;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr_44%]">
      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{project ? '继续迭代' : '新会话'}</h2>
          {project && (
            <Button size="sm" variant="outline" disabled={running} onClick={() => onSession(null)}>
              <Plus className="mr-1 h-3 w-3" /> 新会话
            </Button>
          )}
        </div>
        {project && (
          <div className="rounded-md border p-2 text-xs">
            <div className="truncate font-medium">{project.title}</div>
            <div className="mt-1 flex justify-between text-muted-foreground">
              <span>当前 v{version} · {STATUS_LABEL[project.status] || project.status}</span>
              <span className="font-mono">{project.total_tokens} tokens</span>
            </div>
          </div>
        )}
        <Textarea
          rows={5}
          value={input}
          disabled={running || isDemo}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder={
            isDemo
              ? '演示账号为只读账号，可浏览下方示例项目；注册后即可创建自己的项目'
              : project
                ? '例如：加一个暗色模式切换按钮；把 PRD 改得更简洁'
                : '例如：做一个待办清单网页 demo'
          }
        />
        {running ? (
          <Button className="w-full" variant="destructive" onClick={stop}>
            <Square className="mr-1 h-4 w-4" /> 停止任务
          </Button>
        ) : (
          <Button className="w-full" disabled={!input.trim() || isDemo} onClick={send}>
            <Send className="mr-1 h-4 w-4" /> {project ? `发送并生成 v${version + 1}` : '启动 Agent 团队'}
          </Button>
        )}
        {isDemo && (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            演示账号为只读账号：可以直接查看右侧的协作消息与产物，或到「历史」中打开示例项目。注册自己的账号即可创建项目、配置模型并保存历史。
          </p>
        )}
        <div>
          <h3 className="mb-2 text-sm font-semibold">SOP 流水线</h3>
          <ol className="space-y-2">
            {plan.map((p, i) => (
              <li key={p.id} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${i === stepIdx && running ? 'border-primary bg-primary/5' : ''}`}>
                <span className={`h-2 w-2 rounded-full ${i < stepIdx ? 'bg-green-600' : i === stepIdx && running ? 'animate-pulse bg-primary' : 'bg-muted-foreground/30'}`} />
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.profile}</span>
              </li>
            ))}
          </ol>
        </div>
        {project?.status === 'interrupted' && !running && (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">任务已中断，已生成的消息和产物都已保存，可以继续发送消息迭代。</p>
        )}
        {error && (
          <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>
            {canRetry && (
              <Button size="sm" variant="outline" onClick={() => runFrom(project.id, plan, stepIdx)}>
                <RotateCcw className="mr-1 h-3 w-3" /> 从失败步骤重试
              </Button>
            )}
          </div>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-lg font-semibold">会话与共享消息池</h2>
        <MessagePool messages={messages} live={live} />
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-lg font-semibold">产物</h2>
        <ArtifactPanel artifacts={artifacts} name={`sky-project-${project?.id ?? 'new'}`} />
      </Card>
    </div>
  );
}

export { SESSION_KEY };
