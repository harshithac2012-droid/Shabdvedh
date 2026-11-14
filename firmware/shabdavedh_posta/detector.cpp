#include "detector.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "dsp_fft.h"
#ifdef USE_CNN_MODEL
#include "cnn.h"
#endif

static const float kBinHz = (float)DET_FS_HZ / DET_NFFT;  // 3.9 Hz

bool Detector::begin(float* scratch) {
  // Windowed-sinc low-pass at 7 kHz for the 48 -> 16 kHz decimation.
  const float fc = 7000.0f / FS_HZ;
  float sum = 0;
  for (int i = 0; i < kTaps; i++) {
    int m = i - kTaps / 2;
    float s = (m == 0) ? 2 * fc : sinf(2 * (float)M_PI * fc * m) / ((float)M_PI * m);
    float w = 0.54f - 0.46f * cosf(2 * (float)M_PI * i / (kTaps - 1));
    fir_[i] = s * w;
    sum += fir_[i];
  }
  for (int i = 0; i < kTaps; i++) fir_[i] /= sum;
  fft_ = scratch;
  cum_ = (float*)calloc(DET_NFFT / 2 + 1, sizeof(float));
#ifdef USE_CNN_MODEL
  // The CNN needs ~140 KB. Without PSRAM that may not fit: carry on with the comb alone.
  cnnOk_ = cnn_begin();
#endif
  memset(ring_, 0, sizeof(ring_));
  return fft_ && cum_;
}

bool Detector::push(const float* x, DetResult* out) {
  newCount_ = 0;
  for (int n = 0; n < FRAME_N; n++) {
    hist_[histPos_] = x[n];
    histPos_ = (histPos_ + 1) % kTaps;
    if (++phase_ < 3) continue;
    phase_ = 0;
    float acc = 0;
    for (int i = 0, p = histPos_; i < kTaps; i++, p = (p + 1) % kTaps) acc += fir_[i] * hist_[p];
    float c = acc * 32767.0f;
    int16_t s = (int16_t)(c > 32767 ? 32767 : (c < -32768 ? -32768 : c));
    ring_[ringPos_] = s;
    ringPos_ = (ringPos_ + 1) % kRing;
    newBuf_[newCount_++] = s;
  }
  if (++frames_ < DET_HOP_FRAMES) return false;
  frames_ = 0;
  analyse(out);
  return true;
}

// Harmonic-comb score for fundamental k0 (in bins). Each harmonic slot h*k0 is compared with
// the slot halfway to the next harmonic. A real comb scores ~1 and noise ~0; half the true
// fundamental ~0.5 (every other slot is empty); double it ~0 (its midpoints are full).
float Detector::combScore(float k0, float* expectedOut) const {
  (void)expectedOut;
  const int nBins = DET_NFFT / 2;
  int H = (int)(DET_HARM_MAX_HZ / (k0 * kBinHz));
  if (H > DET_MAX_HARM) H = DET_MAX_HARM;
  if (H < 3) H = 3;
  auto slot = [&](float centre, int w) {
    int c = (int)lroundf(centre), lo = c - w, hi = c + w;
    if (lo < 1) lo = 1;
    if (hi >= nBins) hi = nBins - 1;
    if (hi < lo) return 0.0f;
    return (cum_[hi + 1] - cum_[lo]) / (hi - lo + 1);
  };
  // Energy-weighted contrast times the fraction of slots that hold a clear peak. Both are
  // needed: contrast alone is fooled by half the fundamental, peak counting alone by noise.
  float num = 0, den = 0;
  int hits = 0;
  for (int h = 1; h <= H; h++) {
    int w = 1 + h / 4;
    float eh = slot(h * k0, w);
    // Gap = mean of the slots half a harmonic below and above. Using both sides cancels the
    // downward spectral tilt of wind and rumble, which otherwise looks like a comb at high f0.
    float em = 0.5f * (slot((h - 0.5f) * k0, w) + slot((h + 0.5f) * k0, w));
    num += eh > em ? eh - em : 0;
    den += eh + em;
    if (eh > 4 * em) hits++;
  }
  return den > 0 ? (num / den) * hits / H : 0;
}

void Detector::analyse(DetResult* out) {
  const int nBins = DET_NFFT / 2;
  // Last DET_NFFT samples, oldest first.
  float mean = 0;
  for (int n = 0; n < DET_NFFT; n++) {
    float v = ring_[(ringPos_ - DET_NFFT + n + kRing) % kRing] / 32768.0f;
    fft_[2 * n] = v;
    mean += v;
  }
  mean /= DET_NFFT;
  for (int n = 0; n < DET_NFFT; n++) {
    fft_[2 * n] = (fft_[2 * n] - mean) * (0.5f - 0.5f * cosf(2 * (float)M_PI * n / (DET_NFFT - 1)));
    fft_[2 * n + 1] = 0;
  }
  fft_forward(fft_, DET_NFFT);
  cum_[0] = 0;
  for (int k = 0; k < nBins; k++) {
    cum_[k + 1] = cum_[k] + fft_[2 * k] * fft_[2 * k] + fft_[2 * k + 1] * fft_[2 * k + 1];
  }

  // Band level, dBFS (a full-scale sine reads about -3 dB).
  const float norm = (float)DET_NFFT * DET_NFFT * 3.0f / 8.0f;
  int b0 = (int)(80 / kBinHz), b1 = (int)(2000 / kBinHz);
  float level = 10 * log10f(2 * (cum_[b1 + 1] - cum_[b0]) / norm + 1e-12f);

  // Best comb over fundamentals 80-800 Hz in quarter-bin steps.
  float bestK = 0, bestS = 0;
  for (float k0 = DET_F0_MIN_HZ / kBinHz; k0 <= DET_F0_MAX_HZ / kBinHz; k0 += 0.25f) {
    float s = combScore(k0, nullptr);
    if (s > bestS) { bestS = s; bestK = k0; }
  }
  float f0 = bestK * kBinHz;

  // Machinery check: if a half or a third of the fundamental explains the spectrum just as well
  // AND that sub-fundamental is below the rotor range, it is a generator, tractor or pump.
  // A sub-comb inside the rotor range is normal: a 3-blade prop's shaft line sits at f0/3.
  float machinery = 1.0f;
  for (int d = 2; d <= 3; d++) {
    if (bestK * kBinHz / d >= DET_F0_MIN_HZ) continue;
    if (bestS > 0 && combScore(bestK / d, nullptr) > 0.8f * bestS) machinery = 0.2f;
  }

  // Stability: rotor speed holds within ~15% over half a second; speech pitch does not. The comb's
  // argmax hops between the shaft line and blade-pass harmonics (x2, x3) from one analysis to the
  // next, so fold f0 onto the track's nearest family member before comparing.
  static const float kFam[5] = {1.0f, 2.0f, 0.5f, 3.0f, 1.0f / 3};
  bool consistent = false;
  if (trackF0_ > 0 && f0 > 0) {
    float bestDev = 1e9f, folded = f0;
    for (float r : kFam) {
      float dev = fabsf(logf(f0 / (r * trackF0_)));
      if (dev < bestDev) { bestDev = dev; folded = f0 / r; }
    }
    consistent = bestDev < logf(1.0f + DET_FAMILY_TOL);
    if (consistent) {
      trackF0_ = expf(0.8f * logf(trackF0_) + 0.2f * logf(folded));  // ~0.5 s EMA of the centre
      misses_ = 0;
    } else if (++misses_ >= 3) {
      trackF0_ = f0;  // lost it: restart the track on the current comb
      misses_ = 0;
    }
  } else {
    trackF0_ = f0;
  }
  consHist_[consPos_] = consistent ? 1 : 0;
  consPos_ = (consPos_ + 1) % 6;
  int nCons = 0;
  for (int i = 0; i < 6; i++) nCons += consHist_[i];
  float stab = nCons >= 5 ? 1.0f : (nCons == 4 ? 0.6f : (nCons == 3 ? 0.3f : 0.0f));

  float gate = level > DET_MIN_LEVEL_DB ? 1.0f : 0.0f;
  float p = 1.0f / (1.0f + expf(-12.0f * (bestS - 0.35f))) * stab * machinery * gate;

#ifdef USE_CNN_MODEL
  // Every CNN_EVERY_N-th analysis hand the last second to the CNN task; use its latest answer.
  if (cnnOk_ && analyses_ % CNN_EVERY_N == 0) cnn_submit(ring_, kRing, ringPos_);
  mlProb_ = cnnOk_ ? cnn_latest() : -1;
  if (mlProb_ >= 0) {
    float comb = p, ml = mlProb_;
#if CNN_FUSION == 0
    p = 0.7f * ml * gate + 0.3f * comb;
#elif CNN_FUSION == 1
    float q = 0.6f * ml + 0.4f * comb;
    if (ml > CNN_STRONG && ml > q) q = ml;
    if (comb > 0.9f && ml > 0.3f && comb > q) q = comb;
    p = q * gate;
#else
    p = (ml < CNN_VETO) ? fminf(comb, 0.3f) : comb;
#endif
  }
#endif
  analyses_++;

  probSm_ = 0.5f * probSm_ + 0.5f * p;

  // Dashboard bands: 48 log-spaced bands, 60 Hz - 8 kHz.
  for (int b = 0; b < kBands; b++) {
    float flo = 60.0f * powf(8000.0f / 60.0f, (float)b / kBands);
    float fhi = 60.0f * powf(8000.0f / 60.0f, (float)(b + 1) / kBands);
    int k0 = (int)(flo / kBinHz), k1 = (int)(fhi / kBinHz);
    if (k1 <= k0) k1 = k0 + 1;
    if (k1 > nBins) k1 = nBins;
    bands_[b] = 10 * log10f((cum_[k1] - cum_[k0]) / (k1 - k0) / norm + 1e-14f);
  }

  out->prob = probSm_;
  out->f0_hz = f0;
  out->harmonicity = bestS;
  out->level_db = level;
  out->ml_prob = mlProb_;
}
