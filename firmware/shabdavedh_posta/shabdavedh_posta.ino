// ShabdaVedh POST A (turret post): acoustic drone detection, bearing and laser-pointing turret on one ESP32-S3.
// Same code as shabdavedh_s3 (model v1) plus a plain-English Serial mode and an "any sound" turret test.
//
// Pins: mics I2S0 master SCK 4 / WS 5 / SD 6 (mic0 L, mic1 R), I2S1 slave SCK 7 / WS 15 / SD 16
// (mic2 L, mic3 R), bridges 4<->7 and 5<->15. Pan servo 17, tilt servo 18, laser 8, buzzer 9.
//
// Board: ESP32S3 Dev Module (Arduino-ESP32 core 3.x). If your board has PSRAM, set
// Tools > PSRAM to "OPI PSRAM" (N8R8/N16R8) or "QSPI PSRAM" (N8R2). USB CDC On Boot: Enabled.
//
// v1.4 (14 Nov): turret off (USE_TURRET 0). Post A hosts Wi-Fi 'ShabdaVedh'; both posts stream their own
// bearing as JSON over UDP port 5005 (udpstream.h) and the laptop does the 2-post maths.
//
// v1.1 (13 Nov): same FFT fix as post B v2.2. ESP-DSP's FFT gave garbage for the 2048/4096-point
// transforms on the N16R8 board and then crashed (Guru Meditation), so the portable FFT in dsp_fft.h is
// now used, with an FFT self-test at boot. If PSRAM is missing the CNN switches off instead of halting.
//
// Data path:
//   I2S0 (master) mic0+mic1 ─┐                 ┌─ Doa: GCC-PHAT over 6 pairs -> azimuth/elevation
//   I2S1 (slave)  mic2+mic3 ─┴─ reader task ──> DSP task ─┼─ Detector: harmonic comb (+ optional CNN)
//                 (core 0, aligns ports)      (core 1)   └─ state machine -> servos, laser, JSON telemetry
//
// Serial commands (115200+ baud, or the dashboard buttons):
//   c  calibrate the port offset: clap once ~1 m straight in front of the centre mic within 3 s
//   s  servo sweep test        p  park turret        m  turret on/off
//   l  laser test (2 s)        r  stream 16 kHz audio for recording
//   a  "any sound" test mode on/off: the turret points at any loud sound (clap, whistle, music)
//   h  plain-English status every 0.5 s (default, for Serial Monitor)
//   j  JSON telemetry every 100 ms (for the dashboard; the dashboard sends it when it connects)
#include <Arduino.h>
#include <Preferences.h>
#include <math.h>

#include "config.h"
#include "detector.h"
#ifdef USE_CNN_MODEL
#include "cnn.h"
#endif
#include "doa.h"
#include "driver/i2s_std.h"
#include "dsp_fft.h"
#include "link.h"
#if NET_ENABLED
#include "udpstream.h"
#endif

// ---------------- Audio capture ----------------
static i2s_chan_handle_t rx0, rx1;
static int32_t raw0[FRAME_N * 2], raw1[FRAME_N * 2];

static const int kBufs = 4;  // one extra frame of slack for the frames that also run the bearing
// The 4-mic bearing (6 mic pairs, ~10 FFTs) takes ~40 ms with the portable FFT, but a frame is only 21 ms.
// On the board this pushed the DSP to ~55 ms per frame, so frames were dropped and the drone score fell.
// Run the bearing on every 4th frame only (~12 bearings per second, plenty for the servos).
#define DOA_EVERY_N 6  // 6 on both posts: the Wi-Fi stream adds load (was 4)
static float frames[kBufs][4][FRAME_N];
static QueueHandle_t freeQ, fullQ;

static const int kMaxDelay = 256;
static float dline[4][kMaxDelay];
static int dpos = 0;
static volatile int portOffset = 0;
static float lastDoaMs = 0;  // samples; from calibration
static volatile uint32_t droppedFrames = 0;
// Capture health. A DMA overflow or short read on one port only shifts it against the other and
// silently ruins every later bearing, so count them and restart both ports together.
static volatile uint32_t ovf0 = 0, ovf1 = 0, shortReads = 0, resyncs = 0;
static volatile bool needRecal = false;
static volatile uint32_t goodFrames = 0;
static volatile int lastE0 = 0, lastE1 = 0;
static volatile uint32_t lastGot0 = 0, lastGot1 = 0;
// Digital boost: breadboard INMP441s hear a speaker ~25 dB quieter than the test recordings, which kept
// every drone under the -62 dB gate (0%). Change live with + and - (6 dB steps).
#define MIC_GAIN_DB 30.0f
static volatile float micGainDb = MIC_GAIN_DB;
// Drone confirmed but no clear direction for this long: lock straight ahead (azimuth 0, AIM_FRONT_EL_DEG up).
#define FRONT_FALLBACK_MS 600
#define AIM_FRONT_EL_DEG 20.0f

// ---------------- DSP ----------------
static float scratch[2 * DET_NFFT];
static Doa doa;
static Detector det;
static Preferences prefs;

enum State { IDLE, CLUTTER, ACQUIRE, LOCKED };
static const char* kStateName[] = {"IDLE", "CLUTTER", "ACQUIRE", "LOCKED"};
static State state = IDLE;

static volatile bool wantCalib = false, wantSweep = false, wantPark = false, wantLaser = false;
static volatile bool turretEnabled = true, rawMode = false;
static volatile bool laserAlways = false;  // command L: laser on all the time (aiming check)
static volatile bool jsonMode = false, anyMode = false, wantAnyOff = false;

// Azimuth 0 = front (mic0/mic1 side), 90 = left, 180 = back, 270 = right (seen from above).
static const char* dirWord(float az) {
  static const char* k[] = {"front", "front-left", "left", "back-left", "back", "back-right", "right", "front-right"};
  int i = (int)lroundf(az / 45.0f) % 8;
  if (i < 0) i += 8;
  return k[i];
}

static void fatal(const char* msg) {
  while (true) {
    Serial.printf("{\"err\":\"%s\"}\n", msg);
    delay(2000);
  }
}

static bool IRAM_ATTR onRecvOverflow(i2s_chan_handle_t, i2s_event_data_t*, void* ctx) {
  (*(volatile uint32_t*)ctx)++;
  return false;
}

static void setupI2S() {
  // I2S0 generates BCLK/WS for all four mics. I2S1 is a slave on the same clock (jumpered pins),
  // so both ports sample on identical edges; only a whole-sample start offset remains (calibrated).
  i2s_chan_config_t c0 = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  c0.dma_desc_num = 8;
  c0.dma_frame_num = 256;
  i2s_chan_config_t c1 = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_SLAVE);
  c1.dma_desc_num = 8;
  c1.dma_frame_num = 256;
  if (i2s_new_channel(&c0, NULL, &rx0) != ESP_OK || i2s_new_channel(&c1, NULL, &rx1) != ESP_OK)
    fatal("i2s_new_channel failed");

  i2s_std_config_t s0 = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(FS_HZ),
      .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO),
      .gpio_cfg = {.mclk = I2S_GPIO_UNUSED,
                   .bclk = (gpio_num_t)PIN_I2S0_BCLK,
                   .ws = (gpio_num_t)PIN_I2S0_WS,
                   .dout = I2S_GPIO_UNUSED,
                   .din = (gpio_num_t)PIN_I2S0_DIN,
                   .invert_flags = {.mclk_inv = false, .bclk_inv = false, .ws_inv = false}},
  };
  i2s_std_config_t s1 = s0;
  s1.gpio_cfg.bclk = (gpio_num_t)PIN_I2S1_BCLK;
  s1.gpio_cfg.ws = (gpio_num_t)PIN_I2S1_WS;
  s1.gpio_cfg.din = (gpio_num_t)PIN_I2S1_DIN;
  if (i2s_channel_init_std_mode(rx0, &s0) != ESP_OK || i2s_channel_init_std_mode(rx1, &s1) != ESP_OK)
    fatal("i2s_channel_init_std_mode failed");
  // Callbacks must be registered before the channels are enabled.
  i2s_event_callbacks_t cb0 = {}, cb1 = {};
  cb0.on_recv_q_ovf = onRecvOverflow;
  cb1.on_recv_q_ovf = onRecvOverflow;
  i2s_channel_register_event_callback(rx0, &cb0, (void*)&ovf0);
  i2s_channel_register_event_callback(rx1, &cb1, (void*)&ovf1);
  // Slave first, so it is waiting when the master starts the clock.
  i2s_channel_enable(rx1);
  i2s_channel_enable(rx0);
}

// Stop both ports and start them again in the same order, so they come back in step.
static void restartI2S() {
  i2s_channel_disable(rx0);
  i2s_channel_disable(rx1);
  i2s_channel_enable(rx1);
  i2s_channel_enable(rx0);
  resyncs++;
  needRecal = true;  // the start offset may have changed: the dashboard asks for a fresh clap
}

// Core 0: drain both ports every frame so their DMA never overflows (an overflow on one port
// only would break the alignment), convert to float, apply the calibrated port offset.
static void readerTask(void*) {
  uint32_t seenOvf = 0;
  static float dcX[4] = {0, 0, 0, 0}, dcY[4] = {0, 0, 0, 0};
  for (;;) {
    size_t got0 = 0, got1 = 0;
    esp_err_t e0 = i2s_channel_read(rx0, raw0, sizeof(raw0), &got0, pdMS_TO_TICKS(200));
    esp_err_t e1 = i2s_channel_read(rx1, raw1, sizeof(raw1), &got1, pdMS_TO_TICKS(200));
    uint32_t ovf = ovf0 + ovf1;
    if (e0 != ESP_OK || e1 != ESP_OK || got0 != sizeof(raw0) || got1 != sizeof(raw1) || ovf != seenOvf) {
      // Either port lost or is missing samples: the pair is no longer aligned. Throw this frame
      // away and restart both ports rather than feed misaligned audio to the bearing.
      if (got0 != sizeof(raw0) || got1 != sizeof(raw1)) shortReads++;
      lastE0 = e0; lastE1 = e1; lastGot0 = got0; lastGot1 = got1;
      seenOvf = ovf;
      restartI2S();
      continue;
    }
    goodFrames++;
    int idx;
    bool have = xQueueReceive(freeQ, &idx, 0) == pdTRUE;
    if (!have) droppedFrames++;
    // offset > 0: port 0 hears an event 'offset' samples later than port 1 -> delay port 1.
    const float gain = powf(10.0f, micGainDb / 20.0f);
    int off = portOffset;
    int d0 = off < 0 ? -off : 0, d1 = off > 0 ? off : 0;
    if (d0 >= kMaxDelay) d0 = kMaxDelay - 1;
    if (d1 >= kMaxDelay) d1 = kMaxDelay - 1;
    for (int n = 0; n < FRAME_N; n++) {
      float v[4] = {(raw0[2 * n] >> 8) / 8388608.0f, (raw0[2 * n + 1] >> 8) / 8388608.0f,
                    (raw1[2 * n] >> 8) / 8388608.0f, (raw1[2 * n + 1] >> 8) / 8388608.0f};
      // DC blocker (one-pole high-pass, ~40 Hz) then the digital boost. Same filter on all 4 mics,
      // so the time differences between them (the bearing) are unchanged.
      for (int m = 0; m < 4; m++) {
        float y = v[m] - dcX[m] + 0.995f * dcY[m];
        dcX[m] = v[m];
        dcY[m] = y;
        v[m] = gain * y;
      }
      for (int m = 0; m < 4; m++) dline[m][dpos] = v[m];
      if (have) {
        int p0 = (dpos - d0 + kMaxDelay) % kMaxDelay, p1 = (dpos - d1 + kMaxDelay) % kMaxDelay;
        frames[idx][0][n] = dline[0][p0];
        frames[idx][1][n] = dline[1][p0];
        frames[idx][2][n] = dline[2][p1];
        frames[idx][3][n] = dline[3][p1];
      }
      dpos = (dpos + 1) % kMaxDelay;
    }
    if (have) xQueueSend(fullQ, &idx, 0);
  }
}

// ---------------- Turret ----------------
static float panCmd = PAN_CENTER_DEG, tiltCmd = TILT_LEVEL_DEG + 10;
static float panNow = PAN_CENTER_DEG, tiltNow = TILT_LEVEL_DEG + 10;
static bool flipped = false;
static uint32_t lastServoMoveMs = 0;

static void servoWrite(int pin, float deg) {
#if !USE_TURRET
  (void)pin; (void)deg;
  return;  // turret disabled: no servo PWM
#endif
  if (deg < 0) deg = 0;
  if (deg > 180) deg = 180;
  float us = SERVO_MIN_US + deg / 180.0f * (SERVO_MAX_US - SERVO_MIN_US);
  ledcWrite(pin, (uint32_t)(us / 20000.0f * 16383.0f));
}

static float wrap180(float a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

// Aim at an array-frame direction. Parallax: assume the source is ASSUMED_RANGE_M away.
static void aimAtRange(float azDeg, float elDeg, float rangeM) {
  float az = azDeg * (float)M_PI / 180, el = elDeg * (float)M_PI / 180;
  float vx = rangeM * cosf(el) * cosf(az) - TURRET_DX_M;
  float vy = rangeM * cosf(el) * sinf(az) - TURRET_DY_M;
  float vz = rangeM * sinf(el) - TURRET_DZ_M;
  float taz = atan2f(vy, vx) * 180 / (float)M_PI;
  float tel = atan2f(vz, sqrtf(vx * vx + vy * vy)) * 180 / (float)M_PI;
  if (tel < 0) tel = 0;
  float rel = wrap180(taz);
  // Hysteresis around +/-90 deg so the turret does not flip back and forth.
  if (FLIP_OVER) flipped = flipped ? fabsf(rel) > 80 : fabsf(rel) > 100;
  float pan, tilt;
  if (flipped) {
    pan = rel > 0 ? rel - 180 : rel + 180;
    tilt = 180 - tel;
  } else {
    pan = rel < -90 ? -90 : (rel > 90 ? 90 : rel);
    tilt = tel;
  }
  panCmd = PAN_CENTER_DEG + (PAN_INVERT ? -pan : pan);
  tiltCmd = TILT_LEVEL_DEG + (TILT_INVERT ? -tilt : tilt);
}

static void aimAt(float azDeg, float elDeg) { aimAtRange(azDeg, elDeg, ASSUMED_RANGE_M); }

static void servoStep() {
  float dp = panCmd - panNow, dt = tiltCmd - tiltNow;
  const float lim = SERVO_MAX_DEG_PER_STEP;
  dp = dp > lim ? lim : (dp < -lim ? -lim : dp);
  dt = dt > lim ? lim : (dt < -lim ? -lim : dt);
  if (fabsf(dp) > 0.5f || fabsf(dt) > 0.5f) lastServoMoveMs = millis();
  panNow += dp;
  tiltNow += dt;
  servoWrite(PIN_SERVO_PAN, panNow);
  servoWrite(PIN_SERVO_TILT, tiltNow);
}

static void park() {
  panCmd = PAN_CENTER_DEG;
  tiltCmd = TILT_LEVEL_DEG + 10;
  flipped = false;
}

// ---------------- Laser and buzzer ----------------
static uint32_t beepUntil = 0;
static void beep(int ms) {
  ledcWriteTone(PIN_BUZZER, 2700);
  beepUntil = millis() + ms;
}
static void laser(bool on) { digitalWrite(PIN_LASER, on ? HIGH : LOW); }

// ---------------- Calibration ----------------
// Clap ~1 m straight out in front of the centre mic (mic2), at the same height. The three corner
// mics (mic0, mic1, mic3) are then equidistant, so the lag between port 0 (mic0, mic1) and port 1's
// corner mic (mic3) is the port start offset.
static void runCalibration() {
#if NET_ENABLED
  {
    char nj[80];
    snprintf(nj, sizeof(nj), "{\"post\":\"%c\",\"msg\":\"calib_start\"}", (char)MIC_LAYOUT);
    netPublish(nj);
  }
#endif
  Serial.println("{\"msg\":\"CALIBRATE: clap once ~1 m straight in front of the centre mic, same height\"}");
  float bestE = 0;
  static float b0[FRAME_N], b1[FRAME_N], b2[FRAME_N], b3[FRAME_N];
  uint32_t t0 = millis();
  while (millis() - t0 < 3000) {
    int idx;
    if (xQueueReceive(fullQ, &idx, pdMS_TO_TICKS(100)) != pdTRUE) continue;
    float e = 0;
    for (int n = 0; n < FRAME_N; n++) e += frames[idx][0][n] * frames[idx][0][n];
    if (e > bestE) {
      bestE = e;
      memcpy(b0, frames[idx][0], sizeof(b0));
      memcpy(b1, frames[idx][1], sizeof(b1));
      memcpy(b2, frames[idx][2], sizeof(b2));
      memcpy(b3, frames[idx][3], sizeof(b3));
    }
    xQueueSend(freeQ, &idx, 0);
  }
  // Port 1's corner mic: mic3 on the post A box, mic2 on the post B box (the other one is the centre mic).
  const float* bc = (MIC_LAYOUT == 'B') ? b2 : b3;
  int l2 = doa.rawLag(b0, bc, 200), l3 = doa.rawLag(b1, bc, 200);  // both corner-to-corner
  int newOff = portOffset + l2;
  bool agree = abs(l2 - l3) <= 2;
  Serial.printf("{\"msg\":\"calib lag mic0-corner %d, mic1-corner %d -> port offset %d%s\"}\n", l2, l3, newOff,
                agree ? "" : " (mics disagree: clap was not centred, try again)");
#if NET_ENABLED
  {
    char nj[200];
    snprintf(nj, sizeof(nj), "{\"post\":\"%c\",\"msg\":\"calib\",\"ok\":%d,\"lag1\":%d,\"lag2\":%d,\"off\":%d}",
             (char)MIC_LAYOUT, agree ? 1 : 0, l2, l3, newOff);
    netPublish(nj);
    delay(50);  // let the net task send it before telemetry overwrites it
  }
#endif
  if (agree && abs(newOff) < kMaxDelay) {
    portOffset = newOff;
    prefs.putInt("off", newOff);
    needRecal = false;
    beep(120);
  }
}

// ---------------- DSP task ----------------
static void dspTask(void*) {
  DetResult dr = {0, 0, 0, -120, -1};
  DoaResult dres = {0, 0, 0, 0, false};
  float lastF0 = 0;
  float ux = 1, uy = 0, uz = 0;  // smoothed target direction (unit vector)
  bool haveTarget = false;
  uint32_t lastDroneMs = 0, lastTelem = 0, laserTestUntil = 0, lastAnyMs = 0, lastEasy = 0;
  bool anyTracking = false;
  uint32_t acquireMs = 0;
  bool fbLock = false;  // locked straight ahead by the fallback, not from a measured bearing
  uint32_t lastLinkSend = 0;
  float triRange = 0, triMiss = 0;  // post A: smoothed two-post range and ray miss distance
  bool triOk = false;
  const char* linkNote = "";
  float peakDb = -120;
  float cpuMs = 0;
  float rms[4] = {0, 0, 0, 0};  // per-mic level, for the wiring check (tap each mic)
  static float mono[FRAME_N];

  for (;;) {
    if (wantCalib) {
      wantCalib = false;
      runCalibration();
    }
    int idx;
    if (xQueueReceive(fullQ, &idx, portMAX_DELAY) != pdTRUE) continue;
    uint32_t tStart = micros();
    const float* x[4] = {frames[idx][0], frames[idx][1], frames[idx][2], frames[idx][3]};

    // Once the detector has a rotor, steer the bearing (and its coherence score) to its harmonics.
    doa.setF0((state == ACQUIRE || state == LOCKED) ? lastF0 : 0);
    static uint32_t frameNo = 0;
    static float doaMs = 0;
    if (frameNo++ % DOA_EVERY_N == 0) {
      uint32_t t0 = micros();
      dres = doa.process(x);
      doaMs = 0.8f * doaMs + 0.2f * (micros() - t0) / 1000.0f;
    }
    lastDoaMs = doaMs;
    for (int m = 0; m < 4; m++) {
      float e = 0;
      for (int n = 0; n < FRAME_N; n++) e += x[m][n] * x[m][n];
      rms[m] = 0.7f * rms[m] + 0.3f * sqrtf(e / FRAME_N);
    }
    for (int m = 0; m < 4; m++) peakDb = fmaxf(peakDb, 20 * log10f(rms[m] + 1e-9f));  // claps show up
    for (int n = 0; n < FRAME_N; n++) mono[n] = 0.25f * (x[0][n] + x[1][n] + x[2][n] + x[3][n]);
    bool fresh = det.push(mono, &dr);
    if (fresh) lastF0 = dr.f0_hz;
    xQueueSend(freeQ, &idx, 0);

    if (rawMode) {
      const int16_t* p;
      int n = det.newSamples(&p);
      uint8_t hdr[4] = {0xA5, 0x5A, (uint8_t)(n & 0xFF), (uint8_t)(n >> 8)};
      Serial.write(hdr, 4);
      Serial.write((const uint8_t*)p, n * 2);
    }

    uint32_t now = millis();
    bool servoQuiet = !USE_TURRET || now - lastServoMoveMs > SERVO_QUIET_MS;

    // ---- State machine ----
    if (fresh) {
      bool loud = dr.level_db > DET_MIN_LEVEL_DB;
      bool drone = dr.prob >= DET_ON_PROB || ((state == ACQUIRE || state == LOCKED) && dr.prob >= DET_OFF_PROB);
      if (drone) lastDroneMs = now;
      if (!drone && now - lastDroneMs > TRACK_LOST_MS) {
        if (state == LOCKED || state == ACQUIRE) park();
        state = loud ? CLUTTER : IDLE;
        if (!anyMode) { haveTarget = false; fbLock = false; }  // in "any sound" mode the target is kept by the block below
      } else if (drone && state != LOCKED) {
        if (state != ACQUIRE) acquireMs = now;
        state = ACQUIRE;
      }
    }
    if (wantAnyOff) {
      wantAnyOff = false;
      anyTracking = false;
      if (state != LOCKED) { haveTarget = false; park(); }
    }
    // "Any sound" mode: a loud sound with a trustworthy bearing counts as a target too.
    bool anyHit = anyMode && dres.valid && servoQuiet && dr.level_db > ANY_MIN_DB;
    if (anyHit) lastAnyMs = now;
    anyTracking = anyMode && lastAnyMs && now - lastAnyMs < ANY_HOLD_MS;
    if ((state == ACQUIRE || state == LOCKED || anyHit) && dres.valid && servoQuiet) {
      float ce = cosf(dres.el_deg * (float)M_PI / 180);
      float nx = ce * cosf(dres.az_deg * (float)M_PI / 180), ny = ce * sinf(dres.az_deg * (float)M_PI / 180);
      float nz = sinf(dres.el_deg * (float)M_PI / 180);
      const float a = haveTarget ? 0.4f : 1.0f;
      ux += a * (nx - ux);
      uy += a * (ny - uy);
      uz += a * (nz - uz);
      float nrm = sqrtf(ux * ux + uy * uy + uz * uz) + 1e-9f;
      ux /= nrm;
      uy /= nrm;
      uz /= nrm;
      haveTarget = true;
      fbLock = false;
      if (state == ACQUIRE) {
        state = LOCKED;
        beep(80);
      }
    }
    // Drone confirmed but the mics can't agree on a direction: assume it is in front.
    if (state == ACQUIRE && !haveTarget && now - acquireMs > FRONT_FALLBACK_MS) {
      ux = cosf(AIM_FRONT_EL_DEG * (float)M_PI / 180);
      uy = 0;
      uz = sinf(AIM_FRONT_EL_DEG * (float)M_PI / 180);
      haveTarget = true;
      fbLock = true;
      state = LOCKED;
      beep(80);
    }
    float tAz = atan2f(uy, ux) * 180 / (float)M_PI, tEl = asinf(uz) * 180 / (float)M_PI;
    if (tAz < 0) tAz += 360;

    // ---- Two-post link (post A only): cross my bearing with post B's to get the real position and range ----
    float aimAz = tAz, aimEl = tEl, aimR = ASSUMED_RANGE_M;
    triOk = false;
    LinkPkt pbNet = {};
    bool pbSeen = false;
    uint32_t pbAge = 0;
    TriResult trNet = {false, 0, 0, 0, 0, 0, 0};
#if LINK_ENABLED
    {
      LinkPkt pb;
      uint32_t age = 0;
      if (!linkUp) linkNote = "link OFF";
      else if (!(pbSeen = linkGet(&pb, &age))) linkNote = "post B not heard";
      else if (age > LINK_MAX_AGE_MS) linkNote = "post B silent";
      else if (!(pb.flags & LINK_DRONE)) linkNote = "post B hears no drone";
      else if (!(pb.flags & LINK_VALID)) linkNote = "post B has no direction";
      else if (!((state == LOCKED || anyTracking) && haveTarget && !fbLock)) linkNote = "waiting for own direction";
      else {
        float azA = tAz > 180 ? tAz - 360 : tAz;
        TriResult tr = triangulate(azA, tEl, pb.az, pb.el, POST_B_FWD_M, POST_B_RIGHT_M, POST_B_UP_M, POST_B_YAW_DEG,
                                   LINK_MIN_ANGLE_DEG, LINK_MAX_RANGE_M);
        trNet = tr;
        if (!tr.ok) linkNote = "rays too parallel / behind";
        else if (tr.miss > LINK_MAX_MISS_M + 0.1f * tr.range) linkNote = "posts disagree";
        else {
          triOk = true;
          triRange = triRange > 0 ? triRange + 0.3f * (tr.range - triRange) : tr.range;
          triMiss = tr.miss;
          aimAz = atan2f(tr.y, tr.x) * 180 / (float)M_PI;
          aimEl = atan2f(tr.z, sqrtf(tr.x * tr.x + tr.y * tr.y)) * 180 / (float)M_PI;
          aimR = triRange;
          static char fixBuf[48];
          snprintf(fixBuf, sizeof(fixBuf), "2-post fix: range %.1f m, miss %.2f m", triRange, triMiss);
          linkNote = fixBuf;
        }
      }
      if (!triOk) triRange = 0;
      if (pbSeen) { pbNet = pb; pbAge = age; }
    }
#endif
    // ---- Two-post link: send my bearing to the other post ----
#if LINK_ENABLED
    if (now - lastLinkSend >= LINK_SEND_MS) {
      lastLinkSend = now;
      uint8_t fl = 0;
      if (haveTarget && !fbLock && (state == ACQUIRE || state == LOCKED || anyTracking)) fl |= LINK_VALID;
      if (state == ACQUIRE || state == LOCKED || anyTracking) fl |= LINK_DRONE;
      linkSend(fl, tAz > 180 ? tAz - 360 : tAz, tEl, dres.confidence, dr.prob, dr.level_db);
    }
#endif
    // ---- Laptop stream: this post's own raw bearing (the laptop does the 2-post maths) ----
#if NET_ENABLED
    static uint32_t lastNet = 0, netN = 0;
    if (now - lastNet >= NET_SEND_MS) {
      lastNet = now;
      bool trk = (state == ACQUIRE || state == LOCKED || anyTracking);
      bool okB = trk && haveTarget && !fbLock;
      // Confidence 0-100: is it a drone (p; 1 in test mode) x do the mics agree on where (coherence).
      static float confS = 0;
      float cohN = dres.valid ? fminf(1.0f, dres.confidence / 0.8f) : 0.0f;
      float isDrone = anyTracking && state != LOCKED ? 1.0f : dr.prob;
      // Raw bearing far off the track = reflection/clutter: it does not raise the confidence.
      float sAz = tAz > 180 ? tAz - 360 : tAz, rAz = dres.az_deg > 180 ? dres.az_deg - 360 : dres.az_deg;
      float jump = fabsf(wrap180(rAz - sAz)) + fabsf(dres.el_deg - tEl);
      if (okB && dres.valid && jump > NET_MAX_JUMP_DEG) cohN = 0;
      confS += 0.3f * (100.0f * isDrone * (okB ? cohN : 0.0f) - confS);  // smoothed, ~0.3 s
      static uint32_t lockSince = 0;
      bool lockCand = okB && (state == LOCKED || anyTracking) && confS >= NET_MIN_CONF;
      if (!lockCand) lockSince = 0;
      else if (!lockSince) lockSince = now;
      uint32_t lockMs = lockSince ? now - lockSince : 0;
      bool valid = lockCand && lockMs >= NET_MIN_LOCK_MS;
      // Last valid bearing, held so a display can stay smooth through short dropouts.
      static float lAz = 0, lEl = 0;
      static uint32_t lastValid = 0;
      if (valid) { lAz = sAz; lEl = tEl; lastValid = now; }
      const char* label = valid ? (state == LOCKED ? "LOCKED" : "TEST_LOCK")
                        : (state == ACQUIRE || state == LOCKED || anyTracking) ? "ACQUIRING"
                        : state == CLUTTER ? "CLUTTER" : "IDLE";
      char nj[1200];
      snprintf(nj, sizeof(nj),
               "{\"post\":\"%c\",\"label\":\"%s\",\"valid\":%d,\"conf\":%d,\"lock_ms\":%u,"
               "\"laz\":%.1f,\"lel\":%.1f,\"lage\":%d,\"n\":%u,\"t\":%u,\"st\":\"%s\",\"any\":%d,\"p\":%.2f,\"lvl\":%.1f,"
               "\"f0\":%.1f,\"trk\":%d,\"ok\":%d,\"az\":%.1f,\"el\":%.1f,"
               "\"raw_ok\":%d,\"raw_az\":%.1f,\"raw_el\":%.1f,\"coh\":%.2f,"
               "\"mic\":[%.0f,%.0f,%.0f,%.0f],\"gain\":%.0f,\"off\":%d,\"recal\":%d,\"cpu\":%.1f,"
               "\"drop\":%u,\"turret\":%d,\"pan\":%.0f,\"tilt\":%.0f,\"laser\":%d,\"cmd\":\"%c\",\"ncmd\":%u,\"up\":%u,"
               "\"ml\":%.2f,\"h\":%.2f,\"sp\":[",
               (char)MIC_LAYOUT, label, valid ? 1 : 0, (int)lroundf(confS), (unsigned)lockMs, lAz, lEl,
               lastValid ? (int)(now - lastValid) : -1, (unsigned)netN++, (unsigned)now, kStateName[state], anyTracking ? 1 : 0, dr.prob,
               dr.level_db, dr.f0_hz, trk ? 1 : 0, (trk && haveTarget && !fbLock) ? 1 : 0,
               tAz > 180 ? tAz - 360 : tAz, tEl, dres.valid ? 1 : 0, dres.az_deg > 180 ? dres.az_deg - 360 : dres.az_deg,
               dres.el_deg, dres.confidence, 20 * log10f(rms[0] + 1e-9f), 20 * log10f(rms[1] + 1e-9f),
               20 * log10f(rms[2] + 1e-9f), 20 * log10f(rms[3] + 1e-9f), (float)micGainDb, (int)portOffset,
               needRecal ? 1 : 0, cpuMs, (unsigned)droppedFrames, (USE_TURRET && turretEnabled) ? 1 : 0, panNow, tiltNow,
               (laserAlways || now < laserTestUntil || state == LOCKED || anyTracking) ? 1 : 0, netLastCmd, (unsigned)netCmdCount,
               (unsigned)(now / 1000), dr.ml_prob, dr.harmonicity);
      // Spectrum for the spectrogram: 48 log-spaced bands 60 Hz - 8 kHz, dB (from the detector).
      {
        int k = strlen(nj);
        const float* b = det.bands();
        for (int i = 0; i < Detector::kBands && k < (int)sizeof(nj) - 8; i++)
          k += snprintf(nj + k, sizeof(nj) - k, i ? ",%d" : "%d", (int)lroundf(b[i]));
        snprintf(nj + k, sizeof(nj) - k, "]}");
      }
      netPublish(nj);
    }
#endif
    // ---- Actuation ----
    if (wantSweep) {
      wantSweep = false;
      if (USE_TURRET) for (int a = 0; a <= 180; a += 2) { servoWrite(PIN_SERVO_PAN, a); delay(15); }
      if (USE_TURRET) for (int a = 180; a >= 0; a -= 2) { servoWrite(PIN_SERVO_TILT, a); delay(15); }
      park();
    }
    if (wantPark) { wantPark = false; park(); }
    if (wantLaser) { wantLaser = false; laserTestUntil = now + 2000; }
    if (turretEnabled && (state == LOCKED || anyTracking) && haveTarget) aimAtRange(aimAz, aimEl, aimR);
    servoStep();
    // Laser only while locked (and on a test). It blinks while the turret is still slewing.
    if (now < laserTestUntil) laser(true);
    else if (laserAlways || state == LOCKED || anyTracking) laser(true);  // solid while tracking
    else laser(false);
    if (beepUntil && now > beepUntil) { ledcWriteTone(PIN_BUZZER, 0); beepUntil = 0; }

    cpuMs = 0.9f * cpuMs + 0.1f * (micros() - tStart) / 1000.0f;

    // ---- Telemetry ----
    if (!rawMode && !jsonMode && now - lastEasy >= EASY_PRINT_MS) {
      lastEasy = now;
      float m[4];
      for (int i = 0; i < 4; i++) m[i] = 20 * log10f(rms[i] + 1e-9f);
      Serial.printf("%-7s drone %3d%%  sound %4.0f dB  ", kStateName[state], (int)lroundf(dr.prob * 100), dr.level_db);
      if (dres.valid)
        Serial.printf("heard from %5.1f deg (%s), up %2.0f deg  ", dres.az_deg, dirWord(dres.az_deg), dres.el_deg);
      else
        Serial.printf("no clear direction                  ");
      Serial.printf("| pan %3.0f tilt %3.0f %s| mics %.0f %.0f %.0f %.0f dB, loudest %.0f | gain +%.0f | cpu %.0f/21 ms (bearing %.0f) dropped %u%s%s | %s\n",
                    panNow, tiltNow, anyMode ? "[ANY SOUND] " : "", m[0], m[1], m[2], m[3], peakDb,
                    (float)micGainDb, cpuMs, lastDoaMs, (unsigned)droppedFrames,
                    needRecal ? "  (type c to calibrate)" : "", turretEnabled ? "" : "  (turret OFF)", linkNote);
      peakDb = -120;
    }
    if (!rawMode && jsonMode && now - lastTelem >= TELEMETRY_MS) {
      lastTelem = now;
      char buf[900];
      int k = snprintf(buf, sizeof(buf),
                       "{\"st\":\"%s\",\"p\":%.2f,\"ml\":%.2f,\"f0\":%.1f,\"h\":%.2f,\"lvl\":%.1f,"
                       "\"az\":%.1f,\"el\":%.1f,\"coh\":%.2f,\"ok\":%d,\"taz\":%.1f,\"tel\":%.1f,"
                       "\"pan\":%.1f,\"tilt\":%.1f,\"off\":%d,\"cpu\":%.1f,\"drop\":%u,"
                       "\"ovf\":%u,\"short\":%u,\"resync\":%u,\"recal\":%d,"
                       "\"mic\":[%.1f,%.1f,%.1f,%.1f],\"sp\":[",
                       kStateName[state], dr.prob, dr.ml_prob, dr.f0_hz, dr.harmonicity, dr.level_db, dres.az_deg,
                       dres.el_deg, dres.confidence, dres.valid ? 1 : 0, tAz, tEl, panNow, tiltNow, (int)portOffset,
                       cpuMs, (unsigned)droppedFrames, (unsigned)(ovf0 + ovf1), (unsigned)shortReads,
                       (unsigned)resyncs, needRecal ? 1 : 0, 20 * log10f(rms[0] + 1e-9f), 20 * log10f(rms[1] + 1e-9f),
                       20 * log10f(rms[2] + 1e-9f), 20 * log10f(rms[3] + 1e-9f));
      const float* b = det.bands();
      for (int i = 0; i < Detector::kBands && k < (int)sizeof(buf) - 8; i++)
        k += snprintf(buf + k, sizeof(buf) - k, i ? ",%d" : "%d", (int)lroundf(b[i]));
      snprintf(buf + k, sizeof(buf) - k, "]}");
      Serial.println(buf);
    }
  }
}

// ---------------- Arduino entry points ----------------
void setup() {
  Serial.begin(921600);
  Serial.setTxTimeoutMs(0);  // on a power bank nobody reads USB: never wait on it
  delay(300);
  prefs.begin("shabdavedh", false);
  portOffset = prefs.getInt("off", 0);

#if USE_TURRET
  ledcAttach(PIN_SERVO_PAN, 50, 14);
  ledcAttach(PIN_SERVO_TILT, 50, 14);
#endif
  pinMode(PIN_LASER, OUTPUT);
  ledcAttach(PIN_BUZZER, 2700, 8);
  ledcWriteTone(PIN_BUZZER, 0);
  laser(false);
  servoStep();

  Serial.printf("{\"msg\":\"memory: free heap %u, biggest block %u, PSRAM %u (free %u)\"}\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap(), (unsigned)ESP.getPsramSize(),
                (unsigned)ESP.getFreePsram());
  if (!fft_init(DET_NFFT)) fatal("fft_init failed (out of memory?)");
  // FFT self-test: a sine at bin 100 must come out as one clean peak at bin 100, at every size used.
  {
    static const int kSizes[3] = {512, NFFT, DET_NFFT};
    for (int n : kSizes) {
      for (int i = 0; i < n; i++) {
        scratch[2 * i] = cosf(2 * (float)M_PI * 100 * i / n);
        scratch[2 * i + 1] = 0;
      }
      fft_forward(scratch, n);
      float peak = scratch[200], leak = 0;
      for (int k = 0; k < n; k++)
        if (k != 100 && k != n - 100) leak = fmaxf(leak, fabsf(scratch[2 * k]) + fabsf(scratch[2 * k + 1]));
      bool ok = isfinite(peak) && fabsf(peak - n / 2.0f) < 0.01f * n && leak < 0.01f * n;
      Serial.printf("{\"msg\":\"FFT self-test %d points: %s\"}\n", n, ok ? "ok" : "FAILED");
      if (!ok) fatal("FFT self-test failed");
    }
  }
  if (!doa.begin(scratch)) fatal("out of memory in Doa::begin (enable PSRAM?)");
  if (!det.begin(scratch)) fatal("out of memory in Detector::begin");
#ifdef USE_CNN_MODEL
  if (!det.cnnOk()) {
    Serial.printf("{\"msg\":\"CNN OFF: not enough memory (free heap %u, PSRAM %u). Harmonic detector only. "
                  "Fix: Tools > PSRAM > OPI PSRAM (N16R8/N8R8 boards).\"}\n",
                  (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getPsramSize());
  } else {
    uint32_t t0 = micros();
    float err = cnn_selftest();  // same second of audio the notebook scored: answers must match
    Serial.printf("{\"msg\":\"CNN self-test: probability error %.4f (want < 0.01), %.0f ms per inference\"}\n",
                  err, (micros() - t0) / 1000.0f);
    cnn_start_task();
  }
#endif

  freeQ = xQueueCreate(kBufs, sizeof(int));
  fullQ = xQueueCreate(kBufs, sizeof(int));
  for (int i = 0; i < kBufs; i++) xQueueSend(freeQ, &i, 0);

  setupI2S();
#if LINK_ENABLED
  bool linkOk = linkBegin(MIC_LAYOUT);
  Serial.printf("{\"msg\":\"post link (ESP-NOW): %s, free heap %u\"}\n", linkOk ? "up" : "FAILED (running alone)",
                (unsigned)ESP.getFreeHeap());
#endif
#if NET_ENABLED
  {
    bool host = NET_HOST_AP && MIC_LAYOUT == 'A';
    bool ok = netBegin(host);
    Serial.printf("{\"msg\":\"laptop stream: %s Wi-Fi '%s', UDP broadcast port %d: %s\"}\n",
                  host ? "hosting" : "joining", NET_SSID, NET_UDP_PORT, ok ? "started" : "FAILED");
  }
#endif
  xTaskCreatePinnedToCore(readerTask, "reader", 4096, NULL, 10, NULL, 0);
  xTaskCreatePinnedToCore(dspTask, "dsp", 8192, NULL, 5, NULL, 1);
  Serial.printf("{\"msg\":\"ShabdaVedh up. port offset %d, free heap %u, free PSRAM %u\"}\n", (int)portOffset,
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getFreePsram());
  beep(60);
  Serial.printf("Layout %c: box-face triangle, edge %.1f cm, centre mic = %s. az 0 = straight out of the box, 90 = left, 270 = right (seen from behind).\n",
                MIC_LAYOUT, ARRAY_EDGE_M * 100, MIC_LAYOUT == 'B' ? "mic3" : "mic2");
  Serial.printf("POST %c ready. Pins: mics 4/5/6 + 7/15/16, pan 17, tilt 18, laser 8, buzzer 9.\n", MIC_LAYOUT);
  Serial.println("Commands: c calibrate (clap 1 m in front)  a any-sound test  s sweep  p park  l laser  m turret on/off");
  Serial.println("          + / - mic gain  h plain status (now)  j JSON for dashboard");
}

// One command letter, from the Serial Monitor or from the laptop over Wi-Fi.
static void handleCmd(char ch) {
  switch (ch) {
    case 'c': wantCalib = true; break;
    case 's': wantSweep = true; break;
    case 'p': wantPark = true; break;
    case 'm': turretEnabled = !turretEnabled; if (!turretEnabled) wantPark = true; break;
    case 'l': wantLaser = true; break;
    case 'r': rawMode = true; break;
    case 'j': rawMode = false; jsonMode = true; break;
    case 'h': rawMode = false; jsonMode = false; break;
    case '+': if (micGainDb < 48) micGainDb += 6; Serial.printf("mic gain +%.0f dB\n", (float)micGainDb); break;
    case '-': if (micGainDb > 0) micGainDb -= 6; Serial.printf("mic gain +%.0f dB\n", (float)micGainDb); break;
    case 'a':
      anyMode = !anyMode;
      if (!anyMode) wantAnyOff = true;
      Serial.println(anyMode ? "ANY SOUND mode ON: clap or whistle, the turret points at it. Type a to stop."
                             : "ANY SOUND mode OFF: back to drones only.");
      break;
    case 'y': anyMode = true; break;                         // any-sound mode ON (explicit)
    case 'n': if (anyMode) { anyMode = false; wantAnyOff = true; } break;  // any-sound mode OFF
    case 'R': ESP.restart(); break;                          // reboot this post
    case 'L': laserAlways = !laserAlways; break;             // laser always on / back to auto
  }
}

void loop() {
  while (Serial.available()) handleCmd(Serial.read());
  // If no audio arrives for 2 s, say why instead of staying silent.
  static uint32_t lastCheck = 0, lastGood = 0;
  if (millis() - lastCheck > 2000) {
    lastCheck = millis();
    if (goodFrames == lastGood) {
      bool p0 = lastE0 == ESP_OK && lastGot0 == sizeof(raw0);
      bool p1 = lastE1 == ESP_OK && lastGot1 == sizeof(raw1);
      Serial.printf("NO AUDIO: port0 (mics on 4/5/6) %s, port1 (mics on 7/15/16) %s. ",
                    p0 ? "ok" : "MISSING", p1 ? "ok" : "MISSING");
      if (!p0) Serial.print("Check mic wiring SCK=4 WS=5 SD=6, VDD=3V3, GND. ");
      if (p0 && !p1) Serial.print("Check jumper wires GPIO4->GPIO7 and GPIO5->GPIO15, and SD=16. ");
#if NET_ENABLED
      char nj[160];
      snprintf(nj, sizeof(nj), "{\"post\":\"%c\",\"err\":\"NO AUDIO\",\"port0\":%d,\"port1\":%d,\"t\":%u}",
               (char)MIC_LAYOUT, p0 ? 1 : 0, p1 ? 1 : 0, (unsigned)millis());
      netPublish(nj);
#endif
      Serial.println();
    }
    lastGood = goodFrames;
  }
  delay(20);
}
