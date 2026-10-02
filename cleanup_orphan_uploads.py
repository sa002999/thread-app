"""Delete unassociated S3 uploads after the 24-hour recovery window."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from database import _engine
from models import Image
from storage import bucket_name, s3_client


def main() -> None:
    with _engine().connect() as db:
        attached = set(db.scalars(select(Image.object_key)).all())

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    client = s3_client()
    paginator = client.get_paginator("list_objects_v2")
    pending = []
    deleted = 0
    for page in paginator.paginate(Bucket=bucket_name(), Prefix="uploads/"):
        for item in page.get("Contents", []):
            if item["Key"] not in attached and item["LastModified"] < cutoff:
                pending.append({"Key": item["Key"]})
        if len(pending) >= 1000:
            client.delete_objects(Bucket=bucket_name(), Delete={"Objects": pending, "Quiet": True})
            deleted += len(pending)
            pending.clear()
    if pending:
        client.delete_objects(Bucket=bucket_name(), Delete={"Objects": pending, "Quiet": True})
        deleted += len(pending)
    print(f"Deleted {deleted} unassociated upload(s).")


if __name__ == "__main__":
    main()
