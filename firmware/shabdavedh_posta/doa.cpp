#include "doa.h"

#include <math.h>
#include <string.h>

#include "config.h"
#include "dsp_fft.h"

const uint8_t Doa::kPairI[Doa::kPairs] = {0, 0, 0, 1, 1, 2};
const uint8_t Doa::kPairJ[Doa::kPairs] = {1, 2, 3, 2, 3, 3};

static float* allocf(size_t n) { return (float*)calloc(n, sizeof(float)); }

bool Doa::begin(float* scratch) {
  // Box-face "wall" layout (see config.h): x out of the face, y left (seen from behind), z up.
  const float E = ARRAY_EDGE_M, R = E * 0.57735f;  // R = corner to centre
#if MIC_LAYOUT == 'B'
  const float p[4][3] = {
      {0, -E / 2, -R / 2},  // mic0 bottom-right (seen from behind the box)
      {0, 0, R},            // mic1 top
      {0, E / 2, -R / 2},   // mic2 bottom-left (seen from behind the box)
      {0, 0, 0},            // mic3 centre
  };
#else
  const float p[4][3] = {
      {0, -E / 2, -R / 2},  // mic0 bottom-right (seen from behind the box)
      {0, 0, R},            // mic1 top
      {0, 0, 0},            // mic2 centre
      {0, E / 2, -R / 2},   // mic3 bottom-left (seen from behind the box)
  };
#endif
  memcpy(pos, p, sizeof(pos));

  win_ = allocf(FRAME_N);
  work_ = scratch;
  for (int m = 0; m < 4; m++) spec_[m] = allocf(2 * NFFT);
  for (int n = 0; n < FRAME_N; n++) win_[n] = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * n / (FRAME_N - 1));

  kLo_ = (int)ceilf(DOA_FMIN_HZ * NFFT / FS_HZ);
  kHi_ = (int)floorf(DOA_FMAX_HZ * NFFT / FS_HZ);

  const int nAz = (GRID_AZ_MAX - GRID_AZ_MIN) / GRID_AZ_STEP + 1;
  const int nEl = (GRID_EL_MAX - GRID_EL_MIN) / GRID_EL_STEP + 1;
  nAz_ = nAz;
  nDirs_ = nAz * nEl;
  lagTab_ = (int16_t*)calloc((size_t)nDirs_ * kPairs, sizeof(int16_t));
  const int nb = kHi_ - kLo_ + 1;
  gAvg_ = allocf((size_t)kPairs * nb * 2);
  mAvg_ = allocf((size_t)kPairs * nb);
  if (!gAvg_ || !mAvg_ || !win_ || !work_ || !spec_[0] || !spec_[1] || !spec_[2] || !spec_[3] || !lagTab_)
    return false;

  int d = 0;
  for (int ie = 0; ie < nEl; ie++) {
    int el = GRID_EL_MIN + ie * GRID_EL_STEP;
    for (int ia = 0; ia < nAz; ia++, d++) {
      int az = GRID_AZ_MIN + ia * GRID_AZ_STEP;
      float ce = cosf(el * (float)M_PI / 180), se = sinf(el * (float)M_PI / 180);
      float u[3] = {ce * cosf(az * (float)M_PI / 180), ce * sinf(az * (float)M_PI / 180), se};
      for (int q = 0; q < kPairs; q++) {
        const float* pi = pos[kPairI[q]];
        const float* pj = pos[kPairJ[q]];
        // r_ij[l] = sum x_i[n+l] x_j[n] peaks at l = t_i - t_j = (p_j - p_i) . u / c
        float dot = (pj[0] - pi[0]) * u[0] + (pj[1] - pi[1]) * u[1] + (pj[2] - pi[2]) * u[2];
        lagTab_[d * kPairs + q] = (int16_t)lroundf(dot / C_SOUND * FS_HZ * kLagScale);
      }
    }
  }
  return true;
}

void Doa::spectrum(const float* x, float* out) {
  float mean = 0;
  for (int n = 0; n < FRAME_N; n++) mean += x[n];
  mean /= FRAME_N;
  for (int n = 0; n < FRAME_N; n++) {
    out[2 * n] = (x[n] - mean) * win_[n];
    out[2 * n + 1] = 0;
  }
  memset(out + 2 * FRAME_N, 0, sizeof(float) * 2 * (NFFT - FRAME_N));
  fft_forward(out, NFFT);
}

DoaResult Doa::process(const float* const x[4]) {
  DoaResult res = {0, 0, 0, 0, false};
  for (int m = 0; m < 4; m++) spectrum(x[m], spec_[m]);

  // Average the cross-spectra over ~6 frames (EMA). A real source keeps a steady phase
  // between mics, so |mean G| / mean|G| (coherence) stays near 1; wind and sensor noise
  // average away. PHAT weighting is then applied to the averaged spectrum.
  const int nb = kHi_ - kLo_ + 1;
  const float alpha = DOA_AVG_ALPHA;
  float cohSum = 0;
  for (int q = 0; q < kPairs; q++) {
    const float* A = spec_[kPairI[q]];
    const float* B = spec_[kPairJ[q]];
    float* g = gAvg_ + (size_t)q * nb * 2;
    float* mg = mAvg_ + (size_t)q * nb;
    memset(work_, 0, sizeof(float) * 2 * NFFT);
    float num = 0, den = 0;
    for (int k = kLo_; k <= kHi_; k++) {
      int b = k - kLo_;
      // Harmonic mask: 1 within ~1.5 bins of h*f0, DOA_OFF_HARM_W elsewhere.
      float wk = 1.0f;
      if (f0_ > 0) {
        float fk = (float)k * FS_HZ / NFFT, h = roundf(fk / f0_);
        wk = (h >= 1 && fabsf(fk - h * f0_) <= 1.5f * FS_HZ / NFFT) ? 1.0f : DOA_OFF_HARM_W;
      }
      // G = A * conj(B)
      float gr = A[2 * k] * B[2 * k] + A[2 * k + 1] * B[2 * k + 1];
      float gi = A[2 * k + 1] * B[2 * k] - A[2 * k] * B[2 * k + 1];
      g[2 * b] += alpha * (gr - g[2 * b]);
      g[2 * b + 1] += alpha * (gi - g[2 * b + 1]);
      mg[b] += alpha * (sqrtf(gr * gr + gi * gi) - mg[b]);
      gr = g[2 * b];
      gi = g[2 * b + 1];
      float mag2 = gr * gr + gi * gi;
      num += wk * sqrtf(mag2);
      den += wk * mg[b];
      float w = wk / (powf(mag2, 0.5f * PHAT_BETA) + 1e-20f);
      gr *= w;
      gi *= w;
      // Inverse FFT of a Hermitian spectrum via the forward FFT of its conjugate:
      // store conj(G) at k and G at NFFT-k.
      work_[2 * k] = gr;
      work_[2 * k + 1] = -gi;
      work_[2 * (NFFT - k)] = gr;
      work_[2 * (NFFT - k) + 1] = gi;
    }
    cohSum += den > 0 ? num / den : 0;
    fft_forward(work_, NFFT);
    for (int l = -kMaxLag; l <= kMaxLag; l++) {
      int idx = (l + NFFT) % NFFT;
      corr_[q][l + kMaxLag] = work_[2 * idx];
    }
  }

  // Steered response: sum each pair's correlation at the lag that direction predicts.
  int best = 0;
  float bestScore = -1e30f, sum = 0, sum2 = 0;
  for (int d = 0; d < nDirs_; d++) {
    float s = 0;
    const int16_t* lt = &lagTab_[d * kPairs];
    for (int q = 0; q < kPairs; q++) {
      float f = lt[q] * (1.0f / kLagScale) + kMaxLag;
      int i0 = (int)f;
      float fr = f - i0;
      s += corr_[q][i0] * (1 - fr) + corr_[q][i0 + 1] * fr;
    }
    sum += s;
    sum2 += s * s;
    if (s > bestScore) { bestScore = s; best = d; }
  }
  float mean = sum / nDirs_;
  float sd = sqrtf(fmaxf(sum2 / nDirs_ - mean * mean, 0.0f));

  res.az_deg = (float)(GRID_AZ_MIN + (best % nAz_) * GRID_AZ_STEP);
  if (res.az_deg < 0) res.az_deg += 360;  // report 0..360 (270 = right)
  res.el_deg = (float)(GRID_EL_MIN + (best / nAz_) * GRID_EL_STEP);
  res.sharpness = (bestScore - mean) / (sd + 1e-12f);
  res.confidence = cohSum / kPairs;
  res.valid = res.confidence >= DOA_MIN_COHERENCE;
  return res;
}

int Doa::rawLag(const float* a, const float* b, int max_lag) {
  spectrum(a, spec_[0]);
  spectrum(b, spec_[1]);
  memset(work_, 0, sizeof(float) * 2 * NFFT);
  for (int k = kLo_; k <= kHi_; k++) {
    float gr = spec_[0][2 * k] * spec_[1][2 * k] + spec_[0][2 * k + 1] * spec_[1][2 * k + 1];
    float gi = spec_[0][2 * k + 1] * spec_[1][2 * k] - spec_[0][2 * k] * spec_[1][2 * k + 1];
    float w = 1.0f / (sqrtf(gr * gr + gi * gi) + 1e-12f);
    work_[2 * k] = gr * w;
    work_[2 * k + 1] = -gi * w;
    work_[2 * (NFFT - k)] = gr * w;
    work_[2 * (NFFT - k) + 1] = gi * w;
  }
  fft_forward(work_, NFFT);
  int bestL = 0;
  float best = -1e30f;
  for (int l = -max_lag; l <= max_lag; l++) {
    float v = work_[2 * ((l + NFFT) % NFFT)];
    if (v > best) { best = v; bestL = l; }
  }
  return bestL;
}
