"""Alembic migration environment. DATABASE_URL is supplied at runtime."""

import sys
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool

# Alembic loads this file as a script, so make the project root importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import Base
from database import database_url


target_metadata = Base.metadata


if context.is_offline_mode():
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
