#include "config.h"

#ifdef USE_CNN_MODEL
#include "cnn.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "cnn_weights.h"  // written by training/shabdavedh_train.ipynb
#include "dsp_fft.h"

#if CNN_W_VERSION != 1
#error "cnn_weights.h was made for a different feature spec; re-export it from the notebook"
#endif
static_assert(CNN_C1 <= 64 && CNN_C2 <= 64 && CNN_C3 <= 64, "conv widths above 64 need bigger acc[]");
static_assert(CNN_P1_H == (CNN_FRAMES - 2) / 2 && CNN_P1_W == (CNN_MELS - 2) / 2, "shape mismatch");
static_assert(CNN_P2_H == (CNN_P1_H - 2) / 2 && CNN_P2_W == (CNN_P1_W - 2) / 2, "shape mismatch");

#ifdef ESP_PLATFORM
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
static double now_ms() { return esp_timer_get_time() / 1000.0; }
#else
#include <chrono>
static double now_ms() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}
#endif

static const int kBins = CNN_FRAME / 2 + 1;  // 257
static float* s_fft;                          // 2 * CNN_FRAME (complex)
static float* s_win;                          // CNN_FRAME
static float* s_feat;                         // CNN_FRAMES * CNN_MELS
static float* s_p1;                           // conv1 + pool output
static float* s_p2;                           // conv2 + pool output
static int16_t* s_in;                         // window handed to the task
// Mel filters stored sparsely: filter m covers bins [lo[m], lo[m] + n[m]) with weights from wofs[m].
static int s_lo[CNN_MELS], s_n[CNN_MELS], s_wofs[CNN_MELS];
static float* s_w;

static float hz2mel(float f) { return 2595.0f * log10f(1.0f + f / 700.0f); }
static float mel2hz(float m) { return 700.0f * (powf(10.0f, m / 2595.0f) - 1.0f); }

bool cnn_begin() {
  s_fft = (float*)malloc(sizeof(float) * 2 * CNN_FRAME);
  s_win = (float*)malloc(sizeof(float) * CNN_FRAME);
  s_feat = (float*)malloc(sizeof(float) * CNN_FRAMES * CNN_MELS);
  s_p1 = (float*)malloc(sizeof(float) * CNN_P1_H * CNN_P1_W * CNN_C1);
  s_p2 = (float*)malloc(sizeof(float) * CNN_P2_H * CNN_P2_W * CNN_C2);
  s_in = (int16_t*)malloc(sizeof(int16_t) * CNN_SAMPLES);
  s_w = (float*)malloc(sizeof(float) * CNN_MELS * kBins);
  if (!s_fft || !s_win || !s_feat || !s_p1 || !s_p2 || !s_in || !s_w) {
    // Give back whatever we did get, so the rest of the firmware can still use it.
    free(s_fft); free(s_win); free(s_feat); free(s_p1); free(s_p2); free(s_in); free(s_w);
    s_fft = s_win = s_feat = s_p1 = s_p2 = s_w = nullptr;
    s_in = nullptr;
    return false;
  }
  for (int n = 0; n < CNN_FRAME; n++) s_win[n] = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * n / CNN_FRAME);

  float edges[CNN_MELS + 2];
  float m0 = hz2mel(CNN_FMIN_HZ), m1 = hz2mel(CNN_FMAX_HZ);
  for (int i = 0; i < CNN_MELS + 2; i++) edges[i] = mel2hz(m0 + (m1 - m0) * i / (CNN_MELS + 1));
  int used = 0;
  for (int m = 0; m < CNN_MELS; m++) {
    float lo = edges[m], c = edges[m + 1], hi = edges[m + 2];
    int first = -1, last = -1;
    for (int k = 0; k < kBins; k++) {
      float f = (float)k * CNN_SR / CNN_FRAME;
      if (f > lo && f < hi) {
        if (first < 0) first = k;
        last = k;
      }
    }
    s_wofs[m] = used;
    if (first < 0) { s_lo[m] = 0; s_n[m] = 0; continue; }
    s_lo[m] = first;
    s_n[m] = last - first + 1;
    for (int k = first; k <= last; k++) {
      float f = (float)k * CNN_SR / CNN_FRAME;
      s_w[used++] = f <= c ? (f - lo) / (c - lo) : (hi - f) / (hi - c);
    }
  }
  return true;
}

void cnn_features(const int16_t* x, float* feat) {
  double total = 0;
  for (int t = 0; t < CNN_FRAMES; t++) {
    const int16_t* fr = x + t * CNN_HOP;
    float mean = 0;
    for (int n = 0; n < CNN_FRAME; n++) mean += fr[n] / 32768.0f;
    mean /= CNN_FRAME;
    for (int n = 0; n < CNN_FRAME; n++) {
      s_fft[2 * n] = (fr[n] / 32768.0f - mean) * s_win[n];
      s_fft[2 * n + 1] = 0;
    }
    fft_forward(s_fft, CNN_FRAME);
    for (int m = 0; m < CNN_MELS; m++) {
      float e = 0;
      const float* w = s_w + s_wofs[m];
      for (int i = 0; i < s_n[m]; i++) {
        int k = s_lo[m] + i;
        e += w[i] * (s_fft[2 * k] * s_fft[2 * k] + s_fft[2 * k + 1] * s_fft[2 * k + 1]);
      }
      float db = 10.0f * log10f(e + 1e-10f);
      feat[t * CNN_MELS + m] = db;
      total += db;
    }
  }
  float mu = (float)(total / (CNN_FRAMES * CNN_MELS));
  for (int i = 0; i < CNN_FRAMES * CNN_MELS; i++) feat[i] = (feat[i] - mu) / 20.0f;
}

// 3x3 valid convolution (weights in Keras order [ky][kx][ci][co]) + bias + ReLU, then an
// optional 2x2 max-pool (floor), all in one pass so the full-size conv output is never stored.
static void conv3x3(const float* in, int H, int W, int Ci, const float* w, const float* b, int Co,
                    bool pool, float* out) {
  const int Ho = H - 2, Wo = W - 2;
  const int step = pool ? 2 : 1;
  const int Hp = pool ? Ho / 2 : Ho, Wp = pool ? Wo / 2 : Wo;
  float acc[64];
  for (int py = 0; py < Hp; py++) {
    for (int px = 0; px < Wp; px++) {
      float* o = out + (py * Wp + px) * Co;
      for (int co = 0; co < Co; co++) o[co] = 0;  // ReLU output is >= 0, so 0 is a safe max start
      for (int dy = 0; dy < step; dy++) {
        for (int dx = 0; dx < step; dx++) {
          int y = py * step + dy, x = px * step + dx;
          for (int co = 0; co < Co; co++) acc[co] = b[co];
          for (int ky = 0; ky < 3; ky++) {
            for (int kx = 0; kx < 3; kx++) {
              const float* ip = in + ((y + ky) * W + (x + kx)) * Ci;
              const float* wp = w + (ky * 3 + kx) * Ci * Co;
              for (int ci = 0; ci < Ci; ci++) {
                float v = ip[ci];
                const float* wr = wp + ci * Co;
                for (int co = 0; co < Co; co++) acc[co] += v * wr[co];
              }
            }
          }
          for (int co = 0; co < Co; co++)
            if (acc[co] > o[co]) o[co] = acc[co];
        }
      }
    }
  }
}

float cnn_predict(const int16_t* x) {
  cnn_features(x, s_feat);
  conv3x3(s_feat, CNN_FRAMES, CNN_MELS, 1, cnn_c1_w, cnn_c1_b, CNN_C1, true, s_p1);
  conv3x3(s_p1, CNN_P1_H, CNN_P1_W, CNN_C1, cnn_c2_w, cnn_c2_b, CNN_C2, true, s_p2);
  // Last conv without pooling, accumulated straight into the global average.
  float gap[64] = {0};
  const int H3 = CNN_P2_H - 2, W3 = CNN_P2_W - 2;
  float acc[64];
  for (int y = 0; y < H3; y++) {
    for (int xx = 0; xx < W3; xx++) {
      for (int co = 0; co < CNN_C3; co++) acc[co] = cnn_c3_b[co];
      for (int ky = 0; ky < 3; ky++)
        for (int kx = 0; kx < 3; kx++) {
          const float* ip = s_p2 + ((y + ky) * CNN_P2_W + (xx + kx)) * CNN_C2;
          const float* wp = cnn_c3_w + (ky * 3 + kx) * CNN_C2 * CNN_C3;
          for (int ci = 0; ci < CNN_C2; ci++) {
            float v = ip[ci];
            const float* wr = wp + ci * CNN_C3;
            for (int co = 0; co < CNN_C3; co++) acc[co] += v * wr[co];
          }
        }
      for (int co = 0; co < CNN_C3; co++) gap[co] += acc[co] > 0 ? acc[co] : 0;
    }
  }
  float z = cnn_d_b[0];
  for (int co = 0; co < CNN_C3; co++) z += cnn_d_w[co] * gap[co] / (H3 * W3);
  return 1.0f / (1.0f + expf(-z));
}

float cnn_selftest() {
#if CNN_HAS_TESTVEC
  float p = cnn_predict(cnn_test_x);
  return fabsf(p - cnn_test_p);
#else
  return -1;
#endif
}

// ---------------- background task ----------------
static volatile float s_prob = -1;
static volatile float s_ms = 0;

static void run_once() {
  double t0 = now_ms();
  float p = cnn_predict(s_in);
  s_ms = (float)(now_ms() - t0);
  s_prob = p;
}

#ifdef ESP_PLATFORM
static TaskHandle_t s_task = nullptr;
static volatile bool s_busy = false;

static void cnnTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    run_once();
    s_busy = false;
  }
}

void cnn_start_task() {
  // Core 0 at low priority: the I2S reader (priority 10, same core) always pre-empts it,
  // and the DSP task on core 1 never waits for the network.
  xTaskCreatePinnedToCore(cnnTask, "cnn", 6144, NULL, 2, &s_task, 0);
}

void cnn_submit(const int16_t* ring, int ringLen, int ringPos) {
  if (!s_task || s_busy) return;  // still busy with the previous second: skip this one
  for (int i = 0; i < CNN_SAMPLES; i++) s_in[i] = ring[(ringPos - CNN_SAMPLES + i + 2 * ringLen) % ringLen];
  s_busy = true;
  xTaskNotifyGive(s_task);
}
#else
void cnn_start_task() {}
void cnn_submit(const int16_t* ring, int ringLen, int ringPos) {
  for (int i = 0; i < CNN_SAMPLES; i++) s_in[i] = ring[(ringPos - CNN_SAMPLES + i + 2 * ringLen) % ringLen];
  run_once();
}
#endif

float cnn_latest() { return s_prob; }
float cnn_last_ms() { return s_ms; }

#endif  // USE_CNN_MODEL
