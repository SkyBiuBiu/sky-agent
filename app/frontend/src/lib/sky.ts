import { createClient } from '@metagptx/web-sdk';
import JSZip from 'jszip';

export const client = createClient();

export interface Role {
  id: number;
  name: string;
  profile: string;
  goal: string;
  system_prompt: string;
  subscribe_types: string;
  publish_type: string;
  artifact_kind: string;
  sop_order: number;
  enabled: boolean;
}

export interface Project {
  id: number;
  title: string;
  requirement: string;
  status: string;
  total_tokens: number;
  current_version?: number;
  created_at?: string;
}

export const STATUS_LABEL: Record<string, string> = {
  running: '进行中',
  done: '已完成',
  failed: '失败',
  interrupted: '已中断',
};

export interface PoolMessage {
  id: number;
  version?: number;
  project_id?: number;
  sender: string;
  msg_type: string;
  subscribers: string;
  content: string;
  prompt_tokens: number;
  completion_tokens: number;
  created_at?: string;
}

export interface Artifact {
  id: number;
  version?: number;
  project_id: number;
  kind: string;
  path: string;
  content: string;
}

export interface LlmConfig {
  configured: boolean;
  base_url: string;
  model: string;
  masked_key: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const errMsg = (e: any) =>
  e?.data?.detail || e?.response?.data?.detail || e?.message || '请求失败';

export async function api<T>(
  url: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  data: object = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await client.apiCall.invoke({ url, method, data, options: { timeout: 95000, signal } });
  return res.data as T;
}

export const SESSION_KEY = 'sky_active_session';

/** Delete a saved session together with its pool messages and artifacts. */
export const deleteProject = (projectId: number) =>
  api<{ deleted: boolean; project_id: number }>(`/api/v1/sky/projects/${projectId}`, 'DELETE');

const ERROR_HOOK = `<script>(function(){function s(m){try{parent.postMessage({skyPreviewError:String(m)},'*')}catch(e){}}
window.addEventListener('error',function(e){s(e.message+(e.lineno?' (行 '+e.lineno+')':''))});
window.addEventListener('unhandledrejection',function(e){s('Promise: '+(e.reason&&e.reason.message||e.reason))});})();</script>`;

/** Sandboxed iframe (no allow-same-origin) throws on Web Storage access; fall back to in-memory storage. */
const STORAGE_SHIM = `<script>(function(){['localStorage','sessionStorage'].forEach(function(n){var ok=false;try{var s=window[n];var k='__sky_t';s.setItem(k,'1');s.removeItem(k);ok=true}catch(e){}if(ok)return;
var m=new Map();var impl={getItem:function(k){k=String(k);return m.has(k)?m.get(k):null},setItem:function(k,v){m.set(String(k),String(v))},removeItem:function(k){m.delete(String(k))},clear:function(){m.clear()},key:function(i){var a=Array.from(m.keys());return i>=0&&i<a.length?a[i]:null}};
Object.defineProperty(impl,'length',{get:function(){return m.size}});try{Object.defineProperty(window,n,{value:impl,configurable:true})}catch(e){}});})();</script>`;

/** Build a self-contained preview document: inline local css/js and inject storage shim + runtime error hook. Downloads use raw files. */
export function buildPreview(files: Artifact[]): string | null {
  const entry = files.find((f) => /(^|\/)index\.html?$/i.test(f.path)) || files.find((f) => /\.html?$/i.test(f.path));
  if (!entry) return null;
  const byName = new Map(files.map((f) => [f.path.replace(/^\.?\//, ''), f.content]));
  let html = entry.content
    .replace(/<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (m, p) => {
      const c = byName.get(p.replace(/^\.?\//, ''));
      return c !== undefined ? `<style>${c}</style>` : m;
    })
    .replace(/<script([^>]*)src=["']([^"']+\.js)["']([^>]*)><\/script>/gi, (m, a, p, b) => {
      const c = byName.get(p.replace(/^\.?\//, ''));
      return c !== undefined ? `<script${a}${b}>${c.replace(/<\/script>/gi, '<\\/script>')}</script>` : m;
    });
  const inject = STORAGE_SHIM + ERROR_HOOK;
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + inject) : inject + html;
  return html;
}

export const ROLE_TYPES = ['UserRequirement', 'PRD', 'SystemDesign', 'Code'];

/** 旧版本历史数据使用英文人名，统一映射为中文职位名展示。 */
const LEGACY_ROLE_NAMES: Record<string, string> = {
  Emma: '产品经理',
  Bob: '架构师',
  Alex: '工程师',
  Sarah: 'SEO 专家',
  David: '数据分析师',
  Mike: '项目经理',
};

export const roleLabel = (name: string) => LEGACY_ROLE_NAMES[name?.trim()] ?? name;

/** 订阅者字段可能是逗号分隔的多个角色名，逐个映射。 */
export const roleListLabel = (names: string) =>
  (names || '')
    .split(/[,，]/)
    .map((n) => n.trim())
    .filter(Boolean)
    .map(roleLabel)
    .join('、');

export const typeColor = (t: string) =>
  ({
    UserRequirement: 'bg-muted text-foreground',
    PRD: 'bg-amber-100 text-amber-800',
    SystemDesign: 'bg-teal-100 text-teal-800',
    Code: 'bg-indigo-100 text-indigo-800',
  })[t] || 'bg-secondary text-secondary-foreground';

export async function loadProjectData(projectId: number) {
  const [m, a] = await Promise.all([
    client.entities.pool_messages.query({ query: { project_id: projectId }, sort: 'id', limit: 200 }),
    client.entities.artifacts.query({ query: { project_id: projectId }, sort: 'id', limit: 200 }),
  ]);
  return { messages: (m.data?.items || []) as PoolMessage[], artifacts: (a.data?.items || []) as Artifact[] };
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const downloadFile = (art: Artifact) =>
  saveBlob(new Blob([art.content], { type: 'text/plain;charset=utf-8' }), art.path.split('/').pop() || 'file.txt');

export async function downloadZip(arts: Artifact[], name: string) {
  const zip = new JSZip();
  arts.forEach((a) => zip.file(a.path.replace(/^\/+/, ''), a.content));
  saveBlob(await zip.generateAsync({ type: 'blob' }), `${name}.zip`);
}
