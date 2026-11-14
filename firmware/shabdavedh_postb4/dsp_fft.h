// Complex FFT wrapper. Uses Espressif's ESP-DSP (SIMD-optimised on ESP32-S3) when available,
// otherwise a portable radix-2 FFT so the DSP can be unit-tested on a PC.
// Data layout: interleaved complex floats {re0, im0, re1, im1, ...}, in place, natural order out.
#pragma once
#include <math.h>
#include <stdlib.h>

// Post B v2.2: the portable FFT is the default. On the board, ESP-DSP gave garbage for the 2048/4096
// point FFTs and crashed (sharp -inf, Guru Meditation). Define SV_USE_ESP_DSP_FFT to try it again.
#if defined(ESP_PLATFORM) && defined(SV_USE_ESP_DSP_FFT) && __has_include("esp_dsp.h")
#include "esp_dsp.h"
#define SV_USE_ESP_DSP 1
#endif

static inline bool fft_init(int max_n) {
#ifdef SV_USE_ESP_DSP
  static bool done = false;
  if (done) return true;
  done = (dsps_fft2r_init_fc32(NULL, max_n) == ESP_OK);
  return done;
#else
  (void)max_n;
  return true;
#endif
}

static inline void fft_forward(float* d, int n) {
#ifdef SV_USE_ESP_DSP
  dsps_fft2r_fc32(d, n);
  dsps_bit_rev_fc32(d, n);
#else
  // bit reversal
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      float tr = d[2 * i], ti = d[2 * i + 1];
      d[2 * i] = d[2 * j]; d[2 * i + 1] = d[2 * j + 1];
      d[2 * j] = tr; d[2 * j + 1] = ti;
    }
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = -2.0 * M_PI / len;
    float wr = (float)cos(ang), wi = (float)sin(ang);
    for (int i = 0; i < n; i += len) {
      float cr = 1.0f, ci = 0.0f;
      for (int k = 0; k < len / 2; k++) {
        int a = i + k, b = i + k + len / 2;
        float xr = d[2 * b] * cr - d[2 * b + 1] * ci;
        float xi = d[2 * b] * ci + d[2 * b + 1] * cr;
        d[2 * b] = d[2 * a] - xr; d[2 * b + 1] = d[2 * a + 1] - xi;
        d[2 * a] += xr; d[2 * a + 1] += xi;
        float t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
#endif
}
