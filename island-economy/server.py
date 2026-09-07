import http.server
import os
import socketserver
import sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()
    def log_message(self, format, *args):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(r"C:\游戏\荒岛物语\island-economy")
socketserver.TCPServer.allow_reuse_address = True
server = http.server.HTTPServer(("0.0.0.0", port), Handler)
print(f"Server: http://localhost:{port} (no-cache)")
server.serve_forever()
