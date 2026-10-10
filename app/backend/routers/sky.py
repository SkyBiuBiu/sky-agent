"""Sky Agent API: LLM config, persistent sessions, SOP steps, iteration and cancellation."""
import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from models.llm_configs import Llm_configs
from models.projects import Projects
from models.pool_messages import Pool_messages
from models.artifacts import Artifacts
from services import sky

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/sky", tags=["sky"])

STEP_TIMEOUT = 85.0  # stays below the ~100s gateway limit
POLL_INTERVAL = 1.5


class ConfigIn(BaseModel):
    base_url: str
    model: str
    api_key: Optional[str] = None


class ProjectIn(BaseModel):
    requirement: str


class StepIn(BaseModel):
    role_id: Optional[int] = None
    step: Optional[int] = None  # index in the enabled SOP; fallback when role_id is stale


class FinishIn(BaseModel):
    status: str


def _config_out(cfg: Optional[Llm_configs]):
    if not cfg:
        return {"configured": False, "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini", "masked_key": ""}
    return {"configured": True, "base_url": cfg.base_url, "model": cfg.model, "masked_key": sky.mask_key(cfg.api_key)}


async def _own_project(db: AsyncSession, project_id: int, user_id: str) -> Projects:
    project = await db.get(Projects, project_id)
    if not project or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="会话不存在")
    return project


async def _plan(db: AsyncSession, user_id: str) -> List[Dict[str, Any]]:
    roles = [r for r in await sky.ensure_roles(db, user_id) if r.enabled]
    if not roles:
        raise HTTPException(status_code=400, detail="没有启用的 Agent 角色")
    return [{"id": r.id, "name": r.name, "profile": r.profile} for r in roles]


async def _post_user_message(db: AsyncSession, user_id: str, project: Projects, content: str) -> None:
    roles = await sky.ensure_roles(db, user_id)
    subs = [r.name for r in roles if r.enabled and "UserRequirement" in sky.split_types(r.subscribe_types)]
    db.add(Pool_messages(user_id=user_id, project_id=project.id, version=project.current_version or 1,
                         sender="User", msg_type="UserRequirement", subscribers=",".join(subs),
                         content=content, prompt_tokens=0, completion_tokens=0))


@router.get("/config")
async def get_config(user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return _config_out(await sky.get_config(db, user.id))


@router.post("/config")
async def save_config(data: ConfigIn, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cfg = await sky.get_config(db, user.id)
    key = (data.api_key or "").strip()
    if not cfg and not key:
        raise HTTPException(status_code=400, detail="请填写 API Key")
    if cfg:
        cfg.base_url, cfg.model = data.base_url.strip(), data.model.strip()
        if key:
            cfg.api_key = key
    else:
        cfg = Llm_configs(user_id=user.id, base_url=data.base_url.strip(), model=data.model.strip(), api_key=key)
        db.add(cfg)
    await db.commit()
    return _config_out(cfg)


@router.post("/config/test")
async def test_config(data: ConfigIn, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    key = (data.api_key or "").strip()
    if not key:
        cfg = await sky.get_config(db, user.id)
        key = cfg.api_key if cfg else ""
    await db.commit()  # close the DB phase before the external call
    if not key:
        raise HTTPException(status_code=400, detail="尚未保存 API Key：请在输入框填写 Key 后再测试，或先点「保存」")
    started = time.monotonic()
    try:
        result = await asyncio.wait_for(sky.probe_llm(data.base_url, data.model, key), timeout=12.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="连通性测试超时（12 秒），请检查 Base URL 或稍后重试")
    return {"ok": True, **result, "elapsed_ms": int((time.monotonic() - started) * 1000)}


@router.get("/roles/init")
async def init_roles(user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    roles = await sky.ensure_roles(db, user.id)
    return {"count": len(roles)}


@router.post("/projects")
async def create_project(data: ProjectIn, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    req = data.requirement.strip()
    if not req:
        raise HTTPException(status_code=400, detail="需求不能为空")
    if not await sky.get_config(db, user.id):
        raise HTTPException(status_code=400, detail="请先在「模型配置」中填写 API Key")
    plan = await _plan(db, user.id)
    project = Projects(user_id=user.id, title=req[:40], requirement=req, status="running",
                       total_tokens=0, current_version=1)
    db.add(project)
    await db.commit()
    await _post_user_message(db, user.id, project, req)
    await db.commit()
    return {"project_id": project.id, "version": 1, "plan": plan}


@router.post("/projects/{project_id}/iterate")
async def iterate(project_id: int, data: ProjectIn, user: UserResponse = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    """Continue a saved session: open a new version that builds on the latest artifacts."""
    content = data.requirement.strip()
    if not content:
        raise HTTPException(status_code=400, detail="消息不能为空")
    project = await _own_project(db, project_id, user.id)
    plan = await _plan(db, user.id)
    project.current_version = (project.current_version or 1) + 1
    project.status = "running"
    await _post_user_message(db, user.id, project, content)
    version = project.current_version
    await db.commit()
    return {"project_id": project_id, "version": version, "plan": plan}


async def _status(db: AsyncSession, project_id: int) -> str:
    res = await db.execute(select(Projects.status).where(Projects.id == project_id))
    status = res.scalar_one_or_none() or ""
    await db.commit()
    return status


async def _run_cancellable(db: AsyncSession, project_id: int, coro):
    """Run the LLM call while polling the session status; cancel the upstream request on interrupt."""
    task = asyncio.create_task(coro)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=POLL_INTERVAL)
            if done:
                return task.result()
            if await _status(db, project_id) == "interrupted":
                task.cancel()
                raise HTTPException(status_code=409, detail="任务已中断")
    finally:
        if not task.done():
            task.cancel()


@router.post("/projects/{project_id}/step")
async def run_step(project_id: int, data: StepIn, user: UserResponse = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    project = await _own_project(db, project_id, user.id)
    if project.status == "interrupted":
        raise HTTPException(status_code=409, detail="任务已中断")
    version = project.current_version or 1
    roles = await sky.ensure_roles(db, user.id)
    enabled = [r for r in roles if r.enabled]
    role = next((r for r in enabled if r.id == data.role_id), None)
    if not role and data.step is not None and 0 <= data.step < len(enabled):
        role = enabled[data.step]
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在或已停用，请刷新页面后重试")
    cfg = await sky.get_config(db, user.id)
    if not cfg:
        raise HTTPException(status_code=400, detail="请先配置模型")
    watch = set(sky.split_types(role.subscribe_types))
    res = await db.execute(select(Pool_messages).where(Pool_messages.project_id == project_id).order_by(Pool_messages.id))
    all_msgs = list(res.scalars().all())
    current = [m for m in all_msgs if (m.version or 1) == version]
    observed = [{"sender": m.sender, "msg_type": m.msg_type, "content": m.content}
                for m in current if m.msg_type in watch]
    history = [m.content for m in all_msgs if m.sender == "User"]
    previous = next((m.content for m in reversed(all_msgs)
                     if (m.version or 1) < version and m.sender == role.name and m.msg_type == role.publish_type), "")
    messages = sky.build_messages(role, project.requirement, observed, history=history, previous=previous)
    base_url, model, key = cfg.base_url, cfg.model, cfg.api_key
    role_name, publish_type = role.name, role.publish_type
    subs = [r.name for r in roles if r.enabled and r.id != role.id and publish_type in sky.split_types(r.subscribe_types)]
    max_out = 6000 if role.artifact_kind == "code" else 3500
    await db.commit()

    content, pt, ct = await _run_cancellable(
        db, project_id, sky.call_llm(base_url, model, key, messages, max_tokens=max_out, timeout=STEP_TIMEOUT))

    project = await db.get(Projects, project_id)
    if project.status == "interrupted":
        await db.commit()
        raise HTTPException(status_code=409, detail="任务已中断")
    arts = sky.parse_artifacts(role, content)
    issues = sky.check_preview(arts) if role.artifact_kind == "code" else []
    msg = Pool_messages(user_id=user.id, project_id=project_id, version=version, sender=role_name,
                        msg_type=publish_type, subscribers=",".join(subs), content=content,
                        prompt_tokens=pt, completion_tokens=ct)
    db.add(msg)
    for a in arts:
        db.add(Artifacts(user_id=user.id, project_id=project_id, version=version, **a))
    project.total_tokens = (project.total_tokens or 0) + pt + ct
    await db.commit()
    return {
        "message": {"id": msg.id, "version": version, "sender": role_name, "msg_type": publish_type,
                    "subscribers": msg.subscribers, "content": content, "prompt_tokens": pt, "completion_tokens": ct},
        "artifact_count": len(arts),
        "total_tokens": project.total_tokens,
        "preview_issues": issues,
    }


@router.post("/projects/{project_id}/repair")
async def repair(project_id: int, data: StepIn, user: UserResponse = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    """Ask the code role once to fix preview issues of the current version; replaces its code artifacts."""
    project = await _own_project(db, project_id, user.id)
    if project.status == "interrupted":
        raise HTTPException(status_code=409, detail="任务已中断")
    version = project.current_version or 1
    roles = await sky.ensure_roles(db, user.id)
    role = next((r for r in roles if r.id == data.role_id and r.artifact_kind == "code"), None)
    if not role:
        raise HTTPException(status_code=404, detail="工程师角色不存在")
    cfg = await sky.get_config(db, user.id)
    res = await db.execute(select(Pool_messages).where(
        Pool_messages.project_id == project_id, Pool_messages.sender == role.name,
        Pool_messages.msg_type == role.publish_type).order_by(Pool_messages.id.desc()))
    last = res.scalars().first()
    if not cfg or not last or (last.version or 1) != version:
        raise HTTPException(status_code=400, detail="没有可修复的代码产物")
    issues = sky.check_preview(sky.parse_artifacts(role, last.content))
    if not issues:
        await db.commit()
        return {"fixed": True, "preview_issues": []}
    messages = sky.repair_messages(role, project.requirement, last.content, issues)
    base_url, model, key, role_name, last_id = cfg.base_url, cfg.model, cfg.api_key, role.name, last.id
    await db.commit()

    content, pt, ct = await _run_cancellable(
        db, project_id, sky.call_llm(base_url, model, key, messages, max_tokens=6000, timeout=STEP_TIMEOUT))

    arts = sky.parse_artifacts(role, content)
    new_issues = sky.check_preview(arts)
    if len(new_issues) >= len(issues):
        await db.commit()
        return {"fixed": False, "preview_issues": issues}
    old = await db.execute(select(Artifacts).where(Artifacts.project_id == project_id,
                                                   Artifacts.version == version, Artifacts.kind == "code"))
    for a in old.scalars().all():
        await db.delete(a)
    for a in arts:
        db.add(Artifacts(user_id=user.id, project_id=project_id, version=version, **a))
    msg = await db.get(Pool_messages, last_id)
    msg.content = content
    msg.prompt_tokens = (msg.prompt_tokens or 0) + pt
    msg.completion_tokens = (msg.completion_tokens or 0) + ct
    project = await db.get(Projects, project_id)
    project.total_tokens = (project.total_tokens or 0) + pt + ct
    await db.commit()
    return {"fixed": not new_issues, "preview_issues": new_issues, "sender": role_name}


@router.post("/projects/{project_id}/cancel")
async def cancel(project_id: int, user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await _own_project(db, project_id, user.id)
    project.status = "interrupted"
    await db.commit()
    return {"status": "interrupted"}


@router.post("/projects/{project_id}/finish")
async def finish(project_id: int, data: FinishIn, user: UserResponse = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    project = await _own_project(db, project_id, user.id)
    if project.status != "interrupted":
        project.status = data.status if data.status in ("done", "failed") else "done"
    status = project.status
    await db.commit()
    return {"status": status}
