"""
История событий системы.
GET /  — список (query: limit, type, offset)
POST / — добавить событие
DELETE / — очистить всю историю
"""
import json, os
import psycopg2
from psycopg2.extras import RealDictCursor

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    schema = os.environ.get("MAIN_DB_SCHEMA", "public")
    qs     = event.get("queryStringParameters") or {}

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            if method == "GET":
                limit  = int(qs.get("limit", 100))
                offset = int(qs.get("offset", 0))
                etype  = qs.get("type")

                if etype and etype in ("ai", "auto", "manual"):
                    cur.execute(
                        f'''SELECT * FROM "{schema}".history_events
                            WHERE event_type=%s ORDER BY created_at DESC LIMIT %s OFFSET %s''',
                        (etype, limit, offset)
                    )
                else:
                    cur.execute(
                        f'''SELECT * FROM "{schema}".history_events
                            ORDER BY created_at DESC LIMIT %s OFFSET %s''',
                        (limit, offset)
                    )
                rows = cur.fetchall()
                cur.execute(f'SELECT COUNT(*) as total FROM "{schema}".history_events')
                total = cur.fetchone()["total"]

                result = []
                for r in rows:
                    d = dict(r)
                    d["created_at"] = str(d["created_at"])
                    d["meta"] = d["meta"] if isinstance(d["meta"], dict) else json.loads(d["meta"] or "{}")
                    result.append(d)
                return {"statusCode": 200, "headers": CORS,
                        "body": json.dumps({"events": result, "total": total})}

            if method == "POST":
                body = json.loads(event.get("body") or "{}")
                etype = body.get("event_type", "manual")
                if etype not in ("ai", "auto", "manual"):
                    etype = "manual"
                cur.execute(
                    f'''INSERT INTO "{schema}".history_events (event_type, message, meta)
                        VALUES (%s, %s, %s) RETURNING *''',
                    (etype, body.get("message",""), json.dumps(body.get("meta",{})))
                )
                row = dict(cur.fetchone())
                row["created_at"] = str(row["created_at"])
                row["meta"] = row["meta"] if isinstance(row["meta"], dict) else json.loads(row["meta"] or "{}")
                conn.commit()
                return {"statusCode": 201, "headers": CORS, "body": json.dumps(row)}

            if method == "DELETE":
                cur.execute(f'DELETE FROM "{schema}".history_events')
                conn.commit()
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Bad request"})}
