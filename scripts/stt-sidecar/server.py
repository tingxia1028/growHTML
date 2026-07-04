"""
server.py — GrowNote 本地语音识别 sidecar（faster-whisper，SPEECH-2 local lane）。

Adapted from the proven roundtable stt.py (read-only reference): same model loading
(GPU float16 → CPU int8 fallback), same single-flight inference lock (the CTranslate2
model isn't safe for concurrent transcribe()), same zh-biased decode options. The HTTP
layer is stdlib http.server — zero extra deps beyond faster-whisper itself.

识别完全在本地进行，不联网、不收费；输出的文字回到 growNote 的既有流程（没有 LLM 参与识别）。

Endpoints (bound to 127.0.0.1 only — this is a private localhost sidecar):
  GET  /health      -> {"ok": true, "model": "<size>"}
  POST /transcribe  -> {"text": "...", "language": "zh", "durationMs": 1234}
      body  = raw audio bytes (audio/webm;codecs=opus 等 — PyAV decodes them all)
              或 multipart/form-data（取第一个文件字段）
      query = ?language=zh   (默认 zh)

Env:
  WHISPER_MODEL  模型大小，默认 large-v3（首次使用自动下载；弱机建议 small）
  STT_PORT       端口，默认 8765
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from email import message_from_bytes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3")
PORT = int(os.getenv("STT_PORT", "8765"))
BIND = "127.0.0.1"  # localhost only — never expose the mic-transcript path to the LAN

_MODEL = None
_LOCK = threading.Lock()
_INFER_LOCK = threading.Lock()  # CTranslate2 model isn't safe for concurrent transcribe()


def _load():
    """Load the model once (GPU float16 when torch sees CUDA, else CPU int8)."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _LOCK:
        if _MODEL is not None:
            return _MODEL
        from faster_whisper import WhisperModel
        try:
            import torch
            cuda = torch.cuda.is_available()
        except Exception:  # noqa: BLE001 — torch is OPTIONAL (GPU only)
            cuda = False
        if cuda:
            try:
                _MODEL = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
                return _MODEL
            except Exception:  # noqa: BLE001 — cuDNN/cuBLAS missing → fall back to CPU
                pass
        _MODEL = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
        return _MODEL


def transcribe(path: str, language: str = "zh") -> tuple[str, str, int]:
    """Transcribe an audio file → (text, detected language, audio duration ms)."""
    model = _load()
    with _INFER_LOCK:
        segments, info = model.transcribe(
            path, language=language, beam_size=5,
            vad_filter=False,                  # VAD 会把它判成“非语音”的部分切掉，导致漏词
            condition_on_previous_text=False,  # 不被前文带偏，逐段独立、更少丢字/重复
            # bias toward simplified Chinese with punctuation
            initial_prompt="以下是普通话句子，请用简体中文并加标点。" if language == "zh" else None,
        )
        segs = list(segments)
    text = "".join(s.text for s in segs).strip()
    duration_ms = int(round((getattr(info, "duration", 0) or 0) * 1000))
    detected = getattr(info, "language", "") or language
    return text, detected, duration_ms


def _extract_multipart_file(body: bytes, content_type: str) -> bytes:
    """Pull the first file part out of a multipart/form-data body (stdlib only)."""
    message = message_from_bytes(
        b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body
    )
    for part in message.walk():
        if part.is_multipart():
            continue
        payload = part.get_payload(decode=True)
        if payload and (part.get_filename() or part.get_content_type() != "text/plain"):
            return payload
    raise ValueError("multipart body has no audio file part")


class Handler(BaseHTTPRequestHandler):
    server_version = "grownote-stt/1.0"

    def _json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler API
        if urlparse(self.path).path == "/health":
            self._json(200, {"ok": True, "model": MODEL_SIZE})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802 — BaseHTTPRequestHandler API
        parsed = urlparse(self.path)
        if parsed.path != "/transcribe":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length > 0 else b""
            if not body:
                self._json(400, {"error": "empty audio body"})
                return
            content_type = self.headers.get("Content-Type", "")
            if content_type.startswith("multipart/form-data"):
                body = _extract_multipart_file(body, content_type)
            language = (parse_qs(parsed.query).get("language") or ["zh"])[0]
            started = time.monotonic()
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as handle:
                handle.write(body)
                temp_path = handle.name
            try:
                text, detected, duration_ms = transcribe(temp_path, language=language)
            finally:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
            print(
                f"[stt] {len(body)}B -> {len(text)} chars ({detected}, "
                f"audio {duration_ms}ms, infer {time.monotonic() - started:.1f}s)"
            )
            self._json(200, {"text": text, "language": detected, "durationMs": duration_ms})
        except ValueError as error:
            self._json(400, {"error": str(error)})
        except Exception as error:  # noqa: BLE001 — surface the reason, keep serving
            self._json(500, {"error": f"transcription failed: {error}"})

    def log_message(self, fmt, *args):  # quieter default access log
        pass


def main() -> None:
    print(f"[stt] GrowNote 语音识别 sidecar — model={MODEL_SIZE} on http://{BIND}:{PORT}")
    print("[stt] 正在后台预加载模型（首次使用会自动下载，请耐心等待）…")
    threading.Thread(target=_load, daemon=True).start()  # warm up while /health answers
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
