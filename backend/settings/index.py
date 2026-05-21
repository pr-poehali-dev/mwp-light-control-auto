"""
Настройки системы (Art-Net IP, порт, параметры AI и др.).
GET /  — все настройки
POST / — сохранить одну или несколько настроек { key: value, ... }
"""
import json, os
import psycopg2
from psycopg2.extras import RealDictCursor

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    schema = os.environ.get("MAIN_DB_SCHEMA", "public")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            if method == "GET":
                cur.execute(f'SELECT key, value FROM "{schema}".settings')
                rows = cur.fetchall()
                result = {r["key"]: r["value"] for r in rows}
                return {"statusCode": 200, "headers": CORS, "body": json.dumps(result)}

            if method == "POST":
                body = json.loads(event.get("body") or "{}")
                for key, value in body.items():
                    cur.execute(
                        f'''INSERT INTO "{schema}".settings (key, value, updated_at)
                            VALUES (%s, %s, NOW())
                            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()''',
                        (str(key), str(value))
                    )
                conn.commit()
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Bad request"})}
