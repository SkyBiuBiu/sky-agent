import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAccount } from '@/contexts/AccountContext';
import { passwordProblem, passwordStrength } from '@/lib/accounts';
import { errMsg } from '@/lib/sky';

const STRENGTH_LABEL = ['', '偏弱', '一般', '较强'];

export function AccountPanel() {
  const { user, isDemo, changePassword } = useAccount();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const problem = passwordProblem(next) || (next !== confirm ? '两次输入的新密码不一致' : '');
    if (problem) {
      toast.error(problem);
      return;
    }
    if (!current) {
      toast.error('请填写当前密码');
      return;
    }
    setBusy(true);
    try {
      const detail = await changePassword(current, next, confirm);
      toast.success(detail);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const strength = passwordStrength(next);

  return (
    <Card className="mx-auto max-w-xl space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">我的账号</h2>
        <p className="mt-1 text-xs text-muted-foreground">{user?.email}</p>
      </div>

      {isDemo ? (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>当前是演示账号</AlertTitle>
          <AlertDescription>
            演示账号数据公开共享且为只读，可以浏览工作台、历史项目与产物，但不能创建、修改或删除数据，也不支持修改密码。
            注册一个自己的账号即可创建项目、配置模型并保存历史。
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">修改密码后，下次登录请使用新密码；当前登录状态会继续保持。</p>
          <div className="space-y-1">
            <Label htmlFor="current">当前密码</Label>
            <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="next">新密码</Label>
            <Input id="next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="至少 6 位，需含字母和数字" />
            {next && strength > 0 && <p className="text-xs text-muted-foreground">强度：{STRENGTH_LABEL[strength]}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm">确认新密码</Label>
            <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {confirm && confirm !== next && <p className="text-xs text-destructive">两次输入的新密码不一致</p>}
          </div>
          <Button onClick={submit} disabled={busy}>
            {busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />提交中…</> : '确认修改密码'}
          </Button>
        </>
      )}
    </Card>
  );
}

export default AccountPanel;
