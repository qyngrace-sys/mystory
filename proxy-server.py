#!/usr/bin/env python3
"""本地 API 转发，供「嗅嗅剧场」浏览器端绕过广告拦截器对 /images/ 路径的拦截。

用法（在项目文件夹终端）：
  python proxy-server.py

然后在生图 API 设置里把站点改为：http://127.0.0.1:8787/v1
Key 仍填你的真实 Key；程序会把 /v1/gen 转发到上游的 /v1/images/generations。

环境变量（可选）：
  UPSTREAM=https://api.dzzi.ai   上游 API 根地址（不含 /v1）
  PORT=8787                      本地监听端口
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

UPSTREAM = os.environ.get("UPSTREAM", "https://api.dzzi.ai").rstrip("/")
PORT = int(os.environ.get("PORT", "8787"))


def map_path(path: str) -> str:
    if path.startswith("/v1/gen"):
        return "/v1/images/generations" + path[len("/v1/gen") :]
    return path


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")

    def send_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def proxy(self, method: str) -> None:
        upstream_path = map_path(self.path.split("?", 1)[0])
        query = ""
        if "?" in self.path:
            query = "?" + self.path.split("?", 1)[1]
        url = UPSTREAM + upstream_path + query

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None

        req = urllib.request.Request(url, data=body, method=method)
        for header in ("Authorization", "Content-Type"):
            if header in self.headers:
                req.add_header(header, self.headers[header])

        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_cors()
                ctype = resp.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ctype)
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as err:
            data = err.read()
            self.send_response(err.code)
            self.send_cors()
            ctype = err.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ctype)
            self.end_headers()
            self.wfile.write(data)
        except Exception as err:
            payload = json.dumps({"error": {"message": str(err)}}).encode("utf-8")
            self.send_response(502)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self) -> None:
        self.proxy("GET")

    def do_POST(self) -> None:
        self.proxy("POST")


def main() -> None:
    addr = ("127.0.0.1", PORT)
    print(f"本地 API 转发：http://{addr[0]}:{addr[1]} -> {UPSTREAM}")
    print("生图设置里站点填：http://127.0.0.1:%d/v1" % PORT)
    print("（/v1/models 与 /v1/gen 会转发到上游；/v1/gen 对应 images/generations）")
    HTTPServer(addr, ProxyHandler).serve_forever()


if __name__ == "__main__":
    main()
