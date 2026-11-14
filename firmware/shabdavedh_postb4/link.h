// ShabdaVedh two-post link: post B sends its bearing to post A over ESP-NOW (the ESP32's own direct
// radio link: no router, no Wi-Fi password, a few ms delay). Post A crosses the two bearings to get the
// drone's real position and range, and aims the turret at that.
//
// Both posts run this same file. Both send a small packet about 10 times a second; each listens for the
// other. Nothing is needed except that both boards are powered and within radio range (tens of metres).
#pragma once
#include <Arduino.h>
#include <math.h>
#include <string.h>

#define LINK_MAGIC   0x53564C4Bu  // "SVLK": ignores other people's ESP-NOW traffic
#define LINK_CHANNEL 1            // both posts must use the same Wi-Fi channel

struct __attribute__((packed)) LinkPkt {
  uint32_t magic;
  uint8_t post;     // 'A' or 'B'
  uint8_t flags;    // LINK_VALID: az/el is a real measured bearing. LINK_DRONE: this post has a drone locked.
  uint16_t seq;
  float az, el;     // smoothed bearing in the sender's own box frame (az 0 = straight out, 90 = left from behind)
  float conf, prob, level;
  uint32_t ms;      // sender's millis(), for diagnostics only
};
enum { LINK_VALID = 1, LINK_DRONE = 2 };

// ---------------- Triangulation (pure maths) ----------------
// Frame = post A's array centre: x straight out of the box face, y left as seen from BEHIND the box
// (= right as seen from the front), z up. Post B sits at (bx, by, bz) and its box faces the same way
// as A's, turned by yawDeg (0 when both boxes face the same direction).
struct TriResult {
  bool ok;
  float x, y, z;   // drone position (A frame), metres: the midpoint of the two rays' closest approach
  float range;     // distance from post A
  float miss;      // how far apart the two rays pass (small = the two posts agree)
  float angle;     // angle between the two rays (deg); tiny angles give poor range
};

static inline void svDir(float az_deg, float el_deg, float* u) {
  float az = az_deg * (float)M_PI / 180.0f, el = el_deg * (float)M_PI / 180.0f;
  u[0] = cosf(el) * cosf(az);
  u[1] = cosf(el) * sinf(az);
  u[2] = sinf(el);
}

static inline TriResult triangulate(float azA, float elA, float azB, float elB, float bx, float by, float bz,
                                    float yawDeg, float minAngleDeg, float maxRangeM) {
  TriResult r = {false, 0, 0, 0, 0, 0, 0};
  float u[3], v[3];
  svDir(azA, elA, u);
  svDir(azB + yawDeg, elB, v);
  // Rays: P(t) = t*u (post A at the origin), Q(s) = B + s*v.  w0 = P(0) - B = -B.
  float w0[3] = {-bx, -by, -bz};
  float b = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  float d = u[0] * w0[0] + u[1] * w0[1] + u[2] * w0[2];
  float e = v[0] * w0[0] + v[1] * w0[1] + v[2] * w0[2];
  float den = 1.0f - b * b;
  float c = b > 1 ? 1 : (b < -1 ? -1 : b);
  r.angle = acosf(c) * 180.0f / (float)M_PI;
  if (r.angle < minAngleDeg || r.angle > 180.0f - minAngleDeg) return r;  // nearly parallel: no range
  float t = (b * e - d) / den, s = (e - b * d) / den;
  if (t < 0.3f || s < 0.3f || t > maxRangeM || s > maxRangeM) return r;   // behind a post or absurdly far
  float p[3] = {t * u[0], t * u[1], t * u[2]};
  float q[3] = {bx + s * v[0], by + s * v[1], bz + s * v[2]};
  float dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
  r.miss = sqrtf(dx * dx + dy * dy + dz * dz);
  r.x = 0.5f * (p[0] + q[0]);
  r.y = 0.5f * (p[1] + q[1]);
  r.z = 0.5f * (p[2] + q[2]);
  r.range = sqrtf(r.x * r.x + r.y * r.y + r.z * r.z);
  r.ok = true;
  return r;
}

// ---------------- ESP-NOW radio ----------------
#ifndef SV_NO_LINK_HW  // the PC tests build with -DSV_NO_LINK_HW and a no-op link
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

static portMUX_TYPE linkMux = portMUX_INITIALIZER_UNLOCKED;
static LinkPkt linkRx;
static volatile uint32_t linkRxMs = 0, linkRxCount = 0;
static volatile bool linkUp = false;
static char linkSelf = '?';
static uint16_t linkSeq = 0;
static const uint8_t kBcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// Called by the Wi-Fi task for every ESP-NOW packet heard.
static void onLinkRecv(const esp_now_recv_info_t*, const uint8_t* data, int len) {
  if (len != (int)sizeof(LinkPkt)) return;
  LinkPkt p;
  memcpy(&p, data, sizeof(p));
  if (p.magic != LINK_MAGIC || p.post == (uint8_t)linkSelf) return;
  portENTER_CRITICAL(&linkMux);
  linkRx = p;
  linkRxMs = millis();
  linkRxCount++;
  portEXIT_CRITICAL(&linkMux);
}

// apSsid != NULL (post A): also start a Wi-Fi access point on the same channel for the laptop.
static bool linkBegin(char selfPost, const char* apSsid = NULL, const char* apPass = NULL) {
  linkSelf = selfPost;
  if (apSsid) {
    WiFi.mode(WIFI_AP_STA);
    WiFi.disconnect();
    if (!WiFi.softAP(apSsid, apPass, LINK_CHANNEL)) return false;  // the AP sets the radio to LINK_CHANNEL
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_channel(LINK_CHANNEL, WIFI_SECOND_CHAN_NONE);
  }
  WiFi.setSleep(false);  // no modem sleep: steady packet timing
  if (esp_now_init() != ESP_OK) return false;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, kBcast, 6);  // broadcast: no pairing and no MAC addresses to copy
  peer.channel = LINK_CHANNEL;
  peer.ifidx = apSsid ? WIFI_IF_AP : WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) return false;
  if (esp_now_register_recv_cb(onLinkRecv) != ESP_OK) return false;
  linkUp = true;
  return true;
}

static void linkSend(uint8_t flags, float az, float el, float conf, float prob, float level) {
  if (!linkUp) return;
  LinkPkt p;
  p.magic = LINK_MAGIC;
  p.post = (uint8_t)linkSelf;
  p.flags = flags;
  p.seq = linkSeq++;
  p.az = az; p.el = el; p.conf = conf; p.prob = prob; p.level = level;
  p.ms = millis();
  esp_now_send(kBcast, (const uint8_t*)&p, sizeof(p));
}

// Latest packet from the other post. Returns false if none was ever heard.
static bool linkGet(LinkPkt* out, uint32_t* ageMs) {
  if (!linkUp || linkRxCount == 0) return false;
  portENTER_CRITICAL(&linkMux);
  *out = linkRx;
  uint32_t t = linkRxMs;
  portEXIT_CRITICAL(&linkMux);
  *ageMs = millis() - t;
  return true;
}
#else
#ifdef SV_FAKE_LINK  // PC test only: the test supplies post B's packets
bool fakeLinkGet(LinkPkt*, uint32_t*);
static volatile bool linkUp = true;
static bool linkBegin(char, const char* = 0, const char* = 0) { return true; }
static void linkSend(uint8_t, float, float, float, float, float) {}
static bool linkGet(LinkPkt* p, uint32_t* a) { return fakeLinkGet(p, a); }
#else
static volatile bool linkUp = false;
static bool linkBegin(char, const char* = 0, const char* = 0) { return false; }
static void linkSend(uint8_t, float, float, float, float, float) {}
static bool linkGet(LinkPkt*, uint32_t*) { return false; }
#endif
#endif
