"""ShabdaVedh live feed in the SAME format as the simulator: {"type":"update","post":..,"packet":{..},"fix":{..}}
Replaces the fake data. Python 3.8+, nothing to install.

  1. Laptop on Wi-Fi "ShabdaVedh" (password "shabdavedh"), posts powered.
  2. Stop the simulator, then:  python live_feed.py            (or: python live_feed.py 8000  to pick the port)
  3. Point the web page where it read the simulator:
       Server-Sent Events:  http://localhost:PORT/   (any path, e.g. /events or /stream)  -> "data: {...}" lines
       WebSocket:           ws://localhost:PORT/ws   (any path with a WebSocket upgrade)
Windows: allow Python through the firewall (Public + Private).
"""
import asyncio, base64, hashlib, json, math, socket, struct, sys, time

UDP_PORT = 5005
HTTP_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
BASELINE_M = 0.80      # post B is 0.80 m from post A (centre mic to centre mic), + y side

latest = {}
sse_clients, ws_clients = set(), set()


def triangulate(azA, elA, azB, elB, baseline=BASELINE_M):
    def d(az, el):
        a, e = math.radians(az), math.radians(el)
        return (math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))
    u, v = d(azA, elA), d(azB, elB)
    b = sum(i * j for i, j in zip(u, v))
    if 1 - b * b < 1e-4:
        return None
    w0 = (0.0, -baseline, 0.0)
    dd = sum(i * j for i, j in zip(u, w0)); e = sum(i * j for i, j in zip(v, w0))
    t = (b * e - dd) / (1 - b * b); s = (e - b * dd) / (1 - b * b)
    if t <= 0.05 or s <= 0.05 or t > 60 or s > 60:
        return None
    p = [t * c for c in u]; q = [s * v[0], baseline + s * v[1], s * v[2]]
    m = [(p[i] + q[i]) / 2 for i in range(3)]
    return {"range": math.dist((0, 0, 0), m), "x": m[0], "y": m[1], "z": m[2], "miss": math.dist(p, q)}


def convert(r, ip):
    """Real post packet -> the simulator's packet format."""
    pkt = {"post": r["post"], "st": r["label"], "any": bool(r["any"]), "p": r["p"],
           "ok": bool(r["valid"]), "az": r["laz"], "el": r["lel"], "mic": r["mic"], "gain": r["gain"],
           "cpu": r["cpu"], "drop": r["drop"], "off": r["off"], "recal": bool(r["recal"]), "up": r["up"],
           "cmd": r.get("cmd", ""), "_rx": time.time(), "_ip": ip, "conf": r["conf"] / 100,
           "good": bool(r["valid"]),
           # extras the simulator did not have:
           "lock_ms": r.get("lock_ms", 0), "lage": r.get("lage", -1), "f0": r.get("f0", 0),
           "ml": r.get("ml", -1), "lvl": r.get("lvl", 0), "raw_az": r.get("raw_az"), "raw_el": r.get("raw_el"),
           "spectrum": r.get("sp", [])}
    if r["post"] == "A":
        pkt.update(turret=bool(r.get("turret", 0)), pan=r.get("pan", 0), tilt=r.get("tilt", 0),
                   laser=bool(r.get("laser", 0)))
    return pkt


def current_fix():
    A, B = latest.get("A"), latest.get("B")
    now = time.time()
    if not (A and B and now - A["_rx"] < 0.5 and now - B["_rx"] < 0.5 and A["good"] and B["good"]):
        return None
    f = triangulate(A["az"], A["el"], B["az"], B["el"])
    if f and f["miss"] > 0.4 + 0.15 * f["range"]:
        return None                       # the two posts disagree: not the same target
    return f


def ws_frame(text):
    data = text.encode(); n = len(data)
    head = struct.pack("!BB", 0x81, n) if n < 126 else struct.pack("!BBH", 0x81, 126, n)
    return head + data


def publish(obj):
    text = json.dumps(obj)
    sse = f"data: {text}\n\n".encode(); wsf = ws_frame(text)
    for group, payload in ((sse_clients, sse), (ws_clients, wsf)):
        for w in list(group):
            if w.is_closing() or w.transport.get_write_buffer_size() > 1_000_000:
                group.discard(w); continue
            w.write(payload)


class UdpIn(asyncio.DatagramProtocol):
    def datagram_received(self, data, addr):
        for raw in data.decode(errors="ignore").splitlines():
            try:
                r = json.loads(raw)
            except ValueError:
                continue
            if "post" not in r or "label" not in r:
                if "err" in r or "msg" in r:
                    publish({"type": "event", **r})           # NO AUDIO / calibration messages
                continue
            pkt = convert(r, addr[0])
            latest[pkt["post"]] = pkt
            publish({"type": "update", "post": pkt["post"], "packet": pkt, "fix": current_fix()})


async def handle(reader, writer):
    try:
        head = (await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)).decode(errors="ignore")
    except Exception:
        writer.close(); return
    hdr = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in head.split("\r\n")[1:]) if k}
    if "sec-websocket-key" in hdr:
        acc = base64.b64encode(hashlib.sha1((hdr["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                                            .encode()).digest()).decode()
        writer.write(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     f"Sec-WebSocket-Accept: {acc}\r\n\r\n".encode())
        ws_clients.add(writer); print("WebSocket client connected")
        try:
            while await reader.read(1024):
                pass
        finally:
            ws_clients.discard(writer); writer.close()
        return
    if head.startswith("OPTIONS"):
        writer.write(b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\n\r\n")
        await writer.drain(); writer.close(); return
    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\n"
                 b"Connection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n")
    sse_clients.add(writer); print("SSE client connected")
    try:
        while await reader.read(1024):
            pass
    finally:
        sse_clients.discard(writer); writer.close()


async def main():
    loop = asyncio.get_running_loop()
    us = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    us.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    us.bind(("", UDP_PORT))
    await loop.create_datagram_endpoint(UdpIn, sock=us)
    server = await asyncio.start_server(handle, "0.0.0.0", HTTP_PORT)
    print(f"posts -> UDP {UDP_PORT}.  Page: SSE http://localhost:{HTTP_PORT}/  or  WebSocket ws://localhost:{HTTP_PORT}/ws")
    async with server:
        while True:
            await asyncio.sleep(2)
            for k in ("A", "B"):
                if k not in latest:
                    print(f"waiting for post {k}... (laptop on ShabdaVedh Wi-Fi? firewall allows Python?)")
            publish_keepalive = b": keepalive\n\n"
            for w in list(sse_clients):
                w.write(publish_keepalive)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
