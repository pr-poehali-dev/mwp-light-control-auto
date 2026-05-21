"""
CRUD для пресетов освещения.
GET / — список всех пресетов
POST / — создать пресет
PUT /{id} — обновить пресет
DELETE /{id} — удалить пресет
"""
import json, os
import psycopg2
from psycopg2.extras import RealDictCursor

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    path   = event.get("path", "/")
    schema = os.environ.get("MAIN_DB_SCHEMA", "public")

    # Extract id from path like /123
    preset_id = None
    parts = [p for p in path.strip("/").split("/") if p]
    if parts and parts[-1].isdigit():
        preset_id = int(parts[-1])

    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            # GET — список
            if method == "GET":
                cur.execute(f'SELECT * FROM "{schema}".presets ORDER BY id')
                rows = cur.fetchall()
                result = []
                for r in rows:
                    d = dict(r)
                    d["channels"] = d["channels"] if isinstance(d["channels"], list) else json.loads(d["channels"])
                    d["created_at"] = str(d["created_at"])
                    d["updated_at"] = str(d["updated_at"])
                    result.append(d)
                return {"statusCode": 200, "headers": CORS, "body": json.dumps(result)}

            # POST — создать
            if method == "POST":
                body = json.loads(event.get("body") or "{}")
                cur.execute(
                    f'''INSERT INTO "{schema}".presets (name, genre, bpm, color, channels)
                        VALUES (%s, %s, %s, %s, %s) RETURNING *''',
                    (body["name"], body.get("genre",""), int(body.get("bpm",120)),
                     body.get("color","cyan"), json.dumps(body.get("channels",[])))
                )
                row = dict(cur.fetchone())
                row["channels"] = row["channels"] if isinstance(row["channels"], list) else json.loads(row["channels"])
                row["created_at"] = str(row["created_at"])
                row["updated_at"] = str(row["updated_at"])
                conn.commit()
                # Логируем событие
                cur.execute(f'INSERT INTO "{schema}".history_events (event_type, message) VALUES (%s, %s)',
                            ('manual', f'Создан пресет "{body["name"]}"'))
                conn.commit()
                return {"statusCode": 201, "headers": CORS, "body": json.dumps(row)}

            # PUT — обновить
            if method == "PUT" and preset_id:
                body = json.loads(event.get("body") or "{}")
                cur.execute(
                    f'''UPDATE "{schema}".presets
                        SET name=%s, genre=%s, bpm=%s, color=%s, channels=%s, updated_at=NOW()
                        WHERE id=%s RETURNING *''',
                    (body["name"], body.get("genre",""), int(body.get("bpm",120)),
                     body.get("color","cyan"), json.dumps(body.get("channels",[])), preset_id)
                )
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": CORS, "body": json.dumps({"error": "Not found"})}
                row = dict(row)
                row["channels"] = row["channels"] if isinstance(row["channels"], list) else json.loads(row["channels"])
                row["created_at"] = str(row["created_at"])
                row["updated_at"] = str(row["updated_at"])
                conn.commit()
                cur.execute(f'INSERT INTO "{schema}".history_events (event_type, message) VALUES (%s, %s)',
                            ('manual', f'Обновлён пресет "{body["name"]}"'))
                conn.commit()
                return {"statusCode": 200, "headers": CORS, "body": json.dumps(row)}

            # DELETE — удалить
            if method == "DELETE" and preset_id:
                cur.execute(f'SELECT name FROM "{schema}".presets WHERE id=%s', (preset_id,))
                row = cur.fetchone()
                if not row:
                    return {"statusCode": 404, "headers": CORS, "body": json.dumps({"error": "Not found"})}
                name = row["name"]
                cur.execute(f'DELETE FROM "{schema}".presets WHERE id=%s', (preset_id,))
                conn.commit()
                cur.execute(f'INSERT INTO "{schema}".history_events (event_type, message) VALUES (%s, %s)',
                            ('manual', f'Удалён пресет "{name}"'))
                conn.commit()
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Bad request"})}
