from pathlib import Path

import psycopg

from .db import get_connection


def setup_database():
    schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    with get_connection() as connection:
        connection.execute(schema)


if __name__ == "__main__":
    try:
        setup_database()
    except (psycopg.Error, RuntimeError, ValueError):
        print("Schema setup failed. Check database configuration and permissions.")
        raise SystemExit(1) from None
    print("Application tables are ready. Existing records were preserved.")
