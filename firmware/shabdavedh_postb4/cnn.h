// Small drone/clutter CNN trained in Colab (training/shabdavedh_train.ipynb).
// No Edge Impulse or TFLite library: the features (log-mel) and the network (3 conv layers,
// global average pool, sigmoid) are plain C++ here, and the weights come from cnn_weights.h,
// which the notebook writes. The notebook's Python features follow exactly the same steps,
// and cnn_selftest() checks on the device that both give the same answer.
//
// Feature spec v1 (must match the notebook):
//   1 s of 16 kHz int16 audio -> 61 frames of 512 samples, hop 256
//   each frame: subtract its mean, periodic Hann window, 512-point FFT, power
//   40 triangular HTK-mel filters, 80-7000 Hz, 10*log10(E + 1e-10)
//   subtract the mean over the whole 61x40 patch, divide by 20
#pragma once
#include <stdint.h>

#define CNN_SR        16000
#define CNN_SAMPLES   16000   // 1 s window
#define CNN_FRAME     512
#define CNN_HOP       256
#define CNN_FRAMES    61      // 1 + (16000 - 512) / 256
#define CNN_MELS      40
#define CNN_FMIN_HZ   80.0f
#define CNN_FMAX_HZ   7000.0f

// Allocates buffers and builds the mel table. Call once after fft_init().
bool cnn_begin();
// Log-mel features of 16000 samples into feat[CNN_FRAMES * CNN_MELS] (time-major).
void cnn_features(const int16_t* x, float* feat);
// Drone probability 0..1 for 16000 samples.
float cnn_predict(const int16_t* x);
// Runs the test vector stored in cnn_weights.h. Returns |device - notebook| probability error,
// or -1 if no test vector is present.
float cnn_selftest();

// Background operation on the ESP32: the detector hands over the newest second of audio
// (from its ring buffer) and reads back the latest result without waiting.
// On a PC build, submit runs the network at once.
void cnn_start_task();
void cnn_submit(const int16_t* ring, int ringLen, int ringPos);  // copies the last CNN_SAMPLES
float cnn_latest();      // last probability, -1 before the first result
float cnn_last_ms();     // time the last inference took (features + network)
