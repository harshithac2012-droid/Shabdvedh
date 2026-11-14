# ShabdaVedh hackathon demo plan

## Setup (10 min before)
1. Put Post A and Post B side by side, **0.80 m apart** (centre mic to centre mic), both facing the same way. Post B goes on the RIGHT, seen from the front.
2. Power both posts. Each gives a **long beep** once it has joined the XEA-12 Wi-Fi.
3. Connect the laptop to **XEA-12**.
4. Terminal 1: `python bridge.py`. You should see a `post A: ...` and a `post B: ...` line every 2 s.
5. Terminal 2: `npm run dev`. Open the link it prints, then How it works. The page switches to **LIVE** by itself.
6. **Calibrate both posts.** Press CALIBRATE A on the page and clap once, 1 m straight in front of A. Then do the same for B.

## The demo (3 acts, about 3 min)
**Act 1: the problem (30 s)**
"Small drones are cheap and hard to see. Radar is expensive. We find them by **sound**, with two $10 microphone posts."

**Act 2: live tracking (90 s), the sure-shot version**
- Play a **drone sound** from a phone or Bluetooth speaker (search "quadcopter sound" on YouTube), 1–2 m in front of the posts, at chest height.
- Point at the page: both posts go to **LOCKED** with high confidence, the drone appears in 3D, and **X / Y / Z and distance** update live.
- Walk the speaker left and right, then raise it up. The coordinates follow. "Two bearings give one point in space: that is triangulation."
- If you're allowed a real drone, fly it here instead.

**Act 3: it is not fooled (30 s)**
- Stop the drone sound and talk or clap. The status shows **CLUTTER** and no fix appears. "It ignores voices and claps. Only rotor harmonics lock it."

## If something goes wrong
- **Posts won't lock on the drone sound:** press **CLAP TEST ON (y)**. Any loud sound now locks (TEST_LOCK). Clap or snap fingers in front, and the coordinates still work, which shows the triangulation.
- **The page shows nil:** press GAIN UP once. Move the sound closer, to about 1 m.
- **bridge.py says "nothing heard":** the laptop isn't on XEA-12, or Windows Firewall is blocking Python. Allow it on Public and Private networks.
- **Hardware is dead:** switch the page to **SIMULATION** and drag the drone around. Same maths, same screen.

## Settings to check
- `bridge.py`: for the demo set `SHOW_ALL = False`, so only clean locked bearings show. Use `True` only while testing.
- Mic gain starts at +30 dB (v1.9c). GAIN UP / GAIN DOWN on the page changes it live in 6 dB steps.

## Lines for the judges
- "Each post has 4 MEMS mics. Time differences of 20 microseconds give the bearing."
- "An on-chip CNN plus a harmonic filter decides if it is a drone. Nothing runs in the cloud."
- "Two posts 80 cm apart give range and height. More posts give a bigger coverage area."
