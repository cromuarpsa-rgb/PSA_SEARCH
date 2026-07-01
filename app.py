"""
PSA Search System — local runner.

Serves the exact same static site that GitHub Pages serves (index.html,
app.js, styles.css, data/, logo/), so behavior is identical whether you
open it locally or from your GitHub Pages URL. Login/search/logout still
work when this server is not running (login and filtering are client-side),
this script additionally:

  - writes an activity log to logs/activity.log (login/search/logout/error)
  - regenerates data/psa-data.json from the .xlsx source on startup if the
    export script is available and the workbook is newer than the export

Run:
    python app.py
Then open:
    http://127.0.0.1:8000
"""
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import mimetypes
import threading
import time

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"
APP_LOG = LOG_DIR / "activity.log"
HOST = "127.0.0.1"
PORT = 8000

# Files/folders served as static assets, relative to BASE_DIR.
STATIC_FILES = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/styles.css": "styles.css"}
STATIC_DIRS = ["/data/", "/logo/"]

try:
    from scripts.export_workbook import export_workbook, find_workbook
except Exception:
    export_workbook = None
    find_workbook = None

log_lock = threading.Lock()


def ensure_files():
    LOG_DIR.mkdir(exist_ok=True)
    APP_LOG.touch(exist_ok=True)


def write_log(event, username="-", details="-"):
    ensure_files()
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    clean = str(details).replace("\r", " ").replace("\n", " ")
    with log_lock:
        with APP_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"{stamp}\t{event}\t{username}\t{clean}\n")


def maybe_refresh_export():
    """Regenerate data/psa-data.json if the source workbook is newer."""
    if not export_workbook or not find_workbook:
        return
    try:
        workbook_path = find_workbook()
        export_path = DATA_DIR / "psa-data.json"
        if not export_path.exists() or workbook_path.stat().st_mtime > export_path.stat().st_mtime:
            export_workbook()
            write_log("export_refreshed", "-", workbook_path.name)
    except Exception as exc:
        write_log("export_error", "-", str(exc))


def content_type_for(path: Path):
    guessed, _ = mimetypes.guess_type(path.name)
    if path.suffix == ".webp":
        return "image/webp"
    return guessed or "application/octet-stream"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format_string, *args):
        return

    def _send_bytes(self, data, content_type, status=HTTPStatus.OK, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload, status=HTTPStatus.OK):
        self._send_bytes(json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8", status)

    def _serve_static(self, rel_path: str):
        target = (BASE_DIR / rel_path.lstrip("/")).resolve()
        if BASE_DIR not in target.parents and target != BASE_DIR:
            self._send_bytes(b"Forbidden", "text/plain", HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self._send_bytes(b"Not found", "text/plain", HTTPStatus.NOT_FOUND)
            return
        cache = "no-store" if target.suffix == ".json" else "public, max-age=300"
        self._send_bytes(target.read_bytes(), content_type_for(target), extra_headers={"Cache-Control": cache})

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in STATIC_FILES:
            self._serve_static(STATIC_FILES[path])
            return
        if any(path.startswith(prefix) for prefix in STATIC_DIRS):
            self._serve_static(path)
            return
        if path == "/api/health":
            self._send_json({"ok": True, "time": time.time()})
            return
        self._send_bytes(b"Not found", "text/plain", HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/log":
            self._send_bytes(b"Not found", "text/plain", HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            write_log(str(payload.get("event", "event")), str(payload.get("username", "-")), str(payload.get("details", "-")))
            self._send_json({"ok": True})
        except Exception as exc:
            write_log("error", "-", str(exc))
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)


def main():
    ensure_files()
    maybe_refresh_export()
    print(f"PSA Search System running at http://{HOST}:{PORT}")
    print("Default local access: admin / admin123 (change it via the Admin menu after signing in).")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
