import { FormEvent, useState } from 'react';
import { Bot, KeyRound, Loader2, LogIn, Network, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAccount } from '@/contexts/AccountContext';
import { emailProblem, passwordProblem, passwordStrength } from '@/lib/accounts';
import { errMsg } from '@/lib/sky';

type Mode = 'login' | 'register';

const STRENGTH_LABEL = ['', '偏弱', '一般', '较强'];
const STRENGTH_COLOR = ['bg-muted', 'bg-destructive', 'bg-amber-500', 'bg-green-600'];

export default function LoginPage() {
  const { signIn, signUp, signInDemo } = useAccount();
  const [mode, setMode] = useState<Mode>('login');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<'form' | 'demo' | ''>('');
  const [error, setError] = useState('');

  const strength = passwordStrength(password);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirm('');
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === 'register') {
      const problem = emailProblem(email) || passwordProblem(password) || (password !== confirm ? '两次输入的密码不一致' : '');
      if (problem) {
        setError(problem);
        return;
      }
    } else if (!identifier.trim() || !password) {
      setError('请填写账号和密码');
      return;
    }
    setBusy('form');
    try {
      if (mode === 'register') await signUp(email, password, confirm);
      else await signIn(identifier.trim(), password, remember);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  async function demo() {
    setError('');
    setBusy('demo');
    try {
      await signInDemo();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl items-start gap-8 py-10 lg:grid-cols-[1fr_380px]">
      <section>
        <p className="mb-3 font-mono text-sm text-primary">多 Agent 协作 · 从需求到可运行产物</p>
        <h1 className="text-3xl font-bold leading-tight">一句话需求，交给一支 AI 软件团队</h1>
        <p className="mt-4 text-muted-foreground">
          Sky Agent 是一个多 Agent 协作站点：产品经理、架构师、工程师等角色通过共享消息池发布与订阅消息，按 SOP 顺序协作，
          产出 PRD、系统设计和可直接下载的代码。使用你自己的 OpenAI 兼容 API Key。
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-2 text-sm">
          {['用户需求', '产品经理', '架构师', '工程师', '代码产物'].map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <span className="flex items-center gap-1 rounded-md border bg-card px-3 py-2">
                <Bot className="h-4 w-4 text-primary" />
                {s}
              </span>
            </span>
          ))}
        </div>
      </section>

      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2 font-semibold">
          <Network className="h-5 w-5 text-primary" />
          {mode === 'login' ? '登录 Sky Agent' : '注册新账号'}
        </div>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`rounded px-3 py-1.5 ${mode === 'login' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`rounded px-3 py-1.5 ${mode === 'register' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
          >
            注册
          </button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          {mode === 'login' ? (
            <div className="space-y-1">
              <Label htmlFor="identifier">邮箱或用户名</Label>
              <Input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@example.com 或 demo"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? '请输入密码' : '至少 6 位，需含字母和数字'}
            />
            {mode === 'register' && password && (
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span className="flex h-1.5 flex-1 gap-1">
                  {[1, 2, 3].map((i) => (
                    <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= strength ? STRENGTH_COLOR[strength] : 'bg-muted'}`} />
                  ))}
                </span>
                <span>强度：{STRENGTH_LABEL[strength]}</span>
              </div>
            )}
          </div>

          {mode === 'register' && (
            <div className="space-y-1">
              <Label htmlFor="confirm">确认密码</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="请再次输入密码"
              />
              {confirm && confirm !== password && <p className="text-xs text-destructive">两次输入的密码不一致</p>}
            </div>
          )}

          {mode === 'login' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-input" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              记住我（30 天内免登录）
            </label>
          )}

          {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={!!busy}>
            {busy === 'form' ? (
              <><Loader2 className="mr-1 h-4 w-4 animate-spin" />处理中…</>
            ) : mode === 'login' ? (
              <><LogIn className="mr-1 h-4 w-4" />登录</>
            ) : (
              <><UserPlus className="mr-1 h-4 w-4" />注册并登录</>
            )}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          或
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="outline" className="w-full !bg-transparent !hover:bg-transparent" onClick={demo} disabled={!!busy}>
          {busy === 'demo' ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />正在进入…</> : <><KeyRound className="mr-1 h-4 w-4" />演示账号一键登录</>}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          这是演示账号（demo / demo123），数据公开共享且为只读，请勿填写任何真实信息。
        </p>
      </Card>
    </div>
  );
}
