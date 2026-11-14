// GCC-PHAT / SRP-PHAT direction finding for a flat 4-mic rectangular array.
#pragma once
#include <stdint.h>

struct DoaResult {
  float az_deg;      // 0..360, counter-clockwise from forward (+x) seen from above
  float el_deg;      // up from the table (0..90; a flat array assumes the source is above)
  float confidence;  // mean inter-mic coherence in the band, 0..1 (~0.4 for noise, >0.7 for a real source)
  float sharpness;   // SRP peak-to-mean ratio (diagnostic)
  bool valid;
};

class Doa {
 public:
  // Allocates ~130 KB (spectra, averages, lag table). scratch must hold 2*NFFT floats and may be
  // shared with the detector (both run in the same task). Call fft_init() first.
  bool begin(float* scratch);
  // x[m] points to FRAME_N time-aligned samples for mic m.
  DoaResult process(const float* const x[4]);
  // Blade-pass fundamental from the detector (0 = unknown). While set, bins on the rotor's
  // harmonics dominate both the bearing and the coherence score; everything else is turned down.
  void setF0(float f0_hz) { f0_ = f0_hz; }
  // Lag (samples) that best aligns b onto a, searched over +/-max_lag. Used for the clap calibration:
  // positive result means the event appears later in a than in b.
  int rawLag(const float* a, const float* b, int max_lag);
  // Microphone positions in metres (exposed for tests).
  float pos[4][3];

 private:
  static const int kPairs = 6;
  static const int kMaxLag = 32;  // > 0.2 m diagonal / 343 m/s * 48 kHz = 28 samples
  int nDirs_ = 0;
  float f0_ = 0;
  int kLo_ = 0, kHi_ = 0;
  float* win_ = nullptr;          // FRAME_N Hann window
  float* spec_[4] = {};           // NFFT complex spectra
  float* gAvg_ = nullptr;         // per pair, band bins: running mean of the cross-spectrum (complex)
  float* mAvg_ = nullptr;         // per pair, band bins: running mean of its magnitude
  float* work_ = nullptr;         // NFFT complex scratch (shared)
  float corr_[kPairs][2 * kMaxLag + 1];
  int nAz_ = 0;
  int16_t* lagTab_ = nullptr;     // nDirs_ * kPairs expected lags, samples * kLagScale
  static constexpr float kLagScale = 512.0f;
  static const uint8_t kPairI[kPairs], kPairJ[kPairs];
  void spectrum(const float* x, float* out);
};
