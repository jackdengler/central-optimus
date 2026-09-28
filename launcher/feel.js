/* =====================================================================
   Feel: synthesized sound + haptics for the Big Type launcher.

   No audio files. Every cue is built with Web Audio at play time, so it
   costs nothing to load and works offline.
     tick  — short bright click (band / strip tap, search launch)
     open  — rising filtered-noise whoosh (app grows out of its band)
     close — soft low thunk (app collapses back)
     tear  — scratchy noise sweep (budget scratch-off reveal)

   iOS: navigator.audioSession.type = "ambient" makes cues respect the
   silent switch and mix with music instead of ducking it. Vibration is
   Android-only on the web (iOS Safari has no Vibration API).
   Sound can be switched off from search ("sound"); stored per device.
   ===================================================================== */

const SOUND_KEY = "co.sound";
let ctx = null;
let noiseBuf = null;

export function soundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0";
  } catch (_) {
    return true;
  }
}

export function setSound(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch (_) {}
}

function audio() {
  if (!soundOn()) return null;
  try {
    if (!ctx) {
      if (navigator.audioSession) navigator.audioSession.type = "ambient";
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch (_) {
    return null;
  }
}

function envGain(ac, t0, peak, attack, decay) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(ac.destination);
  return g;
}

function noise(ac, t0, dur, filterType, f0, f1, peak, attack) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = filterType;
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  src.connect(f).connect(envGain(ac, t0, peak, attack, dur));
  src.start(t0);
  src.stop(t0 + attack + dur + 0.02);
}

function tone(ac, t0, freq, freqEnd, dur, peak, type = "sine") {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  o.connect(envGain(ac, t0, peak, 0.004, dur));
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

const CUES = {
  tick(ac, t) {
    tone(ac, t, 2400, 1800, 0.03, 0.05, "triangle");
    noise(ac, t, 0.02, "highpass", 5000, 7000, 0.03, 0.001);
  },
  open(ac, t) {
    noise(ac, t, 0.32, "bandpass", 500, 3200, 0.07, 0.06);
    tone(ac, t + 0.02, 180, 360, 0.25, 0.035);
  },
  close(ac, t) {
    tone(ac, t, 220, 90, 0.16, 0.08);
    noise(ac, t, 0.12, "lowpass", 1400, 300, 0.035, 0.005);
  },
  tear(ac, t) {
    // A few grainy strokes, like a coin across a scratch card.
    for (let i = 0; i < 3; i++) noise(ac, t + i * 0.07, 0.09, "bandpass", 1800, 4200, 0.05, 0.004);
  },
};

const BUZZ = { tick: 8, open: 12, close: 8, tear: [6, 30, 6, 30, 10] };

/* Play a cue: sound (if on) + vibration (where supported). */
export function feel(name) {
  try {
    navigator.vibrate?.(BUZZ[name] || 8);
  } catch (_) {}
  const ac = audio();
  if (ac && CUES[name]) {
    try {
      CUES[name](ac, ac.currentTime + 0.005);
    } catch (_) {}
  }
}
