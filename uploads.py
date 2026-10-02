"""Authenticated S3 presigned upload endpoints."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import current_account
from models import User
from storage import issue_upload


router = APIRouter(prefix="/api/uploads", tags=["uploads"])


class PresignInput(BaseModel):
    content_type: str
    byte_size: int


@router.post("/presign")
def presign_upload(data: PresignInput, account: tuple[User, object] = Depends(current_account)) -> dict:
    return issue_upload(account[0].id, data.content_type, data.byte_size)
