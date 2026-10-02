"""Validate and attach already-uploaded images to content."""

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Image
from storage import verify_upload


class ImageInput(BaseModel):
    object_key: str
    content_type: str
    byte_size: int


def replace_images(db: Session, owner_field: str, owner_id: int, images: list[ImageInput], user_id: int) -> None:
    if owner_field not in {"post_id", "comment_id"}:
        raise ValueError("invalid image owner field")
    if len(images) > 3:
        raise HTTPException(status_code=422, detail="每則內容最多附加 3 張圖片")
    keys = [image.object_key for image in images]
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=422, detail="同一張圖片不可重複附加")
    owner_column = getattr(Image, owner_field)
    current = {row.object_key: row for row in db.scalars(select(Image).where(owner_column == owner_id)).all()}
    for image in images:
        existing = current.get(image.object_key)
        if existing:
            if (existing.content_type, existing.byte_size) != (image.content_type, image.byte_size):
                raise HTTPException(status_code=422, detail="圖片資料不一致")
            continue
        if db.scalar(select(Image.id).where(Image.object_key == image.object_key)):
            raise HTTPException(status_code=409, detail="這張圖片已附加至其他內容")
        verify_upload(user_id, image.object_key, image.content_type, image.byte_size)
    for row in current.values():
        db.delete(row)
    db.flush()
    for position, image in enumerate(images):
        db.add(Image(**{owner_field: owner_id}, object_key=image.object_key, position=position,
                     content_type=image.content_type, byte_size=image.byte_size))
