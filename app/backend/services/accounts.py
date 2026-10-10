import json
"""Email/password accounts for Sky Agent.

Signs the same application JWT the platform issues, so every existing `/api/v1/*`
endpoint keeps working unchanged while Sky Agent owns its own sign-up, sign-in and
password-change flows. Also seeds the shared read-only demo account.
"""
import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_access_token
from core.config import settings
from models.app_accounts import App_accounts
from models.artifacts import Artifacts
from models.run_plans import Run_plans
from models.pool_messages import Pool_messages
from models.projects import Projects

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
PASSWORD_ITERATIONS = 120_000

DEMO_ACCOUNT_ID = "sky-demo-account"
DEMO_EMAIL = "demo@sky-agent.local"
DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo123"
DEMO_NAME = "演示账号"

REMEMBER_DAYS = 30
DEFAULT_SESSION_MINUTES = 720


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """Hash a password with PBKDF2-SHA256. Format: pbkdf2_sha256$iterations$salt$digest."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, digest = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations))
        return secrets.compare_digest(candidate.hex(), digest)
    except (ValueError, AttributeError):
        return False


def email_issue(email: str) -> Optional[str]:
    """Return a user-facing problem description, or None when the email looks valid."""
    email = (email or "").strip()
    if not email:
        return "请填写邮箱"
    if not EMAIL_RE.match(email):
        return "邮箱格式不正确，请检查后重试"
    return None


def password_issue(password: str) -> Optional[str]:
    """Return a user-facing weakness description, or None when the password is acceptable."""
    if not password:
        return "请填写密码"
    if len(password) < 6:
        return "密码至少 6 位"
    if password.isdigit() or password.isalpha():
        return "密码需同时包含字母和数字"
    return None


def _account_out(account: App_accounts) -> dict:
    return {
        "id": account.account_id,
        "email": account.email,
        "name": account.name,
        "role": "user",
        "is_demo": bool(account.is_demo),
    }


def issue_token(account: App_accounts, remember: bool = False) -> Tuple[str, int]:
    """Issue an application JWT compatible with the platform token format."""
    minutes = REMEMBER_DAYS * 24 * 60 if remember else DEFAULT_SESSION_MINUTES
    now = datetime.now(timezone.utc)
    claims = {
        "sub": account.account_id,
        "email": account.email,
        "name": account.name,
        "role": "user",
        "is_demo": bool(account.is_demo),
        "last_login": now.isoformat(),
    }
    token = create_access_token(claims, expires_minutes=minutes)
    return token, int((now + timedelta(minutes=minutes)).timestamp())


async def find_by_account_id(db: AsyncSession, account_id: str) -> Optional[App_accounts]:
    if not account_id:
        return None
    return (await db.execute(select(App_accounts).where(App_accounts.account_id == account_id))).scalars().first()


async def find_by_identifier(db: AsyncSession, identifier: str) -> Optional[App_accounts]:
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    statement = select(App_accounts).where((App_accounts.email == identifier) | (App_accounts.username == identifier))
    if identifier.lower() == DEMO_USERNAME:
        statement = select(App_accounts).where(App_accounts.account_id == DEMO_ACCOUNT_ID)
    return (await db.execute(statement)).scalars().first()


async def register(db: AsyncSession, email: str, password: str, name: str = "") -> App_accounts:
    """Create a new account. Raises ValueError with a user-facing message on invalid input."""
    email = (email or "").strip().lower()
    problem = email_issue(email) or password_issue(password)
    if problem:
        raise ValueError(problem)
    if await find_by_identifier(db, email):
        raise ValueError("该邮箱已注册，请直接登录")
    account = App_accounts(
        account_id=f"sky-{secrets.token_hex(12)}",
        email=email,
        username=email.split("@", 1)[0],
        password_hash=hash_password(password),
        name=(name or "").strip() or email.split("@", 1)[0],
        is_demo=False,
    )
    db.add(account)
    await db.commit()
    from services.sky import seed_default_roles
    await seed_default_roles(db, account.account_id)
    return account


async def login(db: AsyncSession, identifier: str, password: str) -> App_accounts:
    account = await find_by_identifier(db, identifier)
    if not account or not verify_password(password, account.password_hash):
        raise ValueError("账号或密码不正确")
    return account


async def change_password(db: AsyncSession, account: App_accounts, current_password: str, new_password: str) -> None:
    if account.is_demo:
        raise PermissionError("演示账号为只读账号，不支持修改密码")
    if not verify_password(current_password, account.password_hash):
        raise ValueError("当前密码不正确")
    problem = password_issue(new_password)
    if problem:
        raise ValueError(problem)
    if current_password == new_password:
        raise ValueError("新密码不能与当前密码相同")
    account.password_hash = hash_password(new_password)
    await db.commit()


async def ensure_demo_account(db: AsyncSession) -> App_accounts:
    """Make sure the shared demo account exists, and that it has sample content."""
    account = await find_by_identifier(db, DEMO_USERNAME)
    if not account:
        account = App_accounts(
            account_id=DEMO_ACCOUNT_ID,
            email=DEMO_EMAIL,
            username=DEMO_USERNAME,
            password_hash=hash_password(DEMO_PASSWORD),
            name=DEMO_NAME,
            is_demo=True,
        )
        db.add(account)
        await db.commit()
    elif not account.is_demo or not verify_password(DEMO_PASSWORD, account.password_hash):
        account.is_demo = True
        account.password_hash = hash_password(DEMO_PASSWORD)
        await db.commit()
    await seed_demo_content(db, account.account_id)
    from services.sky import seed_default_roles
    await seed_default_roles(db, account.account_id)
    return account


DEMO_PROJECTS = [
    {
        "title": "待办清单 Demo",
        "requirement": "做一个简洁的待办清单网页",
        "tokens": 9600,
        "prd": '# 待办清单 PRD\n\n## 目标\n在浏览器里快速记录待办事项。\n\n## 功能（P0）\n1. 添加任务\n2. 勾选完成\n3. 删除任务\n\n## 验收\n刷新页面后任务仍在。',
        "design": '# 系统设计\n\n- 单文件 `index.html`，内联 CSS 与 JS\n- 数据：任务数组 `{text, done}`，存于 `localStorage`\n- 每次变更后整体重新渲染列表',
        "code": '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n<title>待办清单</title>\n<style>\nbody{font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#111}\nform{display:flex;gap:8px}input[type=text]{flex:1;padding:8px}\nli{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee}\n.done{text-decoration:line-through;color:#999}li button{margin-left:auto}\n</style>\n</head>\n<body>\n<h1>待办清单</h1>\n<form id="f"><input id="t" type="text" placeholder="添加任务" required /><button>添加</button></form>\n<ul id="list"></ul>\n<script>\nconst list=document.getElementById(\'list\');\nlet items=JSON.parse(localStorage.getItem(\'todos\')||\'[]\');\nfunction render(){\n  localStorage.setItem(\'todos\',JSON.stringify(items));\n  list.innerHTML=\'\';\n  items.forEach((it,i)=>{\n    const li=document.createElement(\'li\');\n    li.innerHTML=\'<input type="checkbox"\'+(it.done?\' checked\':\'\')+\'><span\'+(it.done?\' class="done"\':\'\')+\'></span><button>删除</button>\';\n    li.querySelector(\'span\').textContent=it.text;\n    li.querySelector(\'input\').onchange=()=>{it.done=!it.done;render();};\n    li.querySelector(\'button\').onclick=()=>{items.splice(i,1);render();};\n    list.append(li);\n  });\n}\ndocument.getElementById(\'f\').onsubmit=e=>{e.preventDefault();const t=document.getElementById(\'t\');items.push({text:t.value,done:false});t.value=\'\';render();};\nrender();\n</script>\n</body>\n</html>',
        "qa": '# 测试报告\n\n**结论：通过**\n\n| 编号 | 场景 | 预期 | 结果 |\n|---|---|---|---|\n| 1 | 输入文字点添加 | 列表新增一项 | 通过 |\n| 2 | 勾选任务 | 文字划线 | 通过 |\n| 3 | 点删除 | 该项移除 | 通过 |\n| 4 | 刷新页面 | 任务保留 | 通过 |\n\n## 问题清单\n- 低：空格内容也能添加。\n\n## 修复建议\n- 提交时用 `t.value.trim()` 判断，为空则忽略。',
    },
]


async def seed_demo_content(db: AsyncSession, account_id: str) -> None:
    """Give the demo account one finished sample session so visitors see real content."""
    existing = await db.execute(select(Projects.id).where(Projects.user_id == account_id).limit(1))
    if existing.scalars().first():
        return
    from services.sky import seed_default_roles, own_roles
    await seed_default_roles(db, account_id)
    roles = await own_roles(db, account_id)
    for spec in DEMO_PROJECTS:
        project = Projects(user_id=account_id, title=spec["title"], requirement=spec["requirement"],
                           status="done", total_tokens=spec["tokens"], current_version=1)
        db.add(project)
        await db.commit()
        outputs = {
            "PRD": ("已完成 PRD：添加、勾选完成、删除三项核心功能，刷新后数据保留。", "doc", "docs/PRD.md", spec["prd"]),
            "SystemDesign": ("已完成设计：单文件 index.html，任务存于 localStorage，变更后重新渲染。", "doc", "docs/SystemDesign.md", spec["design"]),
            "Code": ("已交付 index.html：支持添加、勾选完成和删除，预览自检通过。", "code", "index.html", spec["code"]),
            "TestReport": (spec["qa"], "doc", "docs/TestReport.md", spec["qa"]),
        }
        def subs(t: str) -> str:
            return ",".join(r.name for r in roles if t in [x.strip() for x in r.subscribe_types.split(",")])
        db.add(Pool_messages(user_id=account_id, project_id=project.id, version=1, sender="User",
                             msg_type="UserRequirement", subscribers=subs("UserRequirement"),
                             content=spec["requirement"], prompt_tokens=0, completion_tokens=0))
        plan = []
        for r in roles:
            if r.publish_type not in outputs:
                continue
            msg, kind, path, content = outputs[r.publish_type]
            plan.append({"id": r.id, "name": r.name, "profile": r.profile})
            db.add(Pool_messages(user_id=account_id, project_id=project.id, version=1, sender=r.name,
                                 msg_type=r.publish_type, subscribers=subs(r.publish_type),
                                 content=content if kind == "doc" else msg, prompt_tokens=0, completion_tokens=0))
            db.add(Artifacts(user_id=account_id, project_id=project.id, version=1, kind=kind, path=path, content=content))
        db.add(Run_plans(project_id=project.id, version=1, plan=json.dumps(plan, ensure_ascii=False)))
        await db.commit()
    logger.info("Seeded %s demo projects for account %s", len(DEMO_PROJECTS), account_id)
