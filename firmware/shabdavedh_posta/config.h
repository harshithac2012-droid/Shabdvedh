// ShabdaVedh single-post acoustic drone tracker: build-time configuration.
#pragma once

// ---------------- Audio ----------------
#define FS_HZ          48000     // INMP441 runs fine at 48 kHz; gives ~2 deg TDOA resolution
#define FRAME_N        1024      // samples per channel per frame (21.3 ms)
#define NFFT           2048      // zero-padded FFT size for GCC-PHAT (linear, not circular, correlation)
#define C_SOUND        343.0f    // m/s at ~20 C

// GCC-PHAT band and weighting. Rotor fundamentals (120-450 Hz) are too long-wave
// for a 20 cm array, so bearing comes from the 300-6000 Hz harmonics and motor noise.
#define DOA_FMIN_HZ    300.0f
#define DOA_FMAX_HZ    6000.0f
#define PHAT_BETA      0.7f      // 1.0 = pure PHAT; <1 stops low-SNR bins being boosted (wind)

// ---------------- Array geometry: "wall" layout on the box face ----------------
// The 4 mics are flat on the FRONT FACE of the box (the face is vertical and points at the sky/drone area).
// Seen from BEHIND the box, looking the same way the mics face (this is the turret's view too):
//
//                     mic1 (top)
//                       /\
//                      /  \
//                     / mic2 \        mic2 = exact centre of the triangle
//                    /  (centre)\
//        mic3 (bottom-left) ---- mic0 (bottom-right)
//
// (Seen from IN FRONT of the box, mic0 is bottom-LEFT and mic3 bottom-RIGHT, as in the photo.)
// The 3 outer mics form an equilateral triangle, ARRAY_EDGE_M between each pair (sound hole to sound
// hole). mic2 is at the centre, ARRAY_EDGE_M * 0.57735 (11.55 cm for a 20 cm triangle) from each corner.
// Axes: x = straight out of the box face (azimuth 0), y = left (seen from behind), z = up.
// Azimuth: 0 = straight out, +90 = left, -90 (shown as 270) = right. Elevation: up from level.
// A flat array cannot tell "in front of the box" from "behind it": the code assumes in front.
// Which post's mic numbering: 'A' = mic2 centre, mic3 bottom corner (post A box).
//                            'B' = mic3 centre, mic2 bottom corner (post B box: mic2 and mic3 swapped).
#ifndef MIC_LAYOUT
#define MIC_LAYOUT 'A'
#endif
#define ARRAY_EDGE_M   0.200f    // measure corner to corner (mic0-mic1, mic1-mic3, mic3-mic0); 2 mm ~ 1 deg

// Search grid for SRP-PHAT (steered response over all 6 mic pairs): front half only.
#define GRID_AZ_MIN    -90
#define GRID_AZ_MAX    90
#define GRID_AZ_STEP   2
#define GRID_EL_MIN    -30       // a little below level, up to straight overhead
#define GRID_EL_MAX    90
#define GRID_EL_STEP   5

// ---------------- Detector ----------------
#define DET_FS_HZ      16000     // classifier runs on a 16 kHz decimated mono stream
#define DET_NFFT       4096      // 256 ms window, 3.9 Hz bins: resolves blade-pass harmonics
#define DET_HOP_FRAMES 4         // run the detector every 4 audio frames (~85 ms)
#define DET_F0_MIN_HZ  80.0f
#define DET_F0_MAX_HZ  800.0f     // loaded quads reach 480-600 Hz blade-pass (VolAnti field data)
#define DET_HARM_MAX_HZ 6000.0f   // highest harmonic the comb looks at
#define DET_MAX_HARM   12        // ...and at most this many harmonics (VolAnti uses 12)
#define DET_FAMILY_TOL 0.15f     // f0 may wander this much (after x2, x3 folding) and still count as one rotor
#define DET_ON_PROB    0.70f     // lock when probability exceeds this...
#define DET_OFF_PROB   0.40f     // ...and release below this (hysteresis)
#define DET_MIN_LEVEL_DB -62.0f  // ignore anything quieter than this (dBFS in 80-2000 Hz band)

// Small CNN trained in Colab (training/shabdavedh_train.ipynb).
// Uncomment once the notebook's cnn_weights.h is copied into this folder. No extra library needed.
// The harmonic comb keeps running; CNN_FUSION says how the two are combined.
#ifndef SV_NO_CNN           // build with -DSV_NO_CNN to test the harmonic comb on its own (tests/test_native.cpp)
#define USE_CNN_MODEL       // ON: the trained model cnn_weights.h is in this folder
#endif
#define CNN_EVERY_N    12        // run the CNN every 12th detector analysis (~1 s; was 6, too much CPU with Wi-Fi on)
#define CNN_FUSION     1         // 0 = both must agree   (0.7*CNN + 0.3*comb; neither can lock alone)
                                 // 1 = either strong one (blend, or CNN > CNN_STRONG alone,
                                 //     or comb > 0.9 when the CNN is at least 0.3)
                                 // 2 = CNN as veto       (comb decides; CNN < CNN_VETO blocks a lock)
#define CNN_STRONG     0.90f
#define CNN_VETO       0.20f

// ---------------- Tracking ----------------
#define DOA_AVG_ALPHA  0.3f      // cross-spectrum averaging (~6 frames, ~130 ms)
#define DOA_MIN_COHERENCE 0.55f  // inter-mic coherence needed to trust a bearing (noise sits ~0.4); set from field logs
#define DOA_OFF_HARM_W 0.1f      // weight of bins between rotor harmonics once the detector has an f0
#define TRACK_LOST_MS  1500      // return to idle after this long without a confident detection
#define SERVO_QUIET_MS 150       // ignore bearings while servos are slewing (their whine pollutes the mics)

// ---------------- Turret ----------------
// Turret: 1 = pan + tilt servos move and the laser points (post A). 0 = no servo PWM at all.
// (A dead servo just does not move; nothing waits on it.)
#define USE_TURRET       1
// Servo angle (deg) that points the turret at azimuth 0 / horizontal. Trim after assembly.
#define PAN_CENTER_DEG   90.0f
#define TILT_LEVEL_DEG   0.0f
#define PAN_INVERT       0       // set 1 if the pan servo turns the wrong way
#define TILT_INVERT      0
#define FLIP_OVER        1       // 1: reach rear azimuths by tilting past vertical (needs 180-deg tilt bracket)
#define SERVO_MAX_DEG_PER_STEP 7.0f  // slew limit per 21 ms frame (~330 deg/s, MG996R top speed)
#define SERVO_MIN_US     500
#define SERVO_MAX_US     2500

// Laser position relative to the array centre (metres; x forward, y left, z up) and the range
// we assume for parallax correction. For a table demo the source is ~1-2 m away.
#define TURRET_DX_M     -0.10f   // laser is 10 cm behind the array centre...
#define TURRET_DY_M      0.10f   // laser is 10 cm to the LEFT of the array centre, seen from behind
#define TURRET_DZ_M      0.08f   // ...with the laser ~8 cm above the table
#define ASSUMED_RANGE_M  1.0f

// ---------------- Pins (ESP32-S3-DevKitC-1) ----------------
#define PIN_I2S0_BCLK   4        // I2S0 is clock master
#define PIN_I2S0_WS     5
#define PIN_I2S0_DIN    6
#define PIN_I2S1_BCLK   7        // jumper wire from GPIO4: I2S1 runs as slave on the same clock
#define PIN_I2S1_WS     15       // jumper wire from GPIO5
#define PIN_I2S1_DIN    16
#define PIN_SERVO_PAN   17
#define PIN_SERVO_TILT  18
#define PIN_LASER       8        // laser module via NPN/MOSFET (on only while LOCKED)
#define PIN_BUZZER      9

#define TELEMETRY_MS    100      // JSON line to the dashboard every 100 ms
#define EASY_PRINT_MS   500      // plain-English status line for Serial Monitor every 0.5 s

// "Any sound" test mode (Serial command a): the turret points at ANY loud sound, not only drones.
// Use it to check the mics and turret before testing with drone audio.
#define ANY_MIN_DB      -50.0f   // sound must be louder than this (dBFS, 80-2000 Hz band)
#define ANY_HOLD_MS     2000     // keep pointing this long after the sound stops

// ---------------- Two-post link (ESP-NOW) ----------------
// Post B sends its bearing to post A about 10 times a second; post A crosses the two bearings to find the
// drone's position and range, and aims the turret at that. If the link is down or the posts disagree,
// post A falls back to its own bearing (and ASSUMED_RANGE_M), so it always keeps working alone.
// Measure these with a tape from the CENTRE mic of post A to the CENTRE mic of post B.
#define LINK_ENABLED      0       // OFF: both posts now stream to the laptop instead (see below)
#define POST_B_RIGHT_M    0.80f   // sideways: + = post B is to the RIGHT of post A as seen from the FRONT, - = left
#define POST_B_FWD_M      0.0f    // + = post B's mic face is this far in FRONT of post A's face
#define POST_B_UP_M       0.0f    // + = post B's mics are this much higher than post A's
#define POST_B_YAW_DEG    0.0f    // 0 when both boxes face the same way; + = post B turned toward its left
#define LINK_MAX_AGE_MS   500     // ignore post B's bearing if it is older than this
#define LINK_MIN_ANGLE_DEG 4.0f   // rays closer to parallel than this give no usable range
#define LINK_MAX_RANGE_M  60.0f
#define LINK_MAX_MISS_M   0.4f    // the two rays must pass within this of each other, else they disagree
#define LINK_SEND_MS      100

// ---------------- Laptop stream (both posts) ----------------
// Each post sends its own bearing as one JSON line over UDP; the laptop combines them. See udpstream.h.
#define NET_ENABLED       1
#define NET_HOST_AP       0              // 1: post A creates the Wi-Fi, post B + laptop join it.
                                         // 0: both posts join NET_SSID (e.g. your phone/laptop hotspot)
#define NET_SSID          "XEA-12"    
#define NET_PASS          "CHANGE_ME"     // at least 8 characters
#define NET_CHANNEL       1
#define NET_UDP_PORT      5005           // laptop listens on this UDP port
#define NET_SEND_MS       100            // 10 packets per second per post
// Clean-target label for the laptop. "valid":1 only when ALL hold: drone LOCKED (or a sound in test mode),
// a measured bearing, confidence >= NET_MIN_CONF, and locked for at least NET_MIN_LOCK_MS.
#define NET_MIN_CONF      75             // 0-100 (drone probability x bearing confidence)
#define NET_MIN_LOCK_MS   300
#define NET_MAX_JUMP_DEG  25.0f          // a raw bearing this far from the track is an outlier (not counted)
