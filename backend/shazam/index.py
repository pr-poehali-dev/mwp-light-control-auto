"""
Shazam Audio Recognition — принимает base64 аудио-фрагмент (WAV/PCM),
отправляет в Shazam Core API через RapidAPI, возвращает метаданные трека.
"""

import json
import os
import base64
import http.client

HEADERS_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    "Content-Type": "application/json",
}


def handler(event: dict, context) -> dict:
    """Распознаёт трек по аудио-фрагменту через Shazam Core API."""

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": HEADERS_CORS, "body": ""}

    if event.get("httpMethod") != "POST":
        return {
            "statusCode": 405,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": "Method not allowed"}),
        }

    # Парсим тело запроса
    body_raw = event.get("body") or "{}"
    try:
        body = json.loads(body_raw)
    except Exception:
        return {
            "statusCode": 400,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": "Invalid JSON body"}),
        }

    audio_b64 = body.get("audio_b64", "")
    if not audio_b64:
        return {
            "statusCode": 400,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": "audio_b64 is required"}),
        }

    api_key = os.environ.get("RAPIDAPI_KEY", "")
    if not api_key:
        return {
            "statusCode": 500,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": "RAPIDAPI_KEY not configured"}),
        }

    # Декодируем аудио из base64
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception as e:
        print(f"[shazam] base64 decode error: {e}, b64 length={len(audio_b64)}")
        return {
            "statusCode": 400,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": "Invalid base64 audio data"}),
        }

    print(f"[shazam] audio_bytes={len(audio_bytes)}, first4={audio_bytes[:4]}, b64_len={len(audio_b64)}")

    # Отправляем в Shazam Core API
    # Shazam Core ожидает сырые байты аудио (WAV) с content-type audio/wav
    try:
        conn = http.client.HTTPSConnection("shazam-core.p.rapidapi.com", timeout=20)
        conn.request(
            "POST",
            "/v1/tracks/recognize",
            body=audio_bytes,
            headers={
                "content-type": "audio/wav; charset=utf-8",
                "X-RapidAPI-Key": api_key,
                "X-RapidAPI-Host": "shazam-core.p.rapidapi.com",
            },
        )
        resp = conn.getresponse()
        resp_status = resp.status
        resp_body = resp.read().decode("utf-8")
        conn.close()
        print(f"[shazam] response status={resp_status}, body_len={len(resp_body)}, body_preview={resp_body[:200]}")
    except Exception as e:
        print(f"[shazam] HTTP error: {e}")
        return {
            "statusCode": 502,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": f"Shazam API error: {str(e)}"}),
        }

    if resp_status != 200:
        return {
            "statusCode": resp_status,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": f"Shazam returned {resp_status}", "detail": resp_body[:500]}),
        }

    try:
        data = json.loads(resp_body)
    except Exception as e:
        print(f"[shazam] JSON parse error: {e}, raw={resp_body[:200]}")
        return {
            "statusCode": 502,
            "headers": HEADERS_CORS,
            "body": json.dumps({"error": "Failed to parse Shazam response", "raw": resp_body[:200]}),
        }

    print(f"[shazam] parsed keys={list(data.keys())}")

    # Извлекаем нужные поля из ответа Shazam Core
    track = data.get("track", {})
    if not track:
        return {
            "statusCode": 200,
            "headers": HEADERS_CORS,
            "body": json.dumps({"matched": False, "track": None}),
        }

    # Метаданные
    title = track.get("title", "")
    subtitle = track.get("subtitle", "")  # исполнитель

    # Жанр из sections → SONG metadata
    genre = ""
    bpm_shazam = 0
    key_shazam = ""
    tempo = ""

    sections = track.get("sections", [])
    for section in sections:
        if section.get("type") == "SONG":
            for meta in section.get("metadata", []):
                title_m = meta.get("title", "").lower()
                text_m = meta.get("text", "")
                if "bpm" in title_m:
                    try:
                        bpm_shazam = int(float(text_m))
                    except Exception:
                        pass
                if "key" in title_m:
                    key_shazam = text_m
                if "tempo" in title_m:
                    tempo = text_m

    # Жанр из genres
    genres_obj = track.get("genres", {})
    genre = genres_obj.get("primary", "")
    if not genre:
        # fallback из hub или adamid
        genre = track.get("genre", "")

    # URL обложки
    images = track.get("images", {})
    cover_url = images.get("coverarthq", "") or images.get("coverart", "")

    # Apple Music / Spotify ссылки
    hub = track.get("hub", {})
    providers = hub.get("providers", [])
    spotify_url = ""
    apple_url = ""
    for prov in providers:
        ptype = prov.get("type", "").lower()
        actions = prov.get("actions", [])
        for action in actions:
            uri = action.get("uri", "")
            if "spotify" in ptype and uri:
                spotify_url = uri
            if "apple" in ptype and uri:
                apple_url = uri

    # Shazam track URL
    shazam_url = track.get("url", "")

    result = {
        "matched": True,
        "track": {
            "title": title,
            "artist": subtitle,
            "genre": genre,
            "bpm": bpm_shazam,
            "key": key_shazam,
            "tempo": tempo,
            "cover_url": cover_url,
            "shazam_url": shazam_url,
            "spotify_url": spotify_url,
            "apple_url": apple_url,
            "shazam_id": track.get("key", ""),
        },
    }

    return {
        "statusCode": 200,
        "headers": HEADERS_CORS,
        "body": json.dumps(result),
    }