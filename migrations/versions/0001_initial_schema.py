"""Initial schema for the Thread application.

Revision ID: 0001
Revises:
"""

from alembic import op
import sqlalchemy as sa


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("display_name", sa.String(30), nullable=False),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lowercase"),
        sa.CheckConstraint("char_length(btrim(display_name)) BETWEEN 2 AND 30", name="ck_users_display_name_length"),
    )
    op.create_table(
        "login_sessions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "posts",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("author_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("body", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("body IS NULL OR char_length(body) <= 500", name="ck_posts_body_length"),
    )
    op.create_index("ix_posts_created_id", "posts", ["created_at", "id"])
    op.create_table(
        "comments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("post_id", sa.BigInteger(), sa.ForeignKey("posts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("parent_id", sa.BigInteger()),
        sa.Column("author_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("body", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("id", "post_id", name="uq_comments_id_post"),
        sa.ForeignKeyConstraint(
            ["parent_id", "post_id"],
            ["comments.id", "comments.post_id"],
            ondelete="RESTRICT",
            name="fk_comments_parent_same_post",
        ),
        sa.CheckConstraint("body IS NULL OR char_length(body) <= 500", name="ck_comments_body_length"),
        sa.CheckConstraint("parent_id IS NULL OR parent_id <> id", name="ck_comments_not_self_parent"),
    )
    op.create_index("ix_comments_post_parent_created_id", "comments", ["post_id", "parent_id", "created_at", "id"])
    op.create_table(
        "images",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("post_id", sa.BigInteger(), sa.ForeignKey("posts.id", ondelete="RESTRICT")),
        sa.Column("comment_id", sa.BigInteger(), sa.ForeignKey("comments.id", ondelete="RESTRICT")),
        sa.Column("object_key", sa.String(1024), nullable=False, unique=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("(post_id IS NULL) <> (comment_id IS NULL)", name="ck_images_one_owner"),
        sa.CheckConstraint("position BETWEEN 0 AND 2", name="ck_images_position"),
        sa.CheckConstraint("byte_size > 0 AND byte_size <= 5000000", name="ck_images_byte_size"),
        sa.CheckConstraint("content_type IN ('image/jpeg', 'image/png', 'image/webp')", name="ck_images_type"),
        sa.UniqueConstraint("post_id", "position", name="uq_images_post_position"),
        sa.UniqueConstraint("comment_id", "position", name="uq_images_comment_position"),
    )
    op.create_table(
        "post_likes",
        sa.Column("post_id", sa.BigInteger(), sa.ForeignKey("posts.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "comment_likes",
        sa.Column("comment_id", sa.BigInteger(), sa.ForeignKey("comments.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("comment_likes")
    op.drop_table("post_likes")
    op.drop_table("images")
    op.drop_index("ix_comments_post_parent_created_id", table_name="comments")
    op.drop_table("comments")
    op.drop_index("ix_posts_created_id", table_name="posts")
    op.drop_table("posts")
    op.drop_table("login_sessions")
    op.drop_table("users")
