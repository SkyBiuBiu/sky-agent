import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Artifact, LlmConfig, PoolMessage, Project, ROLE_TYPES, Role, STATUS_LABEL, api, client, errMsg, loadProjectData } from '@/lib/sky';
import { useAccount } from '@/contexts/AccountContext';
import { ArtifactPanel, MessagePool } from './Panels';

const testCache = new Map<string, number>();

/** Shown on every write control the shared read-only demo account must not use. */
const DEMO_HINT = '演示账号为只读账号，注册后即可修改。';

export function ConfigPanel() {
  const { isDemo } = useAccount();
  const [cfg, setCfg] = useState<LlmConfig | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    api<LlmConfig>('/api/v1/sky/config').then(setCfg).catch((e) => toast.error(errMsg(e)));
  }, []);
  if (!cfg) return <p className="text-sm text-muted-foreground">加载中…</p>;
  const body = { base_url: cfg.base_url, model: cfg.model, api_key: key };
  const act = async (kind: 'save' | 'test') => {
    setBusy(kind);
    try {
      if (kind === 'save') {
        setCfg(await api<LlmConfig>('/api/v1/sky/config', 'POST', body));
        setKey('');
        toast.success('已保存');
      } else {
        if (!key.trim() && !cfg.configured) {
          toast.error('请先填写 API Key');
          return;
        }
        const sig = `${cfg.base_url}|${cfg.model}|${key ? key.length + key.slice(-4) : cfg.masked_key}`;
        const hit = testCache.get(sig);
        if (hit && Date.now() - hit < 60000) {
          toast.success('连通成功（1 分钟内已验证，使用缓存结果）');
          return;
        }
        const r = await api<{ reply: string; elapsed_ms: number; method: string }>('/api/v1/sky/config/test', 'POST', body);
        testCache.set(sig, Date.now());
        toast.success(`连通成功，耗时 ${r.elapsed_ms} ms（${r.method === 'models' ? '模型列表校验' : '最小对话校验'}）：${r.reply}`);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card className="mx-auto max-w-xl space-y-4 p-6">
      <h2 className="text-lg font-semibold">模型配置（OpenAI 兼容接口）</h2>
      <p className="text-xs text-muted-foreground">使用你自己的 API Key。Key 仅存储在服务端，页面只显示脱敏后的值。</p>
      <div className="space-y-1"><Label>Base URL</Label><Input value={cfg.base_url} onChange={(e) => setCfg({ ...cfg, base_url: e.target.value })} /></div>
      <div className="space-y-1"><Label>模型名</Label><Input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} /></div>
      <div className="space-y-1">
        <Label>API Key {cfg.masked_key && <span className="font-mono text-xs text-muted-foreground">（当前：{cfg.masked_key}，留空则不修改）</span>}</Label>
        <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-..." />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => act('save')} disabled={!!busy || isDemo}>{busy === 'save' ? '保存中…' : '保存'}</Button>
        <Button variant="outline" onClick={() => act('test')} disabled={!!busy || isDemo}>{busy === 'test' ? '测试中…' : '连通性测试'}</Button>
      </div>
      {isDemo && <p className="text-xs text-muted-foreground">{DEMO_HINT}</p>}
    </Card>
  );
}

const blank = { name: '', profile: '', goal: '', system_prompt: '', subscribe_types: 'Code', publish_type: 'Review', artifact_kind: 'doc', sop_order: 4, enabled: true };

export function RolesPanel() {
  const { isDemo } = useAccount();
  const [roles, setRoles] = useState<Role[]>([]);
  const load = async () => {
    await api('/api/v1/sky/roles/init');
    const r = await client.entities.agent_roles.query({ sort: 'sop_order', limit: 100 });
    setRoles(r.data?.items || []);
  };
  useEffect(() => {
    load().catch((e) => toast.error(errMsg(e)));
  }, []);
  const patch = (id: number, d: Partial<Role>) => setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, ...d } : r)));
  const save = async (r: Role) => {
    try {
      const { id, name, profile, goal, system_prompt, subscribe_types, publish_type, artifact_kind, sop_order, enabled } = r;
      await client.entities.agent_roles.update({ id: String(id), data: { name, profile, goal, system_prompt, subscribe_types, publish_type, artifact_kind, sop_order: Number(sop_order), enabled } });
      toast.success(`已保存 ${name}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const add = async () => {
    try { await client.entities.agent_roles.create({ data: { ...blank, name: '新角色', profile: 'QA 工程师', goal: '审查代码质量', system_prompt: '你是 QA 工程师，审查代码并输出 Markdown 格式的测试报告。' } }); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id: number) => {
    try { await client.entities.agent_roles.delete({ id: String(id) }); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Agent 角色</h2>
          <p className="text-xs text-muted-foreground">角色通过「订阅类型」从消息池接收消息，按 SOP 位置依次执行，并发布「发布类型」的消息。可用类型：{ROLE_TYPES.join(' / ')} 或自定义。</p>
        </div>
        <Button onClick={add} disabled={isDemo}><Plus className="mr-1 h-4 w-4" />新增角色</Button>
      </div>
      {isDemo && <p className="text-xs text-muted-foreground">{DEMO_HINT}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.id} className="space-y-2 p-4">
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">名称</Label><Input value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} /></div>
              <div><Label className="text-xs">职位</Label><Input value={r.profile} onChange={(e) => patch(r.id, { profile: e.target.value })} /></div>
              <div><Label className="text-xs">SOP 位置</Label><Input type="number" value={r.sop_order} onChange={(e) => patch(r.id, { sop_order: Number(e.target.value) })} /></div>
            </div>
            <div><Label className="text-xs">目标</Label><Input value={r.goal} onChange={(e) => patch(r.id, { goal: e.target.value })} /></div>
            <div><Label className="text-xs">系统提示词</Label><Textarea rows={4} value={r.system_prompt} onChange={(e) => patch(r.id, { system_prompt: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">订阅类型(逗号分隔)</Label><Input value={r.subscribe_types} onChange={(e) => patch(r.id, { subscribe_types: e.target.value })} /></div>
              <div><Label className="text-xs">发布类型</Label><Input value={r.publish_type} onChange={(e) => patch(r.id, { publish_type: e.target.value })} /></div>
              <div>
                <Label className="text-xs">产物</Label>
                <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={r.artifact_kind} onChange={(e) => patch(r.id, { artifact_kind: e.target.value })}>
                  <option value="doc">文档</option><option value="code">代码文件</option><option value="none">无</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-sm"><Switch checked={r.enabled} onCheckedChange={(v) => patch(r.id, { enabled: v })} />启用</label>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={isDemo} onClick={() => del(r.id)} aria-label="删除角色"><Trash2 className="h-4 w-4" /></Button>
                <Button size="sm" disabled={isDemo} onClick={() => save(r)}>保存</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function HistoryPanel({ onContinue }: { onContinue: (id: number) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState<Project | null>(null);
  const [data, setData] = useState<{ messages: PoolMessage[]; artifacts: Artifact[] }>({ messages: [], artifacts: [] });
  useEffect(() => {
    client.entities.projects.query({ sort: '-id', limit: 100 }).then((r) => setProjects(r.data?.items || [])).catch((e) => toast.error(errMsg(e)));
  }, []);
  const open = async (p: Project) => {
    setSel(p);
    try { setData(await loadProjectData(p.id)); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr_44%]">
      <Card className="space-y-2 p-3">
        <h2 className="px-1 text-lg font-semibold">项目历史</h2>
        {projects.length === 0 && <p className="px-1 text-sm text-muted-foreground">还没有项目。</p>}
        {projects.map((p) => (
          <button key={p.id} onClick={() => open(p)} className={`w-full rounded-md border p-2 text-left text-sm hover:bg-muted ${sel?.id === p.id ? 'border-primary' : ''}`}>
            <div className="truncate font-medium">{p.title}</div>
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>v{p.current_version || 1} · {STATUS_LABEL[p.status] || p.status}</span>
              <span className="font-mono">{p.total_tokens} tokens</span>
            </div>
          </button>
        ))}
        {sel && (
          <Button className="w-full" onClick={() => onContinue(sel.id)}>继续对话迭代</Button>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-lg font-semibold">过程消息</h2>
        {sel ? <MessagePool messages={data.messages} /> : <p className="text-sm text-muted-foreground">选择左侧项目以回看。</p>}
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-lg font-semibold">产物</h2>
        <ArtifactPanel artifacts={data.artifacts} name={`sky-project-${sel?.id ?? ''}`} />
      </Card>
    </div>
  );
}
