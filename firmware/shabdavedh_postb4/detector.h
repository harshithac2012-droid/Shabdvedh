// Drone-vs-clutter detector. Runs on a 16 kHz mono stream decimated from the array.
// Stage 1 (always on): harmonic-comb detector. Multirotors produce a stable comb of
// blade-pass harmonics; wind/claps are broadband, speech pitch wanders, generators and
// tractors have their fundamental below 80 Hz.
// Stage 2 (optional, USE_CNN_MODEL): small log-mel CNN trained in Colab (cnn.cpp, cnn_weights.h).
#pragma once
#include <stdint.h>

#include "config.h"

struct DetResult {
  float prob;         // smoothed drone probability 0..1
  float f0_hz;        // estimated blade-pass fundamental
  float harmonicity;  // 0 = noise, 1 = perfect comb
  float level_db;     // dBFS in 80-2000 Hz
  float ml_prob;      // CNN output, -1 if not used
};

class Detector {
 public:
  static const int kBands = 48;
  // scratch must hold 2*DET_NFFT floats; it may be shared with Doa (same task).
  bool begin(float* scratch);
  // False if the CNN could not get its memory; the detector then runs on the harmonic comb alone.
  bool cnnOk() const { return cnnOk_; }
  // Feed one 48 kHz frame (FRAME_N samples). Returns true when a new analysis is ready in *out.
  bool push(const float* x48, DetResult* out);
  // Log-spaced band levels (dB) of the last analysis, for the dashboard spectrogram.
  const float* bands() const { return bands_; }
  // 16 kHz samples produced by the last push() (for the training-data recorder).
  int newSamples(const int16_t** p) const { *p = newBuf_; return newCount_; }

 private:
  static const int kTaps = 31;
  static const int kRing = 16384;  // ~1 s at 16 kHz
  float fir_[kTaps];
  float hist_[kTaps] = {};
  int histPos_ = 0, phase_ = 0;
  int16_t ring_[kRing];
  int ringPos_ = 0;
  int16_t newBuf_[FRAME_N / 3 + 2];
  int newCount_ = 0;
  int frames_ = 0;
  float* fft_ = nullptr;     // DET_NFFT complex (shared scratch)
  float* cum_ = nullptr;     // prefix sum of the power spectrum
  float bands_[kBands] = {};
  float trackF0_ = 0;        // rotor track centre (Hz), after folding x2/x3 family hops
  uint8_t consHist_[6] = {}; // 1 if that analysis agreed with the track
  int consPos_ = 0, misses_ = 0;
  float probSm_ = 0;
  float mlProb_ = -1;
  bool cnnOk_ = false;
  int analyses_ = 0;
  float combScore(float k0, float* expectedOut) const;
  void analyse(DetResult* out);
};
