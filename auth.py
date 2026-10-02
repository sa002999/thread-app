"""Local registration, login, and server-side sessions."""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import LoginSession, User
from users import hash_password, normalize_email, verify_password


router = APIRouter(prefix="/api/auth", tags=["auth"])
COOKIE_NAME = "thread_session"
SESSION_DAYS = 7
_DUMMY_PASSWORD_HASH = hash_password("unused-password")


class RegisterInput(BaseModel):
    display_name: str
    email: str
    password: str
    confirm_password: str


class LoginInput(BaseModel):
    email: str
    password: str


def _same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    expected = os.getenv("PUBLIC_ORIGIN") or str(request.base_url).rstrip("/")
    if origin and origin != expected:
        raise HTTPException(status_code=403, detail="請從本站送出請求")


def _session_token(db: Session, user: User, response: Response) -> str:
    token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_hex(32)
    db.add(
        LoginSession(
            user_id=user.id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            csrf_token=csrf_token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
        )
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "1") != "0",
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return csrf_token


def current_account(request: Request, db: Session = Depends(get_db)) -> tuple[User, LoginSession]:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="請先登入")
    row = db.execute(
        select(User, LoginSession)
        .join(LoginSession, LoginSession.user_id == User.id)
        .where(
            LoginSession.token_hash == hashlib.sha256(token.encode()).hexdigest(),
            LoginSession.expires_at > datetime.now(timezone.utc),
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="登入已過期，請重新登入")
    user, login_session = row
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("X-CSRF-Token") != login_session.csrf_token:
            raise HTTPException(status_code=403, detail="請重新整理頁面後再試")
    return user, login_session


def optional_user_id(request: Request, db: Session = Depends(get_db)) -> int | None:
    """Return the session owner for public GET personalization, if signed in."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    return db.scalar(
        select(LoginSession.user_id).where(
            LoginSession.token_hash == hashlib.sha256(token.encode()).hexdigest(),
            LoginSession.expires_at > datetime.now(timezone.utc),
        )
    )


def require_author(user: User, author_id: int) -> None:
    if user.id != author_id:
        raise HTTPException(status_code=403, detail="只能修改自己的內容")


@router.post("/register", status_code=201)
def register(data: RegisterInput, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    _same_origin(request)
    display_name = data.display_name.strip()
    if not 2 <= len(display_name) <= 30:
        raise HTTPException(status_code=422, detail="顯示名稱須為 2–30 個字元")
    if data.password != data.confirm_password:
        raise HTTPException(status_code=422, detail="兩次輸入的密碼不一致")
    try:
        email = normalize_email(data.email)
        password_hash = hash_password(data.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    user = User(email=email, display_name=display_name, password_hash=password_hash)
    db.add(user)
    try:
        db.flush()
        csrf_token = _session_token(db, user, response)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="此 Email 已被使用") from exc
    return {"id": user.id, "display_name": user.display_name, "csrf_token": csrf_token}


@router.post("/login")
def login(data: LoginInput, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    _same_origin(request)
    try:
        email = normalize_email(data.email)
    except ValueError:
        raise HTTPException(status_code=401, detail="Email 或密碼不正確") from None
    user = db.scalar(select(User).where(User.email == email))
    password_matches = verify_password(data.password, user.password_hash if user else _DUMMY_PASSWORD_HASH)
    if user is None or not password_matches:
        raise HTTPException(status_code=401, detail="Email 或密碼不正確")
    csrf_token = _session_token(db, user, response)
    db.commit()
    return {"id": user.id, "display_name": user.display_name, "csrf_token": csrf_token}


@router.get("/me")
def me(response: Response, account: tuple[User, LoginSession] = Depends(current_account)) -> dict:
    user, login_session = account
    response.headers["Cache-Control"] = "no-store"
    return {"id": user.id, "display_name": user.display_name, "csrf_token": login_session.csrf_token}


@router.post("/logout")
def logout(
    response: Response,
    account: tuple[User, LoginSession] = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    _, login_session = account
    db.execute(delete(LoginSession).where(LoginSession.id == login_session.id))
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok"}
