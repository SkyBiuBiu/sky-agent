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
    return account


DEMO_PROJECTS = [
    {
        "title": "待办清单网页 demo",
        "requirement": "做一个待办清单网页 demo，支持新增、勾选完成和删除任务。",
        "tokens": 18420,
        "role": "Alex",
        "prd": "# 待办清单网页 PRD\n\n## 目标\n帮助个人用户在浏览器中快速记录与勾选待办事项。\n\n## 功能\n1. 输入框新增任务\n2. 勾选标记完成\n3. 删除单条任务\n4. 已完成 / 未完成数量统计\n\n## 验收\n刷新页面后任务保留在本地。",
        "design": "# 系统设计\n\n## 结构\n单文件 `index.html`，内联 CSS 与 JS。\n\n## 数据\n任务数组保存在 `localStorage`，字段：`id`、`text`、`done`。\n\n## 渲染\n列表按新增顺序渲染，每项包含勾选框、文本与删除按钮。",
        "code": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n<title>待办清单</title>\n<style>\nbody{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#111}\nli{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee}\n.done{text-decoration:line-through;color:#999}\nbutton{margin-left:auto}\n</style>\n</head>\n<body>\n<h1>待办清单</h1>\n<form id=\"f\"><input id=\"t\" placeholder=\"添加任务\" required /><button>添加</button></form>\n<ul id=\"list\"></ul>\n<p id=\"stat\"></p>\n<script>\nconst KEY='sky-todos';\nlet items=JSON.parse(localStorage.getItem(KEY)||'[]');\nfunction save(){localStorage.setItem(KEY,JSON.stringify(items));render();}\nfunction render(){\n  const list=document.getElementById('list');list.innerHTML='';\n  items.forEach(it=>{\n    const li=document.createElement('li');\n    const cb=document.createElement('input');cb.type='checkbox';cb.checked=it.done;\n    cb.onchange=()=>{it.done=cb.checked;save();};\n    const span=document.createElement('span');span.textContent=it.text;if(it.done)span.className='done';\n    const del=document.createElement('button');del.textContent='删除';del.onclick=()=>{items=items.filter(x=>x!==it);save();};\n    li.append(cb,span,del);list.append(li);\n  });\n  const done=items.filter(i=>i.done).length;\n  document.getElementById('stat').textContent=`共 ${items.length} 条，已完成 ${done} 条`;\n}\ndocument.getElementById('f').onsubmit=e=>{e.preventDefault();const t=document.getElementById('t');items.push({id:Date.now(),text:t.value,done:false});t.value='';save();};\nrender();\n</script>\n</body>\n</html>",
        "messages": [
            ("User", "UserRequirement", "做一个待办清单网页 demo，支持新增、勾选完成和删除任务。"),
            ("Emma", "PRD", "已完成 PRD：目标、功能范围与验收标准已确认，包含新增 / 勾选 / 删除 / 统计四项功能。"),
            ("Bob", "SystemDesign", "已完成系统设计：单文件 index.html，任务数据存于 localStorage，列表按新增顺序渲染。"),
            ("Alex", "Code", "已交付 index.html：新增、勾选、删除与统计功能均已实现并通过预览自检。"),
        ],
    },
    {
        "title": "计算器网页 demo（含暗色模式）",
        "requirement": "做一个计算器网页，支持加减乘除，并带一个暗色模式切换按钮。",
        "tokens": 15870,
        "role": "Alex",
        "prd": "# 计算器 PRD\n\n## 功能\n1. 数字与四则运算\n2. 清除与退格\n3. 暗色模式切换并记住选择\n\n## 验收\n连续运算结果正确，刷新后主题保持。",
        "design": "# 系统设计\n\n单文件 `index.html`。运算状态机维护 `current` 与 `previous` 两个值；主题通过 `data-theme` 属性切换，写入 `localStorage`。",
        "code": "<!DOCTYPE html>\n<html lang=\"zh-CN\" data-theme=\"light\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n<title>计算器</title>\n<style>\n:root{--bg:#fff;--fg:#111;--key:#f4f4f5}\n[data-theme=dark]{--bg:#18181b;--fg:#fafafa;--key:#27272a}\nbody{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;display:flex;justify-content:center;padding:48px}\n.grid{display:grid;grid-template-columns:repeat(4,64px);gap:8px}\nbutton{padding:14px;background:var(--key);border:0;border-radius:8px;font-size:16px;cursor:pointer}\n#out{grid-column:span 4;text-align:right;font-size:28px;padding:12px;background:var(--key);border-radius:8px}\n</style>\n</head>\n<body>\n<div class=\"grid\">\n<div id=\"out\">0</div>\n<button data-theme-toggle>暗色模式</button>\n<button data-k=\"C\">C</button><button data-k=\"<-\">←</button><button data-k=\"/\">÷</button>\n<button data-k=\"7\">7</button><button data-k=\"8\">8</button><button data-k=\"9\">9</button><button data-k=\"*\">×</button>\n<button data-k=\"4\">4</button><button data-k=\"5\">5</button><button data-k=\"6\">6</button><button data-k=\"-\">−</button>\n<button data-k=\"1\">1</button><button data-k=\"2\">2</button><button data-k=\"3\">3</button><button data-k=\"+\">+</button>\n<button data-k=\"0\">0</button><button data-k=\".\">.</button><button data-k=\"=\">=</button>\n</div>\n<script>\nlet cur='0',prev=null,op=null;\nconst out=document.getElementById('out');\nconst draw=()=>out.textContent=cur;\nconst apply=()=>{if(prev===null||op===null)return;const a=Number(prev),b=Number(cur);let r=a;if(op==='+')r=a+b;if(op==='-')r=a-b;if(op==='*')r=a*b;if(op==='/')r=b===0?'Error':a/b;cur=String(r);prev=null;op=null;};\ndocument.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{\n  const k=b.dataset.k;\n  if(k==='C'){cur='0';prev=null;op=null;}\n  else if(k==='<-'){cur=cur.length>1?cur.slice(0,-1):'0';}\n  else if(k==='='){apply();}\n  else if('+-*/'.includes(k)){prev=cur;op=k;cur='0';}\n  else{cur=cur==='0'?k:cur+k;}\n  draw();\n});\nconst root=document.documentElement;\nroot.dataset.theme=localStorage.getItem('sky-theme')||'light';\ndocument.querySelector('[data-theme-toggle]').onclick=()=>{\n  root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';\n  localStorage.setItem('sky-theme',root.dataset.theme);\n};\ndraw();\n</script>\n</body>\n</html>",
        "messages": [
            ("User", "UserRequirement", "做一个计算器网页，支持加减乘除，并带一个暗色模式切换按钮。"),
            ("Emma", "PRD", "已完成 PRD：四则运算、清除与退格、暗色模式切换并记住选择。"),
            ("Bob", "SystemDesign", "已完成设计：单文件实现，运算用 current/previous 状态机，主题写入 localStorage。"),
            ("Alex", "Code", "已交付 index.html：四则运算与暗色模式均已实现，预览自检通过。"),
        ],
    },
    {
        "title": "咖啡店落地页（v2 增加营业时间区块）",
        "requirement": "做一个咖啡店落地页，介绍招牌饮品和门店信息；第二轮迭代增加营业时间区块。",
        "tokens": 24360,
        "role": "Alex",
        "prd": "# 咖啡店落地页 PRD\n\n## 首屏\n品牌名、一句话标语与「查看菜单」按钮。\n\n## 区块\n1. 招牌饮品三张卡片\n2. 门店信息（地址、电话）\n3. 营业时间（v2 新增）\n\n## 验收\n移动端单列、桌面端三列自适应。",
        "design": "# 系统设计\n\n单文件 `index.html`，CSS Grid 响应式布局；门店信息使用卡片容器，v2 追加营业时间表格区块并复用相同的间距变量。",
        "code": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n<title>山海咖啡</title>\n<style>\nbody{margin:0;font-family:system-ui,sans-serif;color:#2b2117;background:#fbf7f2}\nheader{padding:72px 24px;text-align:center}\nh1{font-size:40px;margin:0 0 12px}\n.cta{display:inline-block;margin-top:16px;padding:10px 20px;background:#8b5e34;color:#fff;border-radius:999px;text-decoration:none}\nsection{max-width:960px;margin:0 auto;padding:32px 24px}\n.cards{display:grid;gap:16px}\n@media(min-width:720px){.cards{grid-template-columns:repeat(3,1fr)}}\n.card{background:#fff;border:1px solid #eadfd0;border-radius:12px;padding:16px}\ntable{width:100%;border-collapse:collapse}\ntd{padding:8px 0;border-bottom:1px solid #eadfd0}\n</style>\n</head>\n<body>\n<header>\n<h1>山海咖啡</h1>\n<p>手冲与冷萃，只做当季豆子。</p>\n<a class=\"cta\" href=\"#menu\">查看菜单</a>\n</header>\n<section id=\"menu\">\n<h2>招牌饮品</h2>\n<div class=\"cards\">\n<div class=\"card\"><h3>手冲单品</h3><p>每日两支当季豆，现场研磨。</p></div>\n<div class=\"card\"><h3>冷萃咖啡</h3><p>低温萃取 16 小时，口感顺滑。</p></div>\n<div class=\"card\"><h3>燕麦拿铁</h3><p>燕麦奶与浓缩的经典组合。</p></div>\n</div>\n</section>\n<section>\n<h2>门店信息</h2>\n<p>地址：山海路 12 号<br />电话：000-0000-0000</p>\n</section>\n<section>\n<h2>营业时间</h2>\n<table>\n<tr><td>周一至周五</td><td>08:00 – 20:00</td></tr>\n<tr><td>周六</td><td>09:00 – 21:00</td></tr>\n<tr><td>周日</td><td>09:00 – 18:00</td></tr>\n</table>\n</section>\n</body>\n</html>",
        "messages": [
            ("User", "UserRequirement", "做一个咖啡店落地页，介绍招牌饮品和门店信息。"),
            ("Emma", "PRD", "已完成 PRD：首屏标语 + 招牌饮品卡片 + 门店信息，移动端单列。"),
            ("Bob", "SystemDesign", "已完成设计：单文件实现，CSS Grid 响应式，卡片复用统一间距变量。"),
            ("Alex", "Code", "已交付 v1 index.html：首屏、菜单卡片与门店信息完成。"),
            ("User", "UserRequirement", "增加营业时间区块。"),
            ("Alex", "Code", "已交付 v2：新增营业时间表格区块，样式复用既有卡片与间距规范。"),
        ],
    },
]


async def seed_demo_content(db: AsyncSession, account_id: str) -> None:
    """Give the demo account a few finished sessions so visitors see real content."""
    existing = await db.execute(select(Projects.id).where(Projects.user_id == account_id).limit(1))
    if existing.scalars().first():
        return
    for spec in DEMO_PROJECTS:
        project = Projects(
            user_id=account_id,
            title=spec["title"],
            requirement=spec["requirement"],
            status="done",
            total_tokens=spec["tokens"],
            current_version=1,
        )
        db.add(project)
        await db.commit()
        for sender, msg_type, content in spec["messages"]:
            db.add(Pool_messages(user_id=account_id, project_id=project.id, version=1, sender=sender,
                                 msg_type=msg_type, subscribers=",".join(sorted({m[0] for m in spec["messages"]})),
                                 content=content, prompt_tokens=0, completion_tokens=0))
        for kind, path, content in (
            ("doc", "PRD.md", spec["prd"]),
            ("doc", "SystemDesign.md", spec["design"]),
            ("code", "index.html", spec["code"]),
        ):
            db.add(Artifacts(user_id=account_id, project_id=project.id, version=1, kind=kind,
                             path=path, content=content))
        await db.commit()
    logger.info("Seeded %s demo projects for account %s", len(DEMO_PROJECTS), account_id)
