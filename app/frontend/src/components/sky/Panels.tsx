import { useEffect, useMemo, useState } from 'react';
import Markdown from 'markdown-to-jsx';
import { AlertTriangle, Download, ExternalLink, FileCode2, FileText, Package, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Artifact, PoolMessage, buildPreview, downloadFile, downloadZip, typeColor } from '@/lib/sky';

export function MessagePool({ messages, live }: { messages: PoolMessage[]; live?: { sender: string; text: string } | null }) {
  return (
    <div className="space-y-3">
      {messages.length === 0 && !live && (
        <p className="text-sm text-muted-foreground">消息池为空。发送需求后，各 Agent 发布的消息会按时间线出现在这里。</p>
      )}
      {messages.map((m) => (
        <MessageCard key={m.id} m={m} />
      ))}
      {live && (
        <div className="rounded-lg border border-primary/40 bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            {live.sender} 正在输出…
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{live.text || '思考中…'}</pre>
        </div>
      )}
    </div>
  );
}

function MessageCard({ m }: { m: PoolMessage }) {
  const [open, setOpen] = useState(false);
  const isUser = m.sender === 'User';
  return (
    <div className={`rounded-lg border p-3 shadow-sm ${isUser ? 'bg-muted/60' : 'bg-card'}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-secondary px-1.5 font-mono text-xs text-secondary-foreground">v{m.version || 1}</span>
        <span className="font-semibold">{isUser ? '你' : m.sender}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${typeColor(m.msg_type)}`}>{m.msg_type}</span>
        <span className="text-xs text-muted-foreground">→ 订阅者：{m.subscribers || '无'}</span>
        {m.prompt_tokens + m.completion_tokens > 0 && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            in {m.prompt_tokens} / out {m.completion_tokens} tokens
          </span>
        )}
      </div>
      {isUser ? (
        <p className="mt-2 whitespace-pre-wrap text-sm">{m.content}</p>
      ) : (
        <>
          <div className={`prose prose-sm mt-2 max-w-none overflow-hidden text-sm ${open ? '' : 'max-h-32'}`}>
            <Markdown>{m.content}</Markdown>
          </div>
          <button className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen(!open)}>
            {open ? '收起' : '展开全文'}
          </button>
        </>
      )}
    </div>
  );
}

function Preview({ html }: { html: string }) {
  const [nonce, setNonce] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    setErrors([]);
    const onMsg = (e: MessageEvent) => {
      const err = e.data?.skyPreviewError;
      if (err) setErrors((list) => (list.includes(err) || list.length >= 5 ? list : [...list, err]));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [html, nonce]);
  const openWindow = () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}><RefreshCw className="mr-1 h-3 w-3" />刷新</Button>
        <Button size="sm" variant="outline" onClick={openWindow}><ExternalLink className="mr-1 h-3 w-3" />新窗口打开</Button>
      </div>
      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          <div className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3 w-3" />页面运行出错（可以发消息让 Agent 修复）：</div>
          {errors.map((e) => <div key={e} className="font-mono">{e}</div>)}
        </div>
      )}
      <iframe
        key={nonce}
        title="产物预览"
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        srcDoc={html}
        className="h-[62vh] w-full rounded-md border bg-white"
      />
    </div>
  );
}

export function ArtifactPanel({ artifacts, name }: { artifacts: Artifact[]; name: string }) {
  const versions = useMemo(
    () => Array.from(new Set(artifacts.map((a) => a.version || 1))).sort((a, b) => b - a),
    [artifacts],
  );
  const [ver, setVer] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<'preview' | 'files'>('preview');
  const activeVer = ver && versions.includes(ver) ? ver : versions[0];
  const files = useMemo(() => artifacts.filter((a) => (a.version || 1) === activeVer), [artifacts, activeVer]);
  const codeFiles = useMemo(() => files.filter((a) => a.kind === 'code'), [files]);
  const html = useMemo(() => buildPreview(codeFiles), [codeFiles]);
  const current = files.find((a) => a.id === sel) || files[0];

  useEffect(() => {
    setVer(null);
    setSel(null);
  }, [artifacts.length]);

  if (!artifacts.length) {
    return <p className="text-sm text-muted-foreground">暂无产物。PRD、系统设计与代码文件生成后会显示在这里。</p>;
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(['preview', 'files'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              {t === 'preview' ? '预览' : '文件'}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="artifact-version">版本</label>
        <select
          id="artifact-version"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={activeVer}
          onChange={(e) => {
            setVer(Number(e.target.value));
            setSel(null);
          }}
        >
          {versions.map((v, i) => (
            <option key={v} value={v}>v{v}{i === 0 ? '（最新）' : ''}</option>
          ))}
        </select>
        <Button size="sm" className="ml-auto" onClick={() => downloadZip(files, `${name}-v${activeVer}`)}>
          <Package className="mr-1 h-4 w-4" /> 下载 ZIP
        </Button>
      </div>
      {tab === 'preview' ? (
        html ? (
          <Preview html={html} />
        ) : (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">
            该版本还没有可预览的网页（工程师尚未完成或任务被中断）。可以在「文件」中查看已生成的文档，或继续发消息让团队补全。
          </p>
        )
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[180px_1fr]">
          <ul className="space-y-1 overflow-auto rounded-md border p-2 text-sm">
            {files.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setSel(a.id)}
                  className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left font-mono text-xs hover:bg-muted ${current?.id === a.id ? 'bg-muted font-semibold' : ''}`}
                >
                  {a.kind === 'doc' ? <FileText className="h-3 w-3 shrink-0" /> : <FileCode2 className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{a.path}</span>
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <div className="min-w-0 rounded-md border">
              <div className="flex items-center gap-1 border-b px-3 py-2">
                <Badge variant="outline" className="truncate font-mono">{current.path}</Badge>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => downloadFile(current)} aria-label="下载文件">
                  <Download className="h-4 w-4" />
                </Button>
              </div>
              <div className="max-h-[60vh] overflow-auto p-3">
                {current.kind === 'doc' ? (
                  <div className="prose prose-sm max-w-none"><Markdown>{current.content}</Markdown></div>
                ) : (
                  <pre className="whitespace-pre font-mono text-xs">{current.content}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
