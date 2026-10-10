"""Sky Agent orchestration: role-based agents, shared message pool and SOP."""
import json
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.agent_roles import Agent_roles
from models.llm_configs import Llm_configs

DEFAULT_ROLES: List[Dict[str, Any]] = [
    {
        "name": "产品经理", "profile": "产品经理", "goal": "把用户需求整理为清晰可执行的 PRD",
        "system_prompt": "你是资深产品经理。根据用户需求输出一份 Markdown 格式的 PRD，包含：产品目标、用户故事、需求池（P0/P1/P2）、UI 草图描述、待确认问题。只输出 PRD 正文。",
        "subscribe_types": "UserRequirement", "publish_type": "PRD", "artifact_kind": "doc", "sop_order": 1,
    },
    {
        "name": "架构师", "profile": "架构师", "goal": "基于 PRD 设计简洁可用的系统",
        "system_prompt": "你是资深软件架构师。根据 PRD 输出 Markdown 格式的系统设计，包含：实现方案、技术选型、文件列表、数据结构与接口（可用 mermaid classDiagram）、调用流程（mermaid sequenceDiagram）。只输出设计正文。",
        "subscribe_types": "PRD", "publish_type": "SystemDesign", "artifact_kind": "doc", "sop_order": 2,
    },
    {
        "name": "工程师", "profile": "工程师", "goal": "根据系统设计编写完整可运行的代码",
        "system_prompt": "你是资深工程师。根据系统设计实现一个可直接在浏览器打开运行的 demo。硬性要求：只输出 1 个文件 index.html，CSS 与 JS 全部内联，不使用构建工具；如确需第三方库只能用 https CDN 链接，禁止引用任何本地文件；代码精简，总长度控制在 300 行以内，确保完整输出到 </html>；直接写代码，不要解释。严格使用如下格式输出：\n### FILE: index.html\n```html\n完整代码\n```\n如用到 localStorage/sessionStorage，必须用 try/catch 包裹，不可用时降级为内存存储，不得因存储异常导致白屏；不要输出省略号或 TODO。",
        "subscribe_types": "SystemDesign", "publish_type": "Code", "artifact_kind": "code", "sop_order": 3,
    },
    {
        "name": "QA工程师", "profile": "QA工程师", "goal": "审查工程师产出的代码与可预览页面，保证可用性与质量",
        "system_prompt": "你是资深 QA 工程师。根据原始需求、PRD 与工程师交付的 index.html 代码做静态审查（你无法真正运行页面，请基于代码推断运行效果）。输出 Markdown 格式的测试报告，包含：1. 测试结论（通过 / 有条件通过 / 不通过）；2. 测试用例表（编号、场景、步骤、预期结果、根据代码判断的结果）；3. 问题清单（严重程度：高/中/低、位置、现象）；4. 修复建议（具体到函数或代码片段）。只输出报告正文。",
        "subscribe_types": "Code", "publish_type": "TestReport", "artifact_kind": "doc", "sop_order": 4,
    },
]

FILE_RE = re.compile(r"###\s*FILE:\s*`?([^\n`]+?)`?\s*\n```[^\n]*\n(.*?)\n```", re.S)
FENCE_RE = re.compile(r"```([a-zA-Z0-9+#]*)\n(.*?)\n```", re.S)
EXT = {"html": ".html", "js": ".js", "javascript": ".js", "ts": ".ts", "css": ".css",
       "python": ".py", "py": ".py", "json": ".json", "md": ".md", "": ".txt"}


def mask_key(key: str) -> str:
    if not key:
        return ""
    return f"{key[:3]}****{key[-4:]}" if len(key) > 8 else "****"


async def get_config(db: AsyncSession, user_id: str) -> Optional[Llm_configs]:
    res = await db.execute(
        select(Llm_configs).where(Llm_configs.user_id == user_id).order_by(Llm_configs.id.desc())
    )
    return res.scalars().first()


def order_key(r: Agent_roles):
    return (r.sop_order, r.id)


def _by_order(roles: List[Agent_roles]) -> List[Agent_roles]:
    return sorted(roles, key=order_key)


async def own_roles(db: AsyncSession, user_id: str) -> List[Agent_roles]:
    res = await db.execute(select(Agent_roles).where(Agent_roles.user_id == user_id))
    return _by_order(list(res.scalars().all()))


async def normalize_order(db: AsyncSession, user_id: str) -> List[Agent_roles]:
    """Renumber the user's roles 1..n in their current order so shown positions equal execution order."""
    roles = await own_roles(db, user_id)
    changed = False
    for i, r in enumerate(roles, start=1):
        if r.sop_order != i:
            r.sop_order, changed = i, True
    if changed:
        await db.commit()
    return roles


async def seed_default_roles(db: AsyncSession, user_id: str) -> None:
    """Give a user their own copies of the default roles. Idempotent: skips names the user already has;
    the user's other roles keep their relative order after the defaults."""
    existing = await own_roles(db, user_id)
    names = {r.name for r in existing}
    added = [Agent_roles(user_id=user_id, enabled=True, **r) for r in DEFAULT_ROLES if r["name"] not in names]
    if not added:
        return
    for r in added:
        db.add(r)
    await db.flush()
    defaults = {r["name"]: r["sop_order"] for r in DEFAULT_ROLES}
    everyone = existing + added
    ranked = sorted(everyone, key=lambda r: (0, defaults[r.name], 0) if r.name in defaults
                    else (1, r.sop_order, r.id or 0))
    for i, r in enumerate(ranked, start=1):
        r.sop_order = i
    await db.commit()


def enabled_roles(roles: List[Agent_roles]) -> List[Agent_roles]:
    return [r for r in roles if r.enabled]


def split_types(value: str) -> List[str]:
    return [t.strip() for t in (value or "").split(",") if t.strip()]


def candidate_urls(base_url: str) -> List[str]:
    """Tolerate common Base URL variants: with/without /v1 or a full /chat/completions path."""
    base = (base_url or "").strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = "https://" + base
    if base.endswith("/chat/completions"):
        return [base]
    urls = [base + "/chat/completions"]
    if not re.search(r"/v\d+[a-z]*$", base):
        urls.append(base + "/v1/chat/completions")
    return urls


def _upstream_msg(resp: httpx.Response) -> str:
    try:
        err = resp.json().get("error")
        msg = err.get("message") if isinstance(err, dict) else err
    except Exception:
        msg = resp.text
    return str(msg or "")[:200]


async def call_llm(base_url: str, model: str, api_key: str, messages: List[Dict[str, str]],
                   max_tokens: Optional[int] = None, timeout: float = 180.0,
                   allow_empty: bool = False) -> Tuple[str, int, int]:
    """Call an OpenAI-compatible chat completion endpoint. Never logs the key."""
    payload: Dict[str, Any] = {"model": model.strip(), "messages": messages, "stream": False}
    if max_tokens:
        payload["max_tokens"] = max_tokens
    # Reasoning models (e.g. SenseNova) otherwise spend the whole output budget on hidden thinking.
    # Unknown fields are ignored by OpenAI-compatible providers; retried without them on 400.
    payload["thinking"] = {"type": "disabled"}
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    resp: Optional[httpx.Response] = None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0), follow_redirects=True) as client:
            for url in candidate_urls(base_url):
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 400 and "thinking" in payload:
                    payload.pop("thinking")
                    resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 404:
                    break
                if "model" in _upstream_msg(resp).lower():
                    break
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="请求超时：模型接口长时间未响应，请稍后重试或更换模型")
    except Exception:
        raise HTTPException(status_code=400, detail="无法连接到 Base URL，请检查地址是否正确（如 https://api.openai.com/v1）")
    detail = _upstream_msg(resp)
    if resp.status_code in (401, 403):
        raise HTTPException(status_code=400, detail=f"API Key 无效或无权限（{resp.status_code}）：{detail}")
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail=f"接口限流（429）：请求过于频繁或额度不足，请稍后重试。{detail}")
    if resp.status_code == 404:
        raise HTTPException(status_code=400, detail=f"接口或模型不存在（404），请检查 Base URL（通常以 /v1 结尾）与模型名。{detail}")
    if resp.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"模型接口返回错误（{resp.status_code}）：{detail}")
    try:
        data = resp.json()
        choice = data["choices"][0]
        msg = choice.get("message") or choice.get("delta") or {}
        # Some providers (e.g. SenseNova reasoning models) return `reasoning` instead of `content`.
        content = (msg.get("content") or msg.get("reasoning_content") or msg.get("reasoning") or "").strip()
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        raise HTTPException(status_code=400, detail="模型返回格式无法解析，请确认接口兼容 OpenAI 协议")
    if not content and not allow_empty:
        raise HTTPException(status_code=400, detail="模型返回了空内容，请更换模型或稍后重试")
    usage = data.get("usage") or {}
    return content, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)


async def probe_llm(base_url: str, model: str, api_key: str) -> Dict[str, Any]:
    """Fast connectivity check: GET /models first, minimal chat only when the model is not listed.

    Uses strict timeouts (connect 5s, total <=10s per call) so it always returns well
    before the gateway limit. Never logs the key.
    """
    headers = {"Authorization": f"Bearer {api_key.strip()}"}
    base = candidate_urls(base_url)[0][: -len("/chat/completions")]
    model = model.strip()
    timeout = httpx.Timeout(6.0, connect=4.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(base + "/models", headers=headers)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="连接超时（10 秒），请检查 Base URL 或稍后重试")
    except Exception:
        raise HTTPException(status_code=400, detail="无法连接到 Base URL，请检查地址是否正确（如 https://api.openai.com/v1）")
    if resp.status_code in (401, 403):
        raise HTTPException(status_code=400, detail=f"API Key 无效或无权限（{resp.status_code}）：{_upstream_msg(resp)}")
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail=f"接口限流（429），请稍后重试。{_upstream_msg(resp)}")
    if resp.status_code == 200:
        try:
            ids = {str(m.get("id")) for m in resp.json().get("data", []) if isinstance(m, dict)}
        except Exception:
            ids = set()
        if model in ids:
            return {"method": "models", "reply": f"模型 {model} 可用"}
    # /models unsupported or model not listed: confirm with the smallest possible completion.
    text, _, _ = await call_llm(base_url, model, api_key, [{"role": "user", "content": "hi"}],
                                max_tokens=1, timeout=5.0, allow_empty=True)
    return {"method": "chat", "reply": text[:60] or f"模型 {model} 可用"}


def build_messages(role: Agent_roles, requirement: str, observed: List[Dict[str, str]],
                   history: Optional[List[str]] = None, previous: str = "") -> List[Dict[str, str]]:
    context = "\n\n".join(f"【{m['sender']} 发布的 {m['msg_type']}】\n{m['content']}" for m in observed)
    system = f"你是 {role.name}，角色：{role.profile}。目标：{role.goal}\n{role.system_prompt}"
    parts = [f"原始需求：{requirement}"]
    if history and len(history) > 1:
        parts.append("用户对话历史（按时间顺序，最后一条是本轮迭代要求）：\n"
                     + "\n".join(f"{i + 1}. {h}" for i, h in enumerate(history)))
    if previous:
        parts.append("你上一版的完整产出如下。请在其基础上按本轮要求增量修改，并输出修改后的完整版本"
                     "（保持同样的输出格式，不要只输出差异）：\n" + previous)
    parts.append(f"你从消息池订阅到的本轮消息：\n{context or '（无）'}")
    return [{"role": "system", "content": system}, {"role": "user", "content": "\n\n".join(parts)}]


LOCAL_REF_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"'#?]+)["']""", re.I)


def _close_html(html: str) -> str:
    """Best-effort close of a truncated HTML document so the preview never renders blank."""
    low = html.lower()
    if "</html>" in low:
        return html
    tail = ""
    if low.count("<script") > low.count("</script>"):
        tail += "\n</script>"
    if low.count("<style") > low.count("</style>"):
        tail += "\n</style>"
    if "<body" in low and "</body>" not in low:
        tail += "\n</body>"
    return html + tail + "\n</html>"


def ensure_entry(files: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Guarantee an index.html entry: rename a lone html file or assemble one from css/js."""
    if not files:
        return files
    paths = [f["path"] for f in files]
    htmls = [f for f in files if f["path"].lower().endswith((".html", ".htm"))]
    if not any(p.lower().endswith("index.html") for p in paths):
        if htmls:
            htmls[0]["path"] = "index.html"
        else:
            css = "\n".join(f'<link rel="stylesheet" href="{f["path"]}">' for f in files if f["path"].endswith(".css"))
            js = "\n".join(f'<script src="{f["path"]}"></script>' for f in files if f["path"].endswith(".js"))
            if css or js:
                files.append({"kind": "code", "path": "index.html", "content":
                              f"<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">{css}</head>\n<body>\n{js}\n</body></html>"})
    for f in files:
        if f["path"].lower().endswith((".html", ".htm")):
            f["content"] = _close_html(f["content"])
    return files


def check_preview(files: List[Dict[str, str]]) -> List[str]:
    """Return a list of issues that would break the in-site preview (empty list = OK)."""
    entry = next((f for f in files if f["path"].lower().endswith("index.html")), None)
    if not entry:
        return ["缺少入口文件 index.html"]
    issues = []
    body = entry["content"]
    if len(re.sub(r"\s", "", body)) < 40 and len(files) == 1:
        issues.append("index.html 内容几乎为空")
    names = {f["path"].lstrip("./") for f in files}
    for ref in LOCAL_REF_RE.findall(body):
        if ref.startswith(("http:", "https:", "//", "data:", "mailto:", "javascript:")):
            continue
        if ref.lstrip("./") not in names:
            issues.append(f"引用的本地文件不存在：{ref}")
    low = body.lower()
    if low.count("<script") > low.count("</script>"):
        issues.append("script 标签未闭合（输出可能被截断）")
    return issues


def parse_artifacts(role: Agent_roles, content: str) -> List[Dict[str, str]]:
    if role.artifact_kind == "code":
        return ensure_entry(_parse_code(content))
    return _parse_doc(role, content)


def _parse_code(content: str) -> List[Dict[str, str]]:
    # A truncated reply may leave the last fence unterminated, so close it before matching.
    text = content if content.count("```") % 2 == 0 else content + "\n```"
    files = [{"kind": "code", "path": p.strip().lstrip("./"), "content": c} for p, c in FILE_RE.findall(text)]
    if files:
        return files
    # Fall back to fenced code blocks when the model skips the `### FILE:` markers.
    blocks = [(lang, code) for lang, code in FENCE_RE.findall(text) if code.strip()]
    if blocks:
        return [{"kind": "code", "path": f"file{i + 1}{EXT.get(lang.lower(), '.txt')}", "content": code}
                for i, (lang, code) in enumerate(blocks)]
    # Raw HTML without any fences.
    m = re.search(r"<!DOCTYPE html|<html", content, re.I)
    if m:
        return [{"kind": "code", "path": "index.html", "content": content[m.start():]}]
    # Keep a non-conforming reply downloadable instead of losing it.
    return [{"kind": "code", "path": "output.md", "content": content}]


def _parse_doc(role: Agent_roles, content: str) -> List[Dict[str, str]]:
    if role.artifact_kind == "doc":
        safe = re.sub(r"[^\w\-]+", "_", role.publish_type or role.name)
        return [{"kind": "doc", "path": f"docs/{safe}.md", "content": content}]
    return []


def repair_messages(role: Agent_roles, requirement: str, previous: str, issues: List[str]) -> List[Dict[str, str]]:
    system = f"你是 {role.name}，角色：{role.profile}。\n{role.system_prompt}"
    user = (f"原始需求：{requirement}\n\n你上一次输出的代码无法正常预览，问题如下：\n- " + "\n- ".join(issues)
            + "\n\n请修复这些问题，输出完整、可直接运行的 index.html（保持同样的输出格式，代码更精简以免被截断）。"
            + "\n\n上一次输出：\n" + previous[-12000:])
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def dumps(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)
