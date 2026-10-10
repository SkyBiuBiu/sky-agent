import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, GripVertical, Plus, Search, Trash2 } from 'lucide-react';
import {
  DndContext, DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ROLE_TYPES, Role, api, client, errMsg, roleLabel } from '@/lib/sky';
import { useAccount } from '@/contexts/AccountContext';

const DEMO_HINT = '演示账号为只读账号，注册后即可新建、编辑和排序角色。';
const NEW_ID = -1; // unsaved draft; written to the database only on save
const blankRole = (order: number): TeamRole => ({
  id: NEW_ID, name: '', profile: '', goal: '', system_prompt: '',
  subscribe_types: 'Code', publish_type: 'Review', artifact_kind: 'doc', sop_order: order, enabled: true,
});

type TeamRole = Role & { position?: number | null };
interface RolesRes { mine: TeamRole[] }

export function RolesPanel() {
  const { isDemo } = useAccount();
  const [mine, setMine] = useState<TeamRole[]>([]);
  const [draft, setDraft] = useState<TeamRole | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Role | null>(null);

  const load = async (pick?: number) => {
    const r = await api<RolesRes>('/api/v1/sky/roles');
    setMine(r.mine);
    setSelected((cur) => {
      const want = pick ?? cur;
      if (want && r.mine.some((x) => x.id === want)) return want;
      return r.mine[0]?.id ?? null;
    });
  };
  useEffect(() => {
    load().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = useMemo(() => mine.find((r) => r.id === selected) ?? null, [selected, mine]);
  useEffect(() => {
    if (selected !== NEW_ID) setDraft(current ? { ...current } : null);
  }, [current, selected]);

  const match = (r: Role) => {
    const q = query.trim().toLowerCase();
    return !q || `${roleLabel(r.name)} ${r.profile} ${r.goal}`.toLowerCase().includes(q);
  };
  const select = (id: number) => {
    setSelected(id);
    setMobileDetail(true);
  };

  const create = () => {
    setSelected(NEW_ID);
    setDraft(blankRole(mine.length + 1));
    setMobileDetail(true);
  };
  const cancelNew = () => {
    setDraft(null);
    setSelected(mine[0]?.id ?? null);
    setMobileDetail(false);
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.goal.trim() || !draft.system_prompt.trim()) {
      toast.error('角色名称、职责目标和系统提示词为必填项');
      return;
    }
    try {
      const { id, name, profile, goal, system_prompt, subscribe_types, publish_type, artifact_kind, sop_order, enabled } = draft;
      const data = {
        name: name.trim(), profile: profile.trim() || name.trim(), goal: goal.trim(), system_prompt: system_prompt.trim(),
        subscribe_types, publish_type, artifact_kind, sop_order: Number(sop_order), enabled,
      };
      let savedId = id;
      if (id === NEW_ID) {
        const res = await client.entities.agent_roles.create({ data: { ...data, sop_order: mine.length + 1 } });
        savedId = Number((res.data as Role).id);
      } else {
        await client.entities.agent_roles.update({ id: String(id), data });
      }
      toast.success(`已保存「${data.name}」`);
      setSelected(savedId);
      await load(savedId);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await client.entities.agent_roles.delete({ id: String(pendingDelete.id) });
      toast.success('角色已删除');
      setPendingDelete(null);
      setSelected(null);
      setMobileDetail(false);
      await load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || isDemo) return;
    const prev = mine;
    const next = arrayMove(mine, mine.findIndex((r) => r.id === active.id), mine.findIndex((r) => r.id === over.id));
    setMine(next);
    try {
      await api('/api/v1/sky/roles/reorder', 'POST', { ids: next.map((r) => r.id) });
      await load();
      toast.success('已保存新的执行顺序');
    } catch (e) {
      setMine(prev);
      toast.error(errMsg(e));
    }
  };

  const shownMine = mine.filter(match);
  const searching = query.trim().length > 0;
  const readOnly = isDemo;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Agent 角色</h2>
        <p className="text-xs text-muted-foreground">
          列表顺序就是 SOP 执行顺序：从上到下依次执行，拖动即可调整；停用的角色不参与执行。
        </p>
        {isDemo && <p className="mt-1 text-xs text-muted-foreground">{DEMO_HINT}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <Card className={`min-w-0 space-y-4 p-3 ${mobileDetail ? 'hidden lg:block' : ''}`}>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索角色" className="pl-8" aria-label="搜索角色" />
            </div>
            <Button onClick={create} disabled={isDemo} className="shrink-0">
              <Plus className="mr-1 h-4 w-4" />新建
            </Button>
          </div>

          <section className="space-y-1">
            <h3 className="px-1 text-xs font-semibold text-muted-foreground">
              我的角色 {mine.length > 1 && !isDemo && !searching && '· 拖动调整顺序'}
            </h3>
            {mine.length === 0 ? (
              <div className="space-y-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <p>还没有角色。运行前请先添加至少一个角色。</p>
                <Button size="sm" variant="outline" disabled={isDemo} onClick={create}><Plus className="mr-1 h-3 w-3" />新建角色</Button>
              </div>
            ) : shownMine.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">没有匹配的角色</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={shownMine.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                  {shownMine.map((r) => (
                    <SortableRoleItem
                      key={r.id}
                      role={r}
                      draggable={!isDemo && !searching && mine.length > 1}
                      active={selected === r.id}
                      onSelect={() => select(r.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </section>
        </Card>

        <Card className={`min-w-0 p-5 ${mobileDetail ? '' : 'hidden lg:block'}`}>
          <Button variant="ghost" size="sm" className="mb-3 px-2 lg:hidden" onClick={() => setMobileDetail(false)}>
            <ArrowLeft className="mr-1 h-4 w-4" />返回角色列表
          </Button>
          {!draft ? (
            <p className="text-sm text-muted-foreground">请从左侧选择一个角色。</p>
          ) : (
            <RoleDetail
              key={draft.id}
              role={draft}
              readOnly={readOnly}
              onChange={(d) => setDraft((r) => (r ? { ...r, ...d } : r))}
              onSave={save}
              onCancel={draft.id === NEW_ID ? cancelNew : undefined}
              onDelete={() => setPendingDelete(draft)}
            />
          )}
        </Card>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个角色？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{pendingDelete ? roleLabel(pendingDelete.name) : ''}」，此操作不可恢复。已有会话中的历史消息不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ItemBody({ role }: { role: Role }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-sm font-medium">{roleLabel(role.name)}</span>
        {!role.enabled && <span className="shrink-0 text-xs text-muted-foreground">已停用</span>}
        {(role as TeamRole).position ? <span className="ml-auto shrink-0 rounded bg-secondary px-1.5 text-xs text-secondary-foreground">第 {(role as TeamRole).position} 位</span> : null}
      </div>
      <p className="truncate text-xs text-muted-foreground">{role.goal || '未填写职责目标'}</p>
    </div>
  );
}

const itemClass = (active: boolean) =>
  `flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
    active ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'
  }`;

function SortableRoleItem({ role, active, draggable, onSelect }: {
  role: Role; active: boolean; draggable: boolean; onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: role.id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${itemClass(active)} ${isDragging ? 'relative z-10 border-dashed border-primary bg-muted opacity-70 shadow-md' : ''}`}
    >
      {draggable && (
        <button
          type="button"
          className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          aria-label={`拖动调整「${roleLabel(role.name)}」的顺序，可用空格键拾起后用方向键移动`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left" aria-current={active}>
        <ItemBody role={role} />
      </button>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function RoleDetail({ role, readOnly, onChange, onSave, onCancel, onDelete }: {
  role: TeamRole;
  readOnly: boolean;
  onChange: (d: Partial<Role>) => void;
  onSave: () => void;
  onCancel?: () => void;
  onDelete: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{roleLabel(role.name) || '新建角色'}</h3>
          <p className="text-xs text-muted-foreground">
            {role.id === NEW_ID ? '新角色（未保存）· 保存后排在列表最后' : role.position ? `SOP 第 ${role.position} 位` : '已停用，不参与执行'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={role.enabled} disabled={readOnly} onCheckedChange={(v) => onChange({ enabled: v })} />
          启用
        </label>
      </div>

      <Field id="role-name" label="角色名称">
        <Input id="role-name" value={role.name} disabled={readOnly} placeholder="例如：产品经理" onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field id="role-goal" label="职责目标">
        <Input id="role-goal" value={role.goal} disabled={readOnly} placeholder="例如：把一句话需求整理成结构清晰的 PRD" onChange={(e) => onChange({ goal: e.target.value })} />
      </Field>
      <Field id="role-prompt" label="系统提示词">
        <Textarea
          id="role-prompt"
          rows={7}
          value={role.system_prompt}
          disabled={readOnly}
          placeholder="例如：你是资深产品经理，根据用户需求输出 Markdown 格式的 PRD，包含目标、功能列表与验收标准。"
          onChange={(e) => onChange({ system_prompt: e.target.value })}
        />
      </Field>

      <Collapsible open={advanced} onOpenChange={setAdvanced}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="px-2 text-muted-foreground">
            <ChevronDown className={`mr-1 h-4 w-4 transition-transform ${advanced ? 'rotate-180' : ''}`} />
            高级设置（职位、SOP 位置、消息订阅与产物类型）
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <Field id="role-profile" label="职位">
            <Input id="role-profile" value={role.profile} disabled={readOnly} placeholder="例如：产品经理" onChange={(e) => onChange({ profile: e.target.value })} />
          </Field>
          <Field id="role-order" label="SOP 位置（数字越小越先执行，也可在左侧拖动调整）">
            <Input id="role-order" type="number" value={role.sop_order} disabled={readOnly} onChange={(e) => onChange({ sop_order: Number(e.target.value) })} />
          </Field>
          <Field id="role-sub" label="订阅类型（逗号分隔）">
            <Input id="role-sub" value={role.subscribe_types} disabled={readOnly} placeholder={`例如：${ROLE_TYPES.slice(0, 2).join(', ')}`} onChange={(e) => onChange({ subscribe_types: e.target.value })} />
          </Field>
          <Field id="role-pub" label="发布类型">
            <Input id="role-pub" value={role.publish_type} disabled={readOnly} placeholder="例如：PRD" onChange={(e) => onChange({ publish_type: e.target.value })} />
          </Field>
          <Field id="role-kind" label="产物类型">
            <select
              id="role-kind"
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              value={role.artifact_kind}
              disabled={readOnly}
              onChange={(e) => onChange({ artifact_kind: e.target.value })}
            >
              <option value="doc">文档</option>
              <option value="code">代码文件</option>
              <option value="none">无</option>
            </select>
          </Field>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex justify-end gap-2 border-t pt-3">
        {onCancel ? (
          <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
        ) : (
        <Button size="sm" variant="outline" disabled={readOnly} onClick={onDelete}>
          <Trash2 className="mr-1 h-4 w-4" />删除
        </Button>
        )}
        <Button size="sm" disabled={readOnly} onClick={onSave}>保存</Button>
      </div>
    </div>
  );
}
