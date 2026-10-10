import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Artifact, LlmConfig, PoolMessage, Project, ROLE_TYPES, Role, STATUS_LABEL, api, client, deleteProject, errMsg, loadProjectData, roleLabel } from '@/lib/sky';
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

export { RolesPanel } from './RolesPanel';
