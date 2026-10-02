"""PostgreSQL data model for local accounts, content, images, and likes."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="ck_users_email_lowercase"),
        CheckConstraint("char_length(btrim(display_name)) BETWEEN 2 AND 30", name="ck_users_display_name_length"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    display_name: Mapped[str] = mapped_column(String(30), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LoginSession(Base):
    __tablename__ = "login_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (
        CheckConstraint("body IS NULL OR char_length(body) <= 500", name="ck_posts_body_length"),
        Index("ix_posts_created_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    body: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        UniqueConstraint("id", "post_id", name="uq_comments_id_post"),
        ForeignKeyConstraint(
            ["parent_id", "post_id"],
            ["comments.id", "comments.post_id"],
            ondelete="RESTRICT",
            name="fk_comments_parent_same_post",
        ),
        CheckConstraint("body IS NULL OR char_length(body) <= 500", name="ck_comments_body_length"),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="ck_comments_not_self_parent"),
        Index("ix_comments_post_parent_created_id", "post_id", "parent_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="RESTRICT"))
    parent_id: Mapped[int | None] = mapped_column(BigInteger)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    body: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Image(Base):
    __tablename__ = "images"
    __table_args__ = (
        CheckConstraint("(post_id IS NULL) <> (comment_id IS NULL)", name="ck_images_one_owner"),
        CheckConstraint("position BETWEEN 0 AND 2", name="ck_images_position"),
        CheckConstraint("byte_size > 0 AND byte_size <= 5000000", name="ck_images_byte_size"),
        CheckConstraint("content_type IN ('image/jpeg', 'image/png', 'image/webp')", name="ck_images_type"),
        UniqueConstraint("post_id", "position", name="uq_images_post_position"),
        UniqueConstraint("comment_id", "position", name="uq_images_comment_position"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    post_id: Mapped[int | None] = mapped_column(ForeignKey("posts.id", ondelete="RESTRICT"))
    comment_id: Mapped[int | None] = mapped_column(ForeignKey("comments.id", ondelete="RESTRICT"))
    object_key: Mapped[str] = mapped_column(String(1024), unique=True)
    position: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str] = mapped_column(String(32))
    byte_size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PostLike(Base):
    __tablename__ = "post_likes"

    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="RESTRICT"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CommentLike(Base):
    __tablename__ = "comment_likes"

    comment_id: Mapped[int] = mapped_column(ForeignKey("comments.id", ondelete="RESTRICT"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
