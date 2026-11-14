# ShabdaVedh post firmware (v1.9e)

- `shabdavedh_posta/`: flash on Post A (it has the turret and laser). `shabdavedh_postb4/`: flash on Post B.
- Before flashing, set your Wi-Fi in `config.h` on BOTH posts: `NET_SSID` and `NET_PASS`. The network must be 2.4 GHz, WPA2.
- Arduino IDE settings: board ESP32S3 Dev Module (core 3.x), Flash Size 8MB, Partition "8M with spiffs", PSRAM to match your board (QSPI for N8R2), USB CDC On Boot Enabled.
- After boot, a long beep means the post joined the Wi-Fi. Serial Monitor (115200) prints `Wi-Fi '...' joined: IP ...`.
- Each post broadcasts one JSON line 10 times a second on UDP 5005. `bridge.py` (repo root) turns that into the web page's live feed.
- Calibrate after flashing: type `c` (or press CALIBRATE on the page) and clap once, 1 m in front of the post.
