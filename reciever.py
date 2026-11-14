"""ShabdaVedh laptop receiver: listens for both posts on UDP 5005, prints them, and sends commands.
No Serial Monitor needed: the posts can run on power banks.

Run:  python receive.py        (laptop joined to Wi-Fi "ShabdaVedh", password "shabdavedh")
Windows: allow Python through the firewall when it asks (tick Public AND Private).

Type a command + Enter while it runs (goes to BOTH posts unless you put A or B first):
  y        any-sound mode ON  (clap test)        n    any-sound mode OFF (drones only)
  c        calibrate: clap once ~1 m in front within 3 s (do ONE post at a time: "A c", then "B c")
  + / -    mic gain up / down 6 dB               R    reboot the post
  h        health line on/off (mic levels, gain, cpu)       q    quit
  turret (post A):  L laser always on/off   l laser 2 s test   s servo sweep   p park   m turret on/off
  examples:  "y"   "A c"   "B +"

Put your own maths in on_update(). latest["A"] / latest["B"] always hold each post's newest packet.
A ready-made triangulate() is below if you want it.
"""
import json, math, os, socket, sys, threading, time

PORT = 5005          # posts -> laptop
CMD_PORT = 5006      # laptop -> posts
BASELINE_M = 0.80    # post B is this far to the RIGHT of post A, seen from the front, same height, same facing

latest = {}          # "A" / "B" -> newest packet (dict), plus "_rx" = laptop arrival time, "_ip" = post's IP
show_health = False


def triangulate(azA, elA, azB, elB, baseline=BASELINE_M):
    """Cross the two bearings. Angles in degrees, each post's own frame:
    az 0 = straight out of the box, + = toward post B's side (left when standing behind the boxes), el up.
    Returns (range_from_A_m, x, y, z, miss_m) or None. x out of the boxes, y toward post B, z up."""
    def d(az, el):
        a, e = math.radians(az), math.radians(el)
        return (math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))
    u, v, B = d(azA, elA), d(azB, elB), (0.0, baseline, 0.0)
    b = sum(i * j for i, j in zip(u, v))
    if 1 - b * b < 1e-4:
        return None                                   # nearly parallel
    w0 = [-c for c in B]
    dd = sum(i * j for i, j in zip(u, w0)); e = sum(i * j for i, j in zip(v, w0))
    t = (b * e - dd) / (1 - b * b); s = (e - b * dd) / (1 - b * b)
    if t <= 0 or s <= 0:
        return None                                   # lines meet behind a post
    p = [t * c for c in u]; q = [B[i] + s * v[i] for i in range(3)]
    m = [(p[i] + q[i]) / 2 for i in range(3)]
    return math.dist((0, 0, 0), m), m[0], m[1], m[2], math.dist(p, q)


def on_update(post, pkt):
    A, B = latest.get("A"), latest.get("B")
    now = time.time()
    parts = []
    for k, x in (("A", A), ("B", B)):
        if not x:
            parts.append(f"{k}: not heard")
        elif now - x["_rx"] > 1.0:
            parts.append(f"{k}: SILENT {now - x['_rx']:.0f}s")
        else:
            parts.append(f"{k}: {x['label']:9} conf={x['conf']:3d} "
                         f"az={x['laz']:6.1f} el={x['lel']:5.1f}{'' if x['valid'] else ' (held)'}")
    line = "  ".join(parts)
    # Only clean, labelled locks from BOTH posts go into the range (clutter is ignored).
    if A and B and now - A["_rx"] < 0.5 and now - B["_rx"] < 0.5 and A["valid"] and B["valid"]:
        r = triangulate(A["laz"], A["lel"], B["laz"], B["lel"])
        if r:
            line += f"  | RANGE {r[0]:.2f} m  height {r[3]:.2f} m  miss {r[4]:.2f} m"
    print(line, flush=True)
    if show_health:
        print("    " + "   ".join(
            f"{k}: mics {x['mic']} dB gain +{x['gain']:.0f} cpu {x['cpu']:.0f}ms drop {x['drop']} "
            f"off {x['off']}{' NEEDS CALIB (c)' if x['recal'] else ''} up {x['up']}s last cmd '{x['cmd']}'"
            + (f" | turret pan {x['pan']:.0f} tilt {x['tilt']:.0f} laser {'ON' if x['laser'] else 'off'}"
               if x.get('turret') else "")
            for k, x in (("A", A), ("B", B)) if x), flush=True)


sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
sock.bind(("", PORT))


def send_cmd(text):
    """Send a command to the post(s). Uses each post's IP once heard, else Wi-Fi broadcast."""
    text = text.strip()
    target = "*"
    if len(text) >= 2 and text[0] in "ABab" and text[1] == " ":
        target, text = text[0].upper(), text[2:].strip()
    msg = f"{target} {text}".encode()
    ips = {x["_ip"] for k, x in latest.items() if target in ("*", k)}
    for ip in ips or {"192.168.4.255"}:
        sock.sendto(msg, (ip, CMD_PORT))
    print(f">> sent '{text}' to {target} ({', '.join(sorted(ips)) or 'broadcast'})", flush=True)


def keyboard():
    global show_health
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == "q":
            os._exit(0)
        if line == "h":
            show_health = not show_health
            continue
        send_cmd(line)


threading.Thread(target=keyboard, daemon=True).start()
print(f"listening on UDP {PORT} ... type y + Enter for clap test, h for health, q to quit")
while True:
    data, addr = sock.recvfrom(2048)
    for raw in data.decode(errors="ignore").splitlines():
        try:
            pkt = json.loads(raw)
        except ValueError:
            continue
        post = pkt.get("post", "?")
        if "err" in pkt:
            print(f"!! post {post}: {pkt['err']} (port0 {'ok' if pkt.get('port0') else 'MISSING'}, "
                  f"port1 {'ok' if pkt.get('port1') else 'MISSING'}): check mic wiring", flush=True)
            continue
        if pkt.get("msg") == "calib_start":
            print(f"** post {post}: CALIBRATING, clap once now ~1 m in front of it", flush=True)
            continue
        if pkt.get("msg") == "calib":
            print(f"** post {post}: calibration {'OK' if pkt['ok'] else 'FAILED, clap again (c)'} "
                  f"(offset {pkt['off']})", flush=True)
            continue
        pkt["_rx"] = time.time(); pkt["_ip"] = addr[0]
        latest[post] = pkt
        on_update(post, pkt)
