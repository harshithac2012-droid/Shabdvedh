"""Fake ShabdaVedh posts: sends made-up packets to UDP 5005 so you can build the frontend
without the ESP32s. A virtual sound source wanders in front of the boxes.

Run bridge.py first, then:  python sim.py
"""
import json, math, socket, time

BASELINE_M = 0.80
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
t0 = time.time()

while True:
    t = time.time() - t0
    # source position in the same frame as triangulate(): x out of boxes, y toward post B, z up
    x, y, z = 2.5 + 0.8 * math.sin(t * 0.5), 0.4 + 0.7 * math.sin(t * 0.8), 0.3
    for post, oy, phase in (("A", 0.0, 0.0), ("B", BASELINE_M, 1.7)):
        dy = y - oy
        conf = min(0.99, max(0.3, 0.85 + 0.2 * math.sin(t * 0.6 + phase)))   # dips below 0.75 now and then
        pkt = {
            "post": post, "st": "DRONE", "any": False, "p": round(conf, 2), "ok": True,
            "az": math.degrees(math.atan2(dy, x)),
            "el": math.degrees(math.atan2(z, math.hypot(x, dy))),
            "mic": [-42, -44, -41, -43], "gain": 12.0, "cpu": 8.0,
            "drop": 0, "off": 0, "recal": False, "up": int(t), "cmd": "",
        }
        if post == "A":
            pkt.update(turret=True, pan=pkt["az"], tilt=pkt["el"], laser=False)
        sock.sendto(json.dumps(pkt).encode(), ("127.0.0.1", 5005))
    time.sleep(0.1)