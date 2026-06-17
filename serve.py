#!/usr/bin/env python3
"""一键启动：本地网页 + API 转发（解决浏览器广告拦截误杀 /images/generations）。

用法（在项目文件夹终端，只需这一条命令）：
  python serve.py

浏览器打开：http://127.0.0.1:8080
生图 API 站点可继续填 https://api.dzzi.ai/v1 —— 直连失败时会自动改走本机 /v1/gen 转发。

环境变量（可选）：
  UPSTREAM=https://api.dzzi.ai   上游 API 根地址
  PORT=8080                      本地端口
"""
from __future__ import annotations

import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UPSTREAM = os.environ.get("UPSTREAM", "https://api.dzzi.ai").rstrip("/")
PORT = int(os.environ.get("PORT", "8080"))


def map_api_path(path: str) -> str | None:
    if path.startswith("/v1/gen"):
        return "/v1/images/generations" + path[len("/v1/gen") :]
    if path.startswith("/v1/"):
        return path
    return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[serve] " + (fmt % args) + "\n")

    def send_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self) -> None:
        api_path = map_api_path(self.path.split("?", 1)[0])
        if api_path:
            self.send_response(204)
            self.send_cors()
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self) -> None:
        path_only = self.path.split("?", 1)[0]
        if path_only == "/v1/fetch-image":
            self.proxy_fetch_image()
            return
        api_path = map_api_path(path_only)
        if api_path:
            self.proxy_api("GET", api_path)
            return
        self.serve_static()

    def do_POST(self) -> None:
        api_path = map_api_path(self.path.split("?", 1)[0])
        if api_path:
            self.proxy_api("POST", api_path)
            return
        self.send_error(405)

    def proxy_api(self, method: str, api_path: str) -> None:
        query = ""
        if "?" in self.path:
            query = "?" + self.path.split("?", 1)[1]
        url = UPSTREAM + api_path + query
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("User-Agent", "Mozilla/5.0 (compatible; SniffTheater/1.0)")
        req.add_header("Accept", "application/json")
        for header in ("Authorization", "Content-Type"):
            if header in self.headers:
                req.add_header(header, self.headers[header])
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_cors()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as err:
            data = err.read()
            self.send_response(err.code)
            self.send_cors()
            self.send_header("Content-Type", err.headers.get("Content-Type", "application/json"))
            self.end_headers()
            self.wfile.write(data)
        except Exception as err:
            payload = json.dumps({"error": {"message": str(err)}}).encode("utf-8")
            self.send_response(502)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

    def proxy_fetch_image(self) -> None:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        target = (qs.get("url") or [""])[0].strip()
        if not target.startswith(("http://", "https://")):
            self.send_error(400, "missing or invalid url")
            return
        req = urllib.request.Request(
            target,
            headers={"User-Agent": "Mozilla/5.0 (compatible; SniffTheater/1.0)", "Accept": "image/*,*/*"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "application/octet-stream")
                self.send_response(resp.status)
                self.send_cors()
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as err:
            data = err.read()
            self.send_response(err.code)
            self.send_cors()
            self.send_header("Content-Type", err.headers.get("Content-Type", "application/octet-stream"))
            self.end_headers()
            self.wfile.write(data)
        except Exception as err:
            payload = json.dumps({"error": {"message": str(err)}}).encode("utf-8")
            self.send_response(502)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

    def serve_static(self) -> None:
        rel = self.path.split("?", 1)[0]
        if rel in ("", "/"):
            rel = "/index.html"
        file_path = (ROOT / rel.lstrip("/")).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.is_file():
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    addr = ("127.0.0.1", PORT)
    print("嗅嗅剧场本地服务已启动")
    print("  网页：  http://%s:%d" % (addr[0], PORT))
    print("  转发：  http://%s:%d/v1/gen -> %s/v1/images/generations" % (addr[0], PORT, UPSTREAM))
    print("生图 API 站点仍可填 %s/v1，程序会在直连失败时自动改走本机转发。" % UPSTREAM)
    HTTPServer(addr, Handler).serve_forever()


if __name__ == "__main__":
    main()
