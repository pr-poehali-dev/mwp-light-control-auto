"""
Art-Net DMX вывод.
POST /send  — отправить DMX universe на Art-Net узел
POST /test  — ping / тест подключения
GET  /status — статус последней отправки

Art-Net UDP пакет строится по спецификации Art-Net 4.
Браузер не может отправлять UDP напрямую, поэтому этот cloud-function
выступает мостом: Frontend → HTTPS → Cloud Function → UDP Art-Net → световое оборудование.
"""
import json, os, socket, struct, time
import psycopg2
from psycopg2.extras import RealDictCursor

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# Art-Net константы
ARTNET_PORT   = 6454
ARTNET_ID     = b"Art-Net\x00"
ARTNET_OPCODE = 0x5000  # ArtDmx
ARTNET_VER    = 14

_last_status: dict = {"ok": False, "ts": 0, "ip": "", "channels_sent": 0, "error": ""}

def build_artdmx(universe: int, data: list[int]) -> bytes:
    """Собирает Art-Net ArtDmx пакет."""
    dmx = bytes([max(0, min(255, v)) for v in data])
    # pad до чётной длины (минимум 2)
    if len(dmx) % 2 != 0:
        dmx += b"\x00"
    length = len(dmx)
    packet = (
        ARTNET_ID +
        struct.pack("<H", ARTNET_OPCODE) +      # OpCode LE
        struct.pack(">H", ARTNET_VER) +          # ProtVer BE
        struct.pack("B", 0) +                    # Sequence
        struct.pack("B", 0) +                    # Physical
        struct.pack("<H", universe & 0x7FFF) +   # Universe LE
        struct.pack(">H", length) +              # Length BE
        dmx
    )
    return packet

def send_artnet(ip: str, port: int, universe: int, data: list[int]) -> dict:
    packet = build_artdmx(universe, data)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(2.0)
    sock.sendto(packet, (ip, port))
    sock.close()
    return {"ok": True, "bytes": len(packet), "channels": len(data)}

def get_settings(schema: str) -> dict:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return {"artnet_ip": "192.168.1.10", "artnet_port": "6454", "artnet_universe": "0"}
    with psycopg2.connect(dsn) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f'SELECT key, value FROM "{schema}".settings')
            return {r["key"]: r["value"] for r in cur.fetchall()}

def log_history(schema: str, event_type: str, message: str):
    try:
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            return
        with psycopg2.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f'INSERT INTO "{schema}".history_events (event_type, message) VALUES (%s, %s)',
                    (event_type, message)
                )
            conn.commit()
    except Exception:
        pass

def handler(event: dict, context) -> dict:
    global _last_status

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    path   = event.get("path", "/")
    schema = os.environ.get("MAIN_DB_SCHEMA", "public")

    # GET /status
    if method == "GET":
        return {"statusCode": 200, "headers": CORS, "body": json.dumps(_last_status)}

    if method == "POST":
        body = json.loads(event.get("body") or "{}")
        cfg  = get_settings(schema)

        ip       = body.get("ip",       cfg.get("artnet_ip",       "192.168.1.10"))
        port     = int(body.get("port", cfg.get("artnet_port",     ARTNET_PORT)))
        universe = int(body.get("universe", cfg.get("artnet_universe", 0)))

        # POST /test — ping (отправляем нулевой universe)
        if path.rstrip("/").endswith("/test"):
            try:
                result = send_artnet(ip, port, universe, [0] * 512)
                _last_status = {"ok": True, "ts": time.time(), "ip": ip,
                                "channels_sent": 0, "error": ""}
                log_history(schema, "auto", f"Art-Net PING OK → {ip}:{port} universe {universe}")
                return {"statusCode": 200, "headers": CORS,
                        "body": json.dumps({"ok": True, "ip": ip, "port": port, "universe": universe})}
            except Exception as e:
                _last_status = {"ok": False, "ts": time.time(), "ip": ip,
                                "channels_sent": 0, "error": str(e)}
                return {"statusCode": 200, "headers": CORS,
                        "body": json.dumps({"ok": False, "error": str(e)})}

        # POST /send — отправить DMX данные
        channels = body.get("channels", [])
        if not channels:
            return {"statusCode": 400, "headers": CORS,
                    "body": json.dumps({"error": "channels required"})}

        # Дополняем до 512
        dmx = list(channels) + [0] * (512 - len(channels))
        dmx = dmx[:512]

        try:
            result = send_artnet(ip, port, universe, dmx)
            _last_status = {"ok": True, "ts": time.time(), "ip": ip,
                            "channels_sent": len(channels), "error": ""}
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({
                "ok": True, "ip": ip, "port": port, "universe": universe,
                "channels_sent": len(channels), "bytes": result["bytes"]
            })}
        except Exception as e:
            _last_status = {"ok": False, "ts": time.time(), "ip": ip,
                            "channels_sent": 0, "error": str(e)}
            log_history(schema, "auto", f"Art-Net ошибка → {ip}: {str(e)}")
            return {"statusCode": 200, "headers": CORS,
                    "body": json.dumps({"ok": False, "error": str(e)})}

    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "Bad request"})}
