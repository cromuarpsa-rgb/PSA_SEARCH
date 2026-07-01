"""
Push this folder's files to https://github.com/cromuarpsa-rgb/PSA_SEARCH
using the GitHub Contents API (no git binary required).

Usage:
    python upload_to_github.py
    (or) python upload_to_github.py <token>
    (or) set GITHUB_TOKEN=... first

Needs a GitHub personal access token with "Contents: Read and write"
permission on the PSA_SEARCH repo (fine-grained token) or the classic
"repo" scope.
"""
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
import base64
import http.client
import json
import os
import sys

OWNER = "cromuarpsa-rgb"
REPO = "PSA_SEARCH"
BRANCH = "main"
ROOT = Path(__file__).resolve().parent
IGNORED_DIRS = {".git", "__pycache__", ".venv", "venv", "node_modules", "logs"}
IGNORED_FILES = {".DS_Store"}


def collect_files():
    files = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel_path = path.relative_to(ROOT)
        if any(part in IGNORED_DIRS for part in rel_path.parts[:-1]):
            continue
        if rel_path.name in IGNORED_FILES:
            continue
        files.append(rel_path.as_posix())
    return files


def api_request(method, url, token, payload=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "PSA-Search-Uploader",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(request, timeout=60) as response:
            try:
                raw_bytes = response.read()
            except http.client.IncompleteRead as incomplete:
                raw_bytes = incomplete.partial or b""
            raw = raw_bytes.decode("utf-8", errors="replace")
            try:
                return response.status, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return response.status, {"message": raw}
    except HTTPError as error:
        try:
            raw_bytes = error.read()
        except http.client.IncompleteRead as incomplete:
            raw_bytes = incomplete.partial or b""
        raw = raw_bytes.decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"message": raw}
        return error.code, body


def remote_sha(path, token):
    encoded_path = quote(path, safe="/")
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/contents/{encoded_path}?ref={BRANCH}"
    status, body = api_request("GET", url, token)
    if status == 200:
        return body.get("sha")
    if status == 404:
        return None
    raise RuntimeError(f"Could not check {path}: {body.get('message', body)}")


def upload_file(path, token):
    local_path = ROOT / path
    if not local_path.exists():
        print(f"Skipped missing file: {path}")
        return
    content = base64.b64encode(local_path.read_bytes()).decode("ascii")
    sha = remote_sha(path, token)
    payload = {"message": f"Update {path}", "content": content, "branch": BRANCH}
    if sha:
        payload["sha"] = sha
    encoded_path = quote(path, safe="/")
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/contents/{encoded_path}"
    status, body = api_request("PUT", url, token, payload)
    if status not in (200, 201):
        raise RuntimeError(f"Upload failed for {path}: {body.get('message', body)}")
    action = "Updated" if status == 200 else "Created"
    print(f"{action}: {path}")


def get_token():
    for key in ("GITHUB_TOKEN", "GH_TOKEN", "GIT_TOKEN"):
        value = os.getenv(key)
        if value:
            return value
    if len(sys.argv) > 1:
        return sys.argv[1]
    return input("Paste a GitHub token with write access to PSA_SEARCH: ").strip()


def main():
    print(f"Uploading PSA Search System to https://github.com/{OWNER}/{REPO}")
    token = get_token()
    if not token or token in {"password", "123456"}:
        raise SystemExit("No valid token provided.")
    for path in collect_files():
        upload_file(path, token)
    print("Done. Verify at https://github.com/%s/%s" % (OWNER, REPO))
    print(f"Pages URL (once enabled): https://{OWNER}.github.io/{REPO}/")


if __name__ == "__main__":
    main()
