"""Nested comment APIs and pagination."""

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from auth import current_account, optional_user_id, require_author
from database import get_db
from media import ImageInput, replace_images
from models import Comment, CommentLike, Image, Post, User
from storage import cloudfront_url

router = APIRouter(prefix="/api", tags=["comments"])
PAGE_SIZE = 20
REPLY_PAGE_SIZE = 10


class CommentInput(BaseModel):
    body: str = Field(default="", max_length=500)
    images: list[ImageInput] | None = None


def _encode_cursor(row: Comment) -> str:
    raw = f"{row.created_at.isoformat()}|{row.id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, int]:
    try:
        raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode()
        created, comment_id = raw.rsplit("|", 1)
        timestamp = datetime.fromisoformat(created)
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp, int(comment_id)
    except (ValueError, UnicodeError):
        raise HTTPException(status_code=422, detail="分頁游標無效") from None


def _serialize_many(db: Session, comments: list[Comment], post_author_id: int, viewer_id: int | None = None) -> list[dict]:
    if not comments:
        return []
    ids = [comment.id for comment in comments]
    users = {user.id: user for user in db.scalars(select(User).where(User.id.in_({row.author_id for row in comments}))).all()}
    replies = dict(db.execute(
        select(Comment.parent_id, func.count()).where(Comment.parent_id.in_(ids)).group_by(Comment.parent_id)
    ).all())
    likes = dict(db.execute(
        select(CommentLike.comment_id, func.count()).where(CommentLike.comment_id.in_(ids)).group_by(CommentLike.comment_id)
    ).all())
    liked_ids = set(db.scalars(select(CommentLike.comment_id).where(
        CommentLike.comment_id.in_(ids), CommentLike.user_id == viewer_id
    )).all()) if viewer_id is not None else set()
    images: dict[int, list[Image]] = {comment_id: [] for comment_id in ids}
    for image in db.scalars(select(Image).where(Image.comment_id.in_(ids)).order_by(Image.comment_id, Image.position)).all():
        images[image.comment_id].append(image)
    author_replies = set(db.scalars(select(Comment.parent_id).where(
        Comment.parent_id.in_(ids), Comment.author_id == post_author_id, Comment.deleted_at.is_(None)
    )).all())
    return [{
        "id": comment.id,
        "post_id": comment.post_id,
        "parent_id": comment.parent_id,
        "author": {"id": users[comment.author_id].id, "display_name": users[comment.author_id].display_name},
        "body": "此留言已刪除" if comment.deleted_at else (comment.body or ""),
        "deleted": comment.deleted_at is not None,
        "created_at": comment.created_at.isoformat(),
        "updated_at": comment.updated_at.isoformat(),
        "reply_count": replies.get(comment.id, 0),
        "has_author_reply": comment.parent_id is None and comment.id in author_replies,
        "like_count": likes.get(comment.id, 0),
        "liked_by_me": comment.id in liked_ids,
        "images": [] if comment.deleted_at else [
            {"object_key": image.object_key, "position": image.position,
             "content_type": image.content_type, "byte_size": image.byte_size,
             "url": cloudfront_url(image.object_key)} for image in images[comment.id]
        ],
    } for comment in comments]


def _serialize(db: Session, comment: Comment, post_author_id: int, viewer_id: int | None = None) -> dict:
    return _serialize_many(db, [comment], post_author_id, viewer_id)[0]


def _page(db: Session, post: Post, parent_id: int | None, cursor: str | None, viewer_id: int | None = None) -> dict:
    statement = select(Comment).where(Comment.post_id == post.id, Comment.parent_id == parent_id)
    if cursor:
        created, comment_id = _decode_cursor(cursor)
        operator = tuple_(Comment.created_at, Comment.id) < tuple_(created, comment_id) if parent_id is None else tuple_(Comment.created_at, Comment.id) > tuple_(created, comment_id)
        statement = statement.where(operator)
    order = (Comment.created_at.desc(), Comment.id.desc()) if parent_id is None else (Comment.created_at.asc(), Comment.id.asc())
    page_size = PAGE_SIZE if parent_id is None else REPLY_PAGE_SIZE
    rows = db.scalars(statement.order_by(*order).limit(page_size + 1)).all()
    has_more = len(rows) > page_size
    rows = rows[:page_size]
    return {"items": _serialize_many(db, rows, post.author_id, viewer_id),
            "next_cursor": _encode_cursor(rows[-1]) if has_more and rows else None}


@router.get("/posts/{post_id}/comments")
def list_comments(post_id: int, response: Response, cursor: str | None = None, viewer_id: int | None = Depends(optional_user_id), db: Session = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    post = db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="找不到這篇貼文")
    return _page(db, post, None, cursor, viewer_id)


@router.get("/comments/{comment_id}/replies")
def list_replies(comment_id: int, response: Response, cursor: str | None = None, viewer_id: int | None = Depends(optional_user_id), db: Session = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    parent = db.get(Comment, comment_id)
    if not parent:
        raise HTTPException(status_code=404, detail="找不到這則留言")
    return _page(db, db.get(Post, parent.post_id), parent.id, cursor, viewer_id)


def _create(db: Session, post: Post, parent_id: int | None, data: CommentInput, user: User) -> dict:
    body, images = data.body.strip(), data.images or []
    if not body and not images:
        raise HTTPException(status_code=422, detail="留言內容不可為空")
    comment = Comment(post_id=post.id, parent_id=parent_id, author_id=user.id, body=body)
    db.add(comment)
    db.flush()
    replace_images(db, "comment_id", comment.id, images, user.id)
    db.commit()
    db.refresh(comment)
    return _serialize(db, comment, post.author_id, user.id)


@router.post("/posts/{post_id}/comments", status_code=201)
def create_comment(post_id: int, data: CommentInput, account: tuple[User, object] = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    post = db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="找不到這篇貼文")
    return _create(db, post, None, data, account[0])


@router.post("/comments/{comment_id}/replies", status_code=201)
def create_reply(comment_id: int, data: CommentInput, account: tuple[User, object] = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    parent = db.get(Comment, comment_id)
    if not parent:
        raise HTTPException(status_code=404, detail="找不到這則留言")
    post = db.get(Post, parent.post_id)
    return _create(db, post, parent.id, data, account[0])


@router.put("/comments/{comment_id}")
def update_comment(comment_id: int, data: CommentInput, account: tuple[User, object] = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    comment = db.get(Comment, comment_id)
    if not comment or comment.deleted_at:
        raise HTTPException(status_code=404, detail="找不到這則留言")
    require_author(account[0], comment.author_id)
    body = data.body.strip()
    images = data.images
    if images is None:
        images = [ImageInput(object_key=row.object_key, content_type=row.content_type, byte_size=row.byte_size)
                  for row in db.scalars(select(Image).where(Image.comment_id == comment.id).order_by(Image.position)).all()]
    if not body and not images:
        raise HTTPException(status_code=422, detail="留言內容不可為空")
    comment.body = body
    comment.updated_at = datetime.now(timezone.utc)
    replace_images(db, "comment_id", comment.id, images, account[0].id)
    db.commit()
    db.refresh(comment)
    return _serialize(db, comment, db.get(Post, comment.post_id).author_id, account[0].id)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, account: tuple[User, object] = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    comment = db.get(Comment, comment_id)
    if not comment or comment.deleted_at:
        raise HTTPException(status_code=404, detail="找不到這則留言")
    require_author(account[0], comment.author_id)
    comment.deleted_at = datetime.now(timezone.utc)
    comment.body = None
    comment.updated_at = comment.deleted_at
    db.commit()
    return {"id": comment.id, "deleted": True}


@router.post("/comments/{comment_id}/like")
def toggle_comment_like(
    comment_id: int,
    account: tuple[User, object] = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    comment = db.scalar(select(Comment).where(Comment.id == comment_id).with_for_update())
    if not comment or comment.deleted_at:
        raise HTTPException(status_code=404, detail="找不到這則留言")
    user_id = account[0].id
    like = db.get(CommentLike, (comment_id, user_id))
    if like:
        db.delete(like)
        liked = False
    else:
        db.add(CommentLike(comment_id=comment_id, user_id=user_id))
        liked = True
    db.flush()
    count = db.scalar(select(func.count()).select_from(CommentLike).where(CommentLike.comment_id == comment_id)) or 0
    db.commit()
    return {"id": comment_id, "like_count": count, "liked": liked}
