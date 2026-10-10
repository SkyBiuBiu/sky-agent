"""Account API for Sky Agent: register, login, session bootstrap, password change.

Sign-in returns the same application JWT the platform issues, so the frontend keeps
using its normal authorization channel and every `/api/v1/*` route stays unchanged.
"""
import logging
import secrets
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.app_accounts import App_accounts
from schemas.auth import UserResponse
from services import accounts as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/sky/accounts", tags=["accounts"])

SESSION_THUNK_TTL = 120.0
_PENDING_SESSIONS: dict = {}


async def current_account(db: AsyncSession, user: UserResponse) -> App_accounts:
    """Resolve the sign-in record behind the current token; every account route needs it."""
    account = await svc.find_by_account_id(db, user.id)
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在，请重新登录")
    return account


def _session(account: App_accounts, remember: bool = False) -> dict:
    token, expires_at = svc.issue_token(account, remember=remember)
    return {"account": svc._account_out(account), "token": token, "expires_at": expires_at}


class ThunkIn(BaseModel):
    token: str
    expires_at: int


class RegisterIn(BaseModel):
    email: str
    password: str
    confirm: Optional[str] = None
    name: Optional[str] = None


class LoginIn(BaseModel):
    identifier: str
    password: str
    remember: bool = False


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str
    confirm: Optional[str] = None


def _purge_pending() -> None:
    now = time.time()
    for key, (_, expires) in list(_PENDING_SESSIONS.items()):
        if expires < now:
            _PENDING_SESSIONS.pop(key, None)


@router.post("/thunk")
async def create_thunk(data: ThunkIn, user: UserResponse = Depends(get_current_user)):
    """Hand the freshly issued session to the app through a short-lived, server-side handoff.

    The authentication redirect carries the token in the URL fragment, so the app cannot read
    it directly; it carries a one-time code instead and exchanges it here.
    """
    _purge_pending()
    code = secrets.token_urlsafe(24)
    _PENDING_SESSIONS[code] = (data.token, time.time() + SESSION_THUNK_TTL)
    logger.info("Session handoff prepared for user_id=%s", user.id)
    return {"ok": True, "expires_in": int(SESSION_THUNK_TTL)}


@router.get("/thunk")
async def exchange_thunk(code: str, db: AsyncSession = Depends(get_db)):
    """Exchange a handoff code for the issued session. No token is generated here."""
    _purge_pending()
    pending = _PENDING_SESSIONS.pop(code, None)
    if not pending or pending[1] < time.time():
        raise HTTPException(status_code=404, detail="会话信息已过期，请重新登录")
    return {"token": pending[0]}


@router.get("/session")
async def read_session(user: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return the signed-in account for the current token."""
    account = await svc.find_by_account_id(db, user.id)
    if not account:
        return {"authenticated": False}
    return {"authenticated": True, "account": svc._account_out(account)}


@router.post("/register")
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db)):
    """Create an account and sign it in immediately."""
    if data.confirm is not None and data.password != data.confirm:
        raise HTTPException(status_code=400, detail="两次输入的密码不一致")
    try:
        account = await svc.register(db, data.email, data.password, data.name or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _session(account, remember=False)


@router.post("/login")
async def login(data: LoginIn, db: AsyncSession = Depends(get_db)):
    try:
        account = await svc.login(db, data.identifier, data.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    return _session(account, remember=data.remember)


@router.post("/demo")
async def demo_login(db: AsyncSession = Depends(get_db)):
    """One-click access to the shared read-only demo account."""
    account = await svc.ensure_demo_account(db)
    return _session(account, remember=False)


@router.post("/change-password")
async def change_password(data: ChangePasswordIn, user: UserResponse = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    account = await current_account(db, user)
    if data.confirm is not None and data.new_password != data.confirm:
        raise HTTPException(status_code=400, detail="两次输入的新密码不一致")
    try:
        await svc.change_password(db, account, data.current_password, data.new_password)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "detail": "密码已更新，请使用新密码登录"}
