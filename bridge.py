"""ShabdaVedh bridge: ESP32 posts (UDP 5005) -> your frontend (HTTP, localhost:8000).

Browsers cannot read UDP, so this script listens like receive.py does and re-serves
the data in a form any web page can use:

  GET  /events   live stream (Server-Sent Events), one JSON message per packet
  GET  /latest   newest packet of each post as JSON (good for a quick check in the browser)
  POST /cmd      body {"cmd": "A c"} -> forwarded to the posts on UDP 5006

Run:  python bridge.py      (laptop joined to Wi-Fi "ShabdaVedh")
Do NOT run receive.py at the same time: both want UDP port 5005.
"""
import json, math, queue, re, socket, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UDP_PORT = 5005      # posts -> laptop
CMD_PORT = 5006      # laptop -> posts
HTTP_PORT = 8000     # your frontend talks to this
BASELINE_M = 0.80    # post B is this far from post A (same value as receive.py)
CONF_KEY = "p"       # packet field that holds the confidence score (0..1 or 0..100)
CONF_MIN = 0.75      # a post below this is ignored: no fix, and the page shows "nil"

latest = {}          # "A" / "B" -> newest packet
clients = set()      # one queue per connected browser tab
lock = threading.Lock()

# Only these commands may come from the browser (same letters receive.py documents)
CMD_OK = re.compile(r"^([ABab] )?[yncRLlspm+-]$")


def triangulate(azA, elA, azB, elB, baseline=BASELINE_M):
    """Copied from receive.py. Returns (range_from_A_m, x, y, z, miss_m) or None."""
    def d(az, el):
        a, e = math.radians(az), math.radians(el)
        return (math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))
    u, v, B = d(azA, elA), d(azB, elB), (0.0, baseline, 0.0)
    b = sum(i * j for i, j in zip(u, v))
    if 1 - b * b < 1e-4:
        return None
    w0 = [-c for c in B]
    dd = sum(i * j for i, j in zip(u, w0)); e = sum(i * j for i, j in zip(v, w0))
    t = (b * e - dd) / (1 - b * b); s = (e - b * dd) / (1 - b * b)
    if t <= 0 or s <= 0:
        return None
    p = [t * c for c in u]; q = [B[i] + s * v[i] for i in range(3)]
    m = [(p[i] + q[i]) / 2 for i in range(3)]
    return math.dist((0, 0, 0), m), m[0], m[1], m[2], math.dist(p, q)


def conf_of(pkt):
    """Confidence as 0..1, whether the post sends a fraction or a percentage. None if missing."""
    try:
        c = float(pkt.get(CONF_KEY))
    except (TypeError, ValueError):
        return None
    return c / 100 if c > 1 else c


def broadcast(obj):
    text = f"data: {json.dumps(obj)}\n\n"
    with lock:
        for q in list(clients):
            try:
                q.put_nowait(text)
            except queue.Full:
                pass                      # a stuck tab must not slow the others


sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
sock.bind(("", UDP_PORT))


def send_cmd(text):
    text = text.strip()
    target = "*"
    if len(text) >= 2 and text[0] in "ABab" and text[1] == " ":
        target, text = text[0].upper(), text[2:].strip()
    msg = f"{target} {text}".encode()
    ips = {x["_ip"] for k, x in latest.items() if target in ("*", k)}
    for ip in ips or {"192.168.4.255"}:
        sock.sendto(msg, (ip, CMD_PORT))
    print(f">> sent '{text}' to {target}", flush=True)


def udp_loop():
    while True:
        data, addr = sock.recvfrom(8192)
        for raw in data.decode(errors="ignore").splitlines():
            try:
                pkt = json.loads(raw)
            except ValueError:
                continue
            post = pkt.get("post", "?")
            if post not in ("A", "B") and "err" not in pkt and "msg" not in pkt:
                continue
            if "err" in pkt:                                   # mic wiring problem
                broadcast({"type": "error", **pkt})
                continue
            if pkt.get("msg") in ("calib_start", "calib"):     # calibration progress
                broadcast({"type": "calib", **pkt})
                continue
            now = time.time()
            pkt["_rx"] = now
            pkt["_ip"] = addr[0]
            if "valid" in pkt and "laz" in pkt:
                # Real posts (firmware v1.8+): conf is 0-100, valid = locked + conf >= 75 + held 0.3 s.
                # laz/lel = last VALID bearing (clutter never moves it).
                c = float(pkt.get("conf", 0)) / 100
                pkt["st"] = pkt.get("label", pkt.get("st"))
                pkt["az"], pkt["el"] = pkt["laz"], pkt["lel"]
                pkt["conf"] = c
                pkt["good"] = bool(pkt["valid"]) and c >= CONF_MIN
            else:                                              # sim.py packets
                c = conf_of(pkt)
                pkt["conf"] = c                                # normalised 0..1
                pkt["good"] = bool(pkt.get("ok")) and c is not None and c >= CONF_MIN
            latest[post] = pkt
            fix = None
            A, B = latest.get("A"), latest.get("B")
            if (A and B and now - A["_rx"] < 0.5 and now - B["_rx"] < 0.5
                    and A["good"] and B["good"]):
                r = triangulate(A["az"], A["el"], B["az"], B["el"])
                if r and r[4] <= 0.4 + 0.15 * r[0]:           # posts must agree on the same target
                    fix = {"range": r[0], "x": r[1], "y": r[2], "z": r[3], "miss": r[4]}
            broadcast({"type": "update", "post": post, "packet": pkt, "fix": fix})


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self._cors(); self.end_headers()
            q = queue.Queue(maxsize=200)
            with lock:
                clients.add(q)
            try:
                while True:
                    try:
                        msg = q.get(timeout=15)
                    except queue.Empty:
                        msg = ": keepalive\n\n"
                    self.wfile.write(msg.encode()); self.wfile.flush()
            except OSError:
                pass                                           # tab closed
            finally:
                with lock:
                    clients.discard(q)
        elif self.path == "/latest":
            body = json.dumps(latest).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self._cors(); self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/cmd":
            self.send_error(404); return
        try:
            n = int(self.headers.get("Content-Length", 0))
            cmd = str(json.loads(self.rfile.read(n))["cmd"]).strip()
        except (ValueError, KeyError):
            self.send_error(400); return
        if not CMD_OK.match(cmd):
            self.send_error(400, "command not allowed"); return
        send_cmd(cmd)
        self.send_response(204); self._cors(); self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    threading.Thread(target=udp_loop, daemon=True).start()
    print(f"UDP {UDP_PORT} -> http://localhost:{HTTP_PORT}/events   (Ctrl+C to stop)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), Handler).serve_forever()