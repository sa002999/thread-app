"""S3 direct-upload signing and image verification."""

import os
import re
import uuid
from functools import lru_cache

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException


ALLOWED_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_UPLOAD_BYTES = 5_000_000
MAX_SOURCE_BYTES = 20_000_000
UPLOAD_TTL_SECONDS = 300


@lru_cache
def s3_client():
    region = os.getenv("AWS_REGION")
    if not region:
        raise HTTPException(status_code=503, detail="AWS_REGION 尚未設定")
    return boto3.client("s3", region_name=region)


def bucket_name() -> str:
    bucket = os.getenv("S3_BUCKET")
    if not bucket:
        raise HTTPException(status_code=503, detail="S3_BUCKET 尚未設定")
    return bucket


def issue_upload(user_id: int, content_type: str, byte_size: int) -> dict:
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail="僅支援 JPEG、PNG 或 WebP 圖片")
    if byte_size <= 0 or byte_size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="壓縮後圖片須介於 1 byte 至 5 MB")
    key = f"uploads/{user_id}/{uuid.uuid4().hex}.{ALLOWED_TYPES[content_type]}"
    try:
        url = s3_client().generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket_name(), "Key": key, "ContentType": content_type},
            ExpiresIn=UPLOAD_TTL_SECONDS,
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=503, detail="目前無法準備圖片上傳") from exc
    return {"upload_url": url, "object_key": key, "content_type": content_type,
            "required_headers": {"Content-Type": content_type}, "expires_in": UPLOAD_TTL_SECONDS}


def verify_upload(user_id: int, object_key: str, content_type: str, byte_size: int) -> None:
    if not re.fullmatch(rf"uploads/{user_id}/[0-9a-f]{{32}}\.(jpg|png|webp)", object_key):
        raise HTTPException(status_code=422, detail="圖片上傳識別碼無效")
    if content_type not in ALLOWED_TYPES or not 0 < byte_size <= MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="圖片格式或大小不符合限制")
    try:
        result = s3_client().head_object(Bucket=bucket_name(), Key=object_key)
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status in {403, 404}:
            raise HTTPException(status_code=422, detail="找不到已上傳的圖片") from exc
        raise HTTPException(status_code=503, detail="目前無法確認圖片上傳狀態") from exc
    except BotoCoreError as exc:
        raise HTTPException(status_code=503, detail="目前無法確認圖片上傳狀態") from exc
    if result.get("ContentLength") != byte_size or result.get("ContentType", "").split(";")[0] != content_type:
        raise HTTPException(status_code=422, detail="圖片上傳內容與宣告不一致")
    try:
        header = s3_client().get_object(Bucket=bucket_name(), Key=object_key, Range="bytes=0-11")["Body"].read(12)
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=503, detail="目前無法驗證圖片內容") from exc
    valid_header = {
        "image/jpeg": header.startswith(b"\xff\xd8\xff"),
        "image/png": header.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/webp": header[:4] == b"RIFF" and header[8:12] == b"WEBP",
    }[content_type]
    if not valid_header:
        raise HTTPException(status_code=422, detail="圖片檔案內容與格式不一致")


def cloudfront_url(object_key: str) -> str | None:
    domain = os.getenv("CLOUDFRONT_DOMAIN", "").strip().rstrip("/")
    if not domain:
        return None
    if domain.startswith("https://"):
        base = domain
    else:
        base = f"https://{domain}"
    return f"{base}/{object_key}"
