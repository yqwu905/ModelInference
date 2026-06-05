"""Database engine and session management."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from . import config

config.ensure_dirs()

_engine = create_engine(
    f"sqlite:///{config.DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)


def _migrate() -> None:
    """Add any model columns missing from an existing SQLite database.

    SQLModel's ``create_all`` only creates whole tables; it never alters an
    existing one. This lightweight migration adds newly-introduced columns
    (e.g. ``checkpoint.config_metadata``) as nullable so older databases keep
    working. Serializers already tolerate NULL JSON columns.
    """
    insp = inspect(_engine)
    existing_tables = set(insp.get_table_names())
    with _engine.begin() as conn:
        for table_name, table in SQLModel.metadata.tables.items():
            if table_name not in existing_tables:
                continue
            existing_cols = {c["name"] for c in insp.get_columns(table_name)}
            for col in table.columns:
                if col.name in existing_cols:
                    continue
                coltype = col.type.compile(dialect=_engine.dialect)
                conn.execute(
                    text(f'ALTER TABLE "{table_name}" ADD COLUMN "{col.name}" {coltype}')
                )


def init_db() -> None:
    """Create all tables, then add any columns missing from an older DB."""
    from . import models  # noqa: F401  (ensure tables are registered)

    SQLModel.metadata.create_all(_engine)
    _migrate()


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a session."""
    with Session(_engine) as session:
        yield session


def session_scope() -> Session:
    """Return a new session for use outside request handlers (background jobs)."""
    return Session(_engine)
