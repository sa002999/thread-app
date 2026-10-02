"""Post creation, browsing, editing, and soft deletion."""

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from auth import current_account, optional_user_id, require_author
from database import get_db
from media import ImageInput, replace_images
from models import Comment, Image, Post, PostLike, User
from storage import cloudfront_url


router = APIRouter(prefix="/api/posts", tags=["posts"])
PAGE_SIZE = 10


class PostInput(BaseModel):
    body: str = Field(default="", max_length=500)
    images: list[ImageInput] | None = None


def _cursor(post: Post) -> str:
    value = f"{post.created_at.isoformat()}|{post.id}".encode()
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, int]:
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode()
        created_at, post_id = decoded.rsplit("|", 1)
        timestamp = datetime.fromisoformat(created_at)
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp, int(post_id)
    except (ValueError, UnicodeError):
        raise HTTPException(status_code=422, detail="分頁游標無效") from None


def _serialize_many(db: Session, posts: list[Post], viewer_id: int | None = None) -> list[dict]:
    if not posts:
        return []
    ids = [post.id for post in posts]
    users = {user.id: user for user in db.scalars(select(User).where(User.id.in_({post.author_id for post in posts}))).all()}
    replies = dict(db.execute(
        select(Comment.post_id, func.count()).where(Comment.post_id.in_(ids), Comment.parent_id.is_(None)).group_by(Comment.post_id)
    ).all())
    likes = dict(db.execute(
        select(PostLike.post_id, func.count()).where(PostLike.post_id.in_(ids)).group_by(PostLike.post_id)
    ).all())
    liked_ids = set(db.scalars(select(PostLike.post_id).where(
        PostLike.post_id.in_(ids), PostLike.user_id == viewer_id
    )).all()) if viewer_id is not None else set()
    images: dict[int, list[Image]] = {post_id: [] for post_id in ids}
    for image in db.scalars(select(Image).where(Image.post_id.in_(ids)).order_by(Image.post_id, Image.position)).all():
        images[image.post_id].append(image)
    return [{
        "id": post.id,
        "author": {"id": users[post.author_id].id, "display_name": users[post.author_id].display_name},
        "body": "此貼文已刪除" if post.deleted_at else post.body,
        "deleted": post.deleted_at is not None,
        "created_at": post.created_at.isoformat(),
        "updated_at": post.updated_at.isoformat(),
        "reply_count": replies.get(post.id, 0),
        "like_count": likes.get(post.id, 0),
        "liked_by_me": post.id in liked_ids,
        "images": [] if post.deleted_at else [
            {"object_key": image.object_key, "position": image.position, "content_type": image.content_type,
             "byte_size": image.byte_size, "url": cloudfront_url(image.object_key)}
            for image in images[post.id]
        ],
    } for post in posts]


def _serialize(db: Session, post: Post, viewer_id: int | None = None) -> dict:
    return _serialize_many(db, [post], viewer_id)[0]


@router.get("")
def list_posts(
    response: Response,
    cursor: str | None = None,
    viewer_id: int | None = Depends(optional_user_id),
    db: Session = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    # Public browsing does not require a session; viewer personalization is added by optional cookie lookup later.
    statement = select(Post).where(Post.deleted_at.is_(None))
    if cursor:
        created_at, post_id = _decode_cursor(cursor)
        statement = statement.where(tuple_(Post.created_at, Post.id) < tuple_(created_at, post_id))
    rows = db.scalars(statement.order_by(Post.created_at.desc(), Post.id.desc()).limit(PAGE_SIZE + 1)).all()
    has_more = len(rows) > PAGE_SIZE
    rows = rows[:PAGE_SIZE]
    return {"items": _serialize_many(db, rows, viewer_id), "next_cursor": _cursor(rows[-1]) if has_more and rows else None}


@router.post("", status_code=201)
def create_post(
    data: PostInput,
    account: tuple[User, object] = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    body = data.body.strip()
    images = data.images or []
    if not body and not images:
        raise HTTPException(status_code=422, detail="貼文內容不可為空")
    post = Post(author_id=account[0].id, body=body)
    db.add(post)
    db.flush()
    replace_images(db, "post_id", post.id, images, account[0].id)
    db.commit()
    db.refresh(post)
    return _serialize(db, post, account[0].id)


@router.get("/{post_id}")
def get_post(
    post_id: int,
    response: Response,
    viewer_id: int | None = Depends(optional_user_id),
    db: Session = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    post = db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="找不到這篇貼文")
    return _serialize(db, post, viewer_id)


@router.put("/{post_id}")
def update_post(
    post_id: int,
    data: PostInput,
    account: tuple[User, object] = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    post = db.get(Post, post_id)
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="找不到這篇貼文")
    require_author(account[0], post.author_id)
    body = data.body.strip()
    images = data.images
    if images is None:
        images = [ImageInput(object_key=row.object_key, content_type=row.content_type, byte_size=row.byte_size)
                  for row in db.scalars(select(Image).where(Image.post_id == post.id).order_by(Image.position)).all()]
    if not body and not images:
        raise HTTPException(status_code=422, detail="貼文內容不可為空")
    post.body = body
    post.updated_at = datetime.now(timezone.utc)
    replace_images(db, "post_id", post.id, images, account[0].id)
    db.commit()
    db.refresh(post)
    return _serialize(db, post, account[0].id)


@router.delete("/{post_id}")
def delete_post(
    post_id: int,
    account: tuple[User, object] = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    post = db.get(Post, post_id)
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="找不到這篇貼文")
    require_author(account[0], post.author_id)
    post.deleted_at = datetime.now(timezone.utc)
    post.body = None
    post.updated_at = post.deleted_at
    db.commit()
    return {"id": post.id, "deleted": True}


@router.post("/{post_id}/like")
def toggle_post_like(
    post_id: int,
    account: tuple[User, object] = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    post = db.scalar(select(Post).where(Post.id == post_id).with_for_update())
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="找不到這篇貼文")
    user_id = account[0].id
    like = db.get(PostLike, (post_id, user_id))
    if like:
        db.delete(like)
        liked = False
    else:
        db.add(PostLike(post_id=post_id, user_id=user_id))
        liked = True
    db.flush()
    count = db.scalar(select(func.count()).select_from(PostLike).where(PostLike.post_id == post_id)) or 0
    db.commit()
    return {"id": post_id, "like_count": count, "liked": liked}
