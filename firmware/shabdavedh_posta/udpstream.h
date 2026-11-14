// ShabdaVedh: stream this post's raw bearing to the laptop over Wi-Fi (UDP). No extra library needed.
//
// Default: post A makes its own Wi-Fi network (NET_SSID / NET_PASS, channel NET_CHANNEL, IP 192.168.4.1).
// Post B and the laptop both join it. Each post broadcasts one JSON line every NET_SEND_MS to UDP port
// NET_UDP_PORT, so the laptop just listens on that port and gets both posts; no IP addresses to type.
// Set NET_HOST_AP 0 on BOTH posts to have them join an existing network instead (phone/laptop hotspot).
//
// The DSP task calls netPublish(); a low-priority task on core 0 does the sending (and Wi-Fi reconnects),
// so the network can never stall the audio.
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>

static portMUX_TYPE netMux = portMUX_INITIALIZER_UNLOCKED;
static char netJson[1200] = "";
static volatile uint32_t netSeq = 0;
static volatile bool netReady = false;  // true once this post can send (AP up, or joined the network)
static WiFiUDP netUdp;
static void handleCmd(char c);  // in the .ino: same commands as the Serial Monitor
static void beep(int ms);       // in the .ino
static volatile uint32_t netCmdCount = 0;
static char netLastCmd = '-';
static bool netIsAp = false;

static void netPublish(const char* json) {
  portENTER_CRITICAL(&netMux);
  strncpy(netJson, json, sizeof(netJson) - 1);
  netJson[sizeof(netJson) - 1] = 0;
  netSeq = netSeq + 1;
  portEXIT_CRITICAL(&netMux);
}

static void netTask(void*) {
  uint32_t sentSeq = 0, lastTry = 0;
  char js[sizeof(netJson)];
  for (;;) {
    if (!netIsAp) {
      bool was = netReady;
      netReady = WiFi.status() == WL_CONNECTED;
      if (netReady && !was) {
        beep(300);  // long beep: joined the Wi-Fi
        Serial.printf("{\"msg\":\"Wi-Fi '%s' joined: IP %s, RSSI %d dBm, sending to %s:%d\"}\n", NET_SSID,
                      WiFi.localIP().toString().c_str(), (int)WiFi.RSSI(), WiFi.broadcastIP().toString().c_str(), NET_UDP_PORT);
      }
      if (!netReady && millis() - lastTry > 10000) {  // network not up yet, or it dropped: keep trying
        lastTry = millis();
        // status: 1 = network not found (wrong name / 5 GHz only), 4 = connect failed (wrong password / WPA3 only), 6 = disconnected
        Serial.printf("{\"msg\":\"Wi-Fi '%s' not joined yet (status %d: 1 = not found, 4 = wrong password or WPA3, 6 = disconnected). retrying\"}\n",
                      NET_SSID, (int)WiFi.status());
        WiFi.disconnect();
        WiFi.begin(NET_SSID, NET_PASS);
      }
    }
    // Commands from the laptop: a UDP packet to port NET_UDP_PORT+1, text "<target> <letters>",
    // target A, B or * (both). Example "* a" = any-sound mode on both, "A c" = calibrate post A.
    // A packet with no target ("a") goes to both.
    int plen = netUdp.parsePacket();
    if (plen > 0) {
      char cb[64];
      int n = netUdp.read((uint8_t*)cb, sizeof(cb) - 1);
      if (n > 0) {
        cb[n] = 0;
        const char* q = cb;
        bool mine = true;
        if (n >= 2 && cb[1] == ' ') { mine = cb[0] == '*' || cb[0] == (char)MIC_LAYOUT; q = cb + 2; }
        if (mine)
          for (; *q; q++)
            if (*q > ' ' && *q != 'r') {  // 'r' (raw audio to USB) makes no sense over Wi-Fi
              handleCmd(*q); netLastCmd = *q; netCmdCount = netCmdCount + 1; beep(40); }
      }
    }
    uint32_t seq = netSeq;
    if (netReady && seq != sentSeq) {
      sentSeq = seq;
      portENTER_CRITICAL(&netMux);
      memcpy(js, netJson, sizeof(js));
      portEXIT_CRITICAL(&netMux);
      IPAddress bc = netIsAp ? WiFi.softAPBroadcastIP() : WiFi.broadcastIP();
      netUdp.beginPacket(bc, NET_UDP_PORT);
      netUdp.write((const uint8_t*)js, strlen(js));
      netUdp.write((const uint8_t*)"\n", 1);
      netUdp.endPacket();
    }
    delay(5);
  }
}

// hostAp true: this post creates the network (post A). false: it joins NET_SSID (post B).
static bool netBegin(bool hostAp) {
  netIsAp = hostAp;
  if (hostAp) {
    WiFi.mode(WIFI_AP);
    if (!WiFi.softAP(NET_SSID, NET_PASS, NET_CHANNEL)) return false;
    netReady = true;
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.setMinSecurity(WIFI_AUTH_WPA_PSK);  // accept WPA and WPA2 hotspots, not only WPA2
    WiFi.begin(NET_SSID, NET_PASS);
  }
  WiFi.setSleep(false);  // no modem sleep: steady 10 Hz packets
  netUdp.begin(NET_UDP_PORT + 1);
  xTaskCreatePinnedToCore(netTask, "net", 4096, NULL, 1, NULL, 0);
  return true;
}
