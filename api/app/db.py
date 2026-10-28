import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv


# Resolve only the replacement API's .env, regardless of the working directory.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def get_connection():
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    return psycopg.connect(
        database_url,
        connect_timeout=15,
        prepare_threshold=None,
    )


def check_database():
    with get_connection() as connection:
        connection.read_only = True
        return connection.execute("SELECT 1").fetchone() == (1,)


if __name__ == "__main__":
    try:
        if not check_database():
            raise RuntimeError("Unexpected database response")
    except (psycopg.Error, RuntimeError, ValueError):
        # Driver errors can contain connection details; never print them.
        print("Database check failed. Check DATABASE_URL and network access.")
        raise SystemExit(1) from None
    print("Database connection OK (read-only SELECT 1).")
