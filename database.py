"""Open database sessions only when an API request needs one."""

import json
import os
from collections.abc import Iterator
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session


def database_url() -> str:
    value = os.getenv("DATABASE_URL")
    if value:
        return value
    secret_id = os.getenv("DATABASE_SECRET_ID")
    region = os.getenv("AWS_REGION")
    if not secret_id or not region:
        raise RuntimeError("Set DATABASE_URL or both DATABASE_SECRET_ID and AWS_REGION")

    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        response = boto3.client("secretsmanager", region_name=region).get_secret_value(SecretId=secret_id)
        secret = json.loads(response["SecretString"])
        return URL.create(
            "postgresql+psycopg",
            username=secret["username"],
            password=secret["password"],
            host=secret["host"],
            port=int(secret.get("port") or 5432),
            database=secret.get("dbname") or secret.get("database") or "postgres",
            query={"sslmode": os.getenv("DATABASE_SSLMODE", "require")},
        ).render_as_string(hide_password=False)
    except (BotoCoreError, ClientError) as exc:
        code = exc.response.get("Error", {}).get("Code", "AWS error") if isinstance(exc, ClientError) else "AWS connection error"
        raise RuntimeError(f"Could not read DATABASE_SECRET_ID ({code})") from None
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise RuntimeError("Database secret must contain username, password, host, and optional port/dbname") from None


@lru_cache
def _engine():
    try:
        return create_engine(database_url(), pool_pre_ping=True)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="資料庫設定或 Secrets Manager 憑證無法載入") from exc


def get_db() -> Iterator[Session]:
    with Session(_engine()) as session:
        yield session
