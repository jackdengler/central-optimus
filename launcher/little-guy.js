// little-guy.js
// Ambient alien creature for the launcher homepage.
// Zero dependencies. ES module. Works with <script type="module">.
//
// Usage:
//   import { mountLittleGuy } from './little-guy.js';
//   mountLittleGuy(document.getElementById('lil-guy'));
//
// Behaviors:
//   • Breathing + figure-8 float
//   • Randomized blinks (single / double / triple / sleepy)
//   • Idle glances when nothing is happening
//   • Tracks cursor / finger with eased gaze when within ~360px
//   • Subtle head tilt toward the pointer
//   • Mood changes:
//       – Surprised "o" mouth when pointer arrives fast
//       – Happy smile + intensified blush after ~2s of attention
//   • Tap → squash-and-stretch bounce + sparkle burst
//   • Respects prefers-reduced-motion
//
// Returns { destroy() } for teardown.

export function mountLittleGuy(target, opts = {}) {
  if (!target) throw new Error('mountLittleGuy: target element required');

  const {
    size = 220,
    trackRange = 360,
  } = opts;

  // ---- Inject scoped keyframes & styles once ----
  const STYLE_ID = 'little-guy-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes lg-float {
        0%   { transform: translate(0, 0); }
        25%  { transform: translate(4px, -6px); }
        50%  { transform: translate(0, -3px); }
        75%  { transform: translate(-4px, -6px); }
        100% { transform: translate(0, 0); }
      }
      @keyframes lg-antenna-l { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
      @keyframes lg-antenna-c { 0%,100%{transform:rotate(-2deg)} 50%{transform:rotate(2deg)} }
      @keyframes lg-antenna-r { 0%,100%{transform:rotate(4deg)} 50%{transform:rotate(-4deg)} }
      @keyframes lg-pulse { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.25)} }
      @keyframes lg-halo  { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:.6;transform:scale(1.4)} }
      @keyframes lg-hue   { 0%,100%{filter:hue-rotate(0deg)} 50%{filter:hue-rotate(25deg)} }
      .lg-body-squash { animation: lg-squash .5s ease-out; transform-origin: 60px 90px; transform-box: fill-box; }
      @keyframes lg-squash {
        0%{transform:scale(1,1)} 30%{transform:scale(1.15,.85)}
        60%{transform:scale(.92,1.08)} 100%{transform:scale(1,1)}
      }
      .lg-burst {
        position:absolute; width:6px; height:6px; pointer-events:none;
        background: radial-gradient(circle, #fff 0%, #E8D4FF 40%, transparent 70%);
        border-radius:50%; animation: lg-burst .8s ease-out forwards;
      }
      @keyframes lg-burst {
        0%{transform:translate(0,0) scale(.5); opacity:1}
        100%{transform:translate(var(--dx),var(--dy)) scale(0); opacity:0}
      }
      @media (prefers-reduced-motion: reduce) {
        .lg-wrap, .lg-wrap * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
      }
      .lg-bubble {
        position: absolute;
        left: 50%;
        bottom: 100%;
        transform: translate(-50%, -4px) scale(.92);
        opacity: 0;
        pointer-events: none;
        padding: 6px 11px;
        border-radius: 14px;
        background: linear-gradient(180deg, rgba(38,24,70,.96), rgba(22,14,48,.96));
        color: #F5E8FF;
        font: 500 12.5px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif;
        max-width: 220px;
        text-align: center;
        white-space: normal;
        box-shadow: 0 8px 28px rgba(80, 50, 160, .35), 0 0 0 1px rgba(232, 212, 255, .14);
        transition: opacity 220ms ease, transform 260ms cubic-bezier(.2,.8,.2,1);
        z-index: 3;
        margin-bottom: 6px;
      }
      .lg-bubble::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: rgba(22, 14, 48, .96);
        filter: drop-shadow(0 2px 2px rgba(80, 50, 160, .25));
      }
      .lg-bubble.lg-bubble-show {
        opacity: 1;
        transform: translate(-50%, -10px) scale(1);
      }
    `;
    document.head.appendChild(style);
  }

  // ---- Ensure target is positioned so bursts anchor correctly ----
  const targetPos = getComputedStyle(target).position;
  if (targetPos === 'static') target.style.position = 'relative';

  // ---- Build wrapper ----
  const wrap = document.createElement('div');
  wrap.className = 'lg-wrap';
  Object.assign(wrap.style, {
    width: `${size}px`,
    height: `${size}px`,
    display: 'inline-block',
    transform: 'rotate(0deg)',
    transition: 'transform 700ms cubic-bezier(.2,.8,.2,1)',
    animation: 'lg-float 7s ease-in-out infinite',
    filter: 'drop-shadow(0 0 32px rgba(168, 142, 224, 0.45))',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    cursor: 'pointer',
    position: 'relative',
  });

  wrap.innerHTML = `
    <svg viewBox="0 0 120 140" width="100%" height="100%" overflow="visible">
      <defs>
        <linearGradient id="lg-headGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="#EAD7FF" />
          <stop offset="35%" stop-color="#C4A9F0" />
          <stop offset="70%" stop-color="#9876D4" />
          <stop offset="100%" stop-color="#6E4DB0" />
        </linearGradient>
        <radialGradient id="lg-orbGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stop-color="#FFF0FF" stop-opacity="1" />
          <stop offset="50%" stop-color="#B89BE8" stop-opacity="0.6" />
          <stop offset="100%" stop-color="#B89BE8" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="lg-rimLight" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%"  stop-color="#FFD4F0" stop-opacity="0.5" />
          <stop offset="50%" stop-color="#D4E0FF" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#FFE0C4" stop-opacity="0.25" />
        </linearGradient>
        <radialGradient id="lg-blush" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stop-color="#F7A8D0" stop-opacity="0.7" />
          <stop offset="100%" stop-color="#F7A8D0" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="lg-eyeGrad" cx="40%" cy="35%" r="70%">
          <stop offset="0%"  stop-color="#3A2B5C" />
          <stop offset="60%" stop-color="#1A0F2E" />
          <stop offset="100%" stop-color="#0A0618" />
        </radialGradient>
        <radialGradient id="lg-innerGlow" cx="50%" cy="60%" r="55%">
          <stop offset="0%"  stop-color="#E8D4FF" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#E8D4FF" stop-opacity="0" />
        </radialGradient>
        <clipPath id="lg-eye-clip-l"><ellipse cx="48" cy="66" rx="7.5" ry="9" transform="rotate(-8 48 66)" /></clipPath>
        <clipPath id="lg-eye-clip-r"><ellipse cx="72" cy="66" rx="7.5" ry="9" transform="rotate(8 72 66)" /></clipPath>
      </defs>

      <ellipse cx="60" cy="128" rx="30" ry="4" fill="url(#lg-orbGlow)" opacity="0.55">
        <animate attributeName="rx" values="30;24;30" dur="3.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.55;0.3;0.55" dur="3.8s" repeatCount="indefinite" />
      </ellipse>

      <g data-body style="transform-origin: 60px 80px">
        <g>
          <animateTransform attributeName="transform" type="scale"
            values="1 1; 1.025 0.98; 1 1" dur="3.8s"
            repeatCount="indefinite" additive="sum" />

          <g style="transform-origin: 40px 34px; animation: lg-antenna-l 3s ease-in-out infinite;">
            <path d="M40 36 Q34 22 36 12" fill="none" stroke="#9A80D4" stroke-width="1.6" stroke-linecap="round" />
            <circle cx="35.5" cy="10" r="8" fill="url(#lg-orbGlow)" opacity="0.4" style="animation: lg-halo 2.6s ease-in-out infinite;" />
            <circle cx="35.5" cy="10" r="4" fill="url(#lg-orbGlow)" style="animation: lg-pulse 2.2s ease-in-out infinite;" />
            <circle cx="35.5" cy="10" r="1.8" fill="#FFF0FF" />
          </g>
          <g style="transform-origin: 60px 32px; animation: lg-antenna-c 3.4s ease-in-out infinite;">
            <path d="M60 32 Q60 14 60 4" fill="none" stroke="#9A80D4" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="60" cy="3" r="9" fill="url(#lg-orbGlow)" opacity="0.35" style="animation: lg-halo 3s ease-in-out infinite; animation-delay: -0.4s;" />
            <circle cx="60" cy="3" r="4.5" fill="url(#lg-orbGlow)" style="animation: lg-pulse 2.6s ease-in-out infinite; animation-delay: -0.4s;" />
            <circle cx="60" cy="3" r="2" fill="#FFF0FF" />
          </g>
          <g style="transform-origin: 80px 34px; animation: lg-antenna-r 3s ease-in-out infinite;">
            <path d="M80 36 Q86 22 84 12" fill="none" stroke="#9A80D4" stroke-width="1.6" stroke-linecap="round" />
            <circle cx="84.5" cy="10" r="8" fill="url(#lg-orbGlow)" opacity="0.4" style="animation: lg-halo 2.6s ease-in-out infinite; animation-delay: -0.8s;" />
            <circle cx="84.5" cy="10" r="4" fill="url(#lg-orbGlow)" style="animation: lg-pulse 2.2s ease-in-out infinite; animation-delay: -0.8s;" />
            <circle cx="84.5" cy="10" r="1.8" fill="#FFF0FF" />
          </g>

          <!-- Body (teardrop, matches head material) -->
          <g style="transform-origin: 60px 115px;">
            <ellipse cx="60" cy="118" rx="20" ry="14" fill="url(#lg-orbGlow)" opacity="0.35">
              <animate attributeName="opacity" values="0.35;0.55;0.35" dur="3.8s" repeatCount="indefinite" />
            </ellipse>
            <path d="M48 100 C 44 110, 44 124, 60 130 C 76 124, 76 110, 72 100 Z" fill="url(#lg-headGrad)" />
            <path d="M48 100 C 44 110, 44 124, 60 130 C 76 124, 76 110, 72 100 Z" fill="url(#lg-innerGlow)">
              <animate attributeName="opacity" values="0.6;1;0.6" dur="3.8s" repeatCount="indefinite" />
            </path>
            <g style="animation: lg-hue 8s ease-in-out infinite; mix-blend-mode: screen;">
              <path d="M48 100 C 44 110, 44 124, 60 130 C 76 124, 76 110, 72 100 Z" fill="url(#lg-rimLight)" />
            </g>
          </g>

          <!-- Head -->
          <path d="M60 28 C 90 28, 96 56, 92 76 C 88 92, 76 102, 60 102 C 44 102, 32 92, 28 76 C 24 56, 30 28, 60 28 Z" fill="url(#lg-headGrad)" />
          <path d="M60 28 C 90 28, 96 56, 92 76 C 88 92, 76 102, 60 102 C 44 102, 32 92, 28 76 C 24 56, 30 28, 60 28 Z" fill="url(#lg-innerGlow)">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="3.8s" repeatCount="indefinite" />
          </path>
          <g style="animation: lg-hue 8s ease-in-out infinite; mix-blend-mode: screen;">
            <path d="M60 28 C 90 28, 96 56, 92 76 C 88 92, 76 102, 60 102 C 44 102, 32 92, 28 76 C 24 56, 30 28, 60 28 Z" fill="url(#lg-rimLight)" />
          </g>

          <ellipse data-blush-l cx="36" cy="74" rx="7" ry="4" fill="url(#lg-blush)" opacity="1" />
          <ellipse data-blush-r cx="84" cy="74" rx="7" ry="4" fill="url(#lg-blush)" opacity="1" />

          <ellipse data-eye="left"  cx="48" cy="66" rx="7.5" ry="9" fill="url(#lg-eyeGrad)" transform="rotate(-8 48 66)" />
          <ellipse data-eye="right" cx="72" cy="66" rx="7.5" ry="9" fill="url(#lg-eyeGrad)" transform="rotate(8 72 66)" />

          <circle data-iris="left"  cx="48" cy="66" r="4" fill="none" stroke="#6E4DB0" stroke-width="0.6" opacity="0.5">
            <animate attributeName="r" values="3.5;4.5;3.5" dur="4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="4s" repeatCount="indefinite" />
          </circle>
          <circle data-iris="right" cx="72" cy="66" r="4" fill="none" stroke="#6E4DB0" stroke-width="0.6" opacity="0.5">
            <animate attributeName="r" values="3.5;4.5;3.5" dur="4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.6;0.3" dur="4s" repeatCount="indefinite" />
          </circle>

          <circle data-spark="ls"  cx="45.5" cy="62" r="1.8" fill="#FFF0FF" />
          <circle data-spark="rs"  cx="69.5" cy="62" r="1.8" fill="#FFF0FF" />
          <circle data-spark="ls2" cx="49.5" cy="69" r="0.9" fill="#FFF0FF" />
          <circle data-spark="rs2" cx="73.5" cy="69" r="0.9" fill="#FFF0FF" />

          <rect data-lid="left"  x="40" y="55" width="16" height="0" fill="url(#lg-headGrad)" clip-path="url(#lg-eye-clip-l)" />
          <rect data-lid="right" x="64" y="55" width="16" height="0" fill="url(#lg-headGrad)" clip-path="url(#lg-eye-clip-r)" />

          <path data-mouth d="M55 84 Q60 87 65 84" fill="none" stroke="#3A2B5C" stroke-width="1.6" stroke-linecap="round" />

          <g data-cos="sunglasses" style="display:none">
            <rect x="36" y="60" width="22" height="10" rx="4" fill="#141018" stroke="#322844" stroke-width="0.5" />
            <rect x="62" y="60" width="22" height="10" rx="4" fill="#141018" stroke="#322844" stroke-width="0.5" />
            <path d="M58 65 L62 65" stroke="#141018" stroke-width="2" stroke-linecap="round" />
            <path d="M40 63 L48 63" stroke="#7B5EC7" stroke-width="0.8" opacity="0.6" />
            <path d="M66 63 L74 63" stroke="#7B5EC7" stroke-width="0.8" opacity="0.6" />
          </g>

          <g data-cos="hat" style="display:none">
            <polygon points="22,34 30,8 46,30" fill="#E04A6E" stroke="#7A2842" stroke-width="0.8" />
            <circle cx="30" cy="7" r="2.4" fill="#FFE066" />
            <ellipse cx="34" cy="32" rx="13" ry="2.6" fill="#F4B0C2" stroke="#C77897" stroke-width="0.6" />
          </g>

          <g data-cos="scarf" style="display:none">
            <path d="M38 97 Q60 103 82 97 L80 110 Q60 114 40 110 Z" fill="#D97757" stroke="#8C3F22" stroke-width="0.6" />
            <path d="M68 108 L72 124 L74 108 Z" fill="#D97757" stroke="#8C3F22" stroke-width="0.4" />
            <path d="M75 106 L79 120 L80 106 Z" fill="#C56543" stroke="#8C3F22" stroke-width="0.4" />
          </g>
        </g>
      </g>
    </svg>
  `;

  target.appendChild(wrap);

  // ---- Speech bubble ----
  const bubble = document.createElement('div');
  bubble.className = 'lg-bubble';
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-live', 'polite');
  bubble.hidden = true;
  target.appendChild(bubble);

  let bubbleHideTimer = 0;
  let bubbleRemoveTimer = 0;
  const say = (text, opts = {}) => {
    if (destroyed) return;
    const msg = typeof text === 'string' ? text.trim() : '';
    if (!msg) return;
    const { duration = 2800 } = opts;
    clearTimeout(bubbleHideTimer);
    clearTimeout(bubbleRemoveTimer);
    bubble.textContent = msg;
    bubble.hidden = false;
    requestAnimationFrame(() => {
      if (destroyed) return;
      bubble.classList.add('lg-bubble-show');
    });
    if (duration > 0) {
      bubbleHideTimer = setTimeout(() => {
        bubble.classList.remove('lg-bubble-show');
        bubbleRemoveTimer = setTimeout(() => { bubble.hidden = true; }, 300);
      }, duration);
    }
  };

  // ---- Event bus ----
  const listeners = new Map();
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  };
  const emit = (event, data) => {
    const set = listeners.get(event);
    if (!set) return;
    set.forEach((fn) => {
      try { fn(data); } catch (err) { console.error(`lil-guy ${event} handler:`, err); }
    });
  };

  // ---- Handles ----
  const q = s => wrap.querySelector(s);
  const bodyG  = q('[data-body]');
  const ls  = q('[data-spark="ls"]');
  const rs  = q('[data-spark="rs"]');
  const ls2 = q('[data-spark="ls2"]');
  const rs2 = q('[data-spark="rs2"]');
  const irL = q('[data-iris="left"]');
  const irR = q('[data-iris="right"]');
  const lidL = q('[data-lid="left"]');
  const lidR = q('[data-lid="right"]');
  const mouth = q('[data-mouth]');
  const blushL = q('[data-blush-l]');
  const blushR = q('[data-blush-r]');

  const MOUTH = {
    neutral:   "M55 84 Q60 87 65 84",
    happy:     "M54 83 Q60 90 66 83",
    surprised: "M60 86 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0",
  };
  const setMouth = m => mouth.setAttribute('d', MOUTH[m] || MOUTH.neutral);

  // ---- State ----
  let gaze = { x: 0, y: 0 };
  let gazeEased = { x: 0, y: 0 };
  let tracking = false;
  let trackingStart = 0;
  let gazeLockUntil = 0;
  let mood = 'neutral';
  let lastMoveTime = 0;
  let lastMoveSpeed = 0;
  let destroyed = false;
  let rafId = 0;
  const timers = new Set();
  const st = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  const render = () => {
    const ex = gazeEased.x * 2.2;
    const ey = gazeEased.y * 2.4;
    ls.setAttribute('cx', 45.5 + ex); ls.setAttribute('cy', 62 + ey);
    rs.setAttribute('cx', 69.5 + ex); rs.setAttribute('cy', 62 + ey);
    ls2.setAttribute('cx', 49.5 + ex); ls2.setAttribute('cy', 69 + ey);
    rs2.setAttribute('cx', 73.5 + ex); rs2.setAttribute('cy', 69 + ey);
    irL.setAttribute('cx', 48 + ex); irL.setAttribute('cy', 66 + ey);
    irR.setAttribute('cx', 72 + ex); irR.setAttribute('cy', 66 + ey);
    wrap.style.transform = `rotate(${gazeEased.x * 3}deg)`;
  };

  const loop = () => {
    if (destroyed) return;
    gazeEased.x += (gaze.x - gazeEased.x) * 0.12;
    gazeEased.y += (gaze.y - gazeEased.y) * 0.12;
    render();
    rafId = requestAnimationFrame(loop);
  };
  loop();

  // ---- Blink (eyelid height animation) ----
  const setBlink = (closed, speed = 80) => {
    const h = closed ? 20 : 0;
    const start = performance.now();
    const from = parseFloat(lidL.getAttribute('height'));
    const animate = (now) => {
      if (destroyed) return;
      const t = Math.min(1, (now - start) / speed);
      const v = from + (h - from) * t;
      lidL.setAttribute('height', v);
      lidR.setAttribute('height', v);
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  };

  const scheduleBlink = () => {
    if (destroyed) return;
    const delay = 2400 + Math.random() * 4200;
    st(() => {
      const r = Math.random();
      if (r < 0.08) {
        setBlink(true, 260);
        st(() => setBlink(false, 260), 520);
      } else if (r < 0.25) {
        setBlink(true);
        st(() => setBlink(false), 100);
        st(() => setBlink(true), 200);
        st(() => setBlink(false), 300);
        st(() => setBlink(true), 400);
        st(() => setBlink(false), 500);
      } else if (r < 0.45) {
        setBlink(true);
        st(() => setBlink(false), 100);
        st(() => setBlink(true), 220);
        st(() => setBlink(false), 320);
      } else {
        setBlink(true);
        st(() => setBlink(false), 110);
      }
      scheduleBlink();
    }, delay);
  };
  scheduleBlink();

  // ---- Idle glances ----
  const scheduleGlance = () => {
    if (destroyed) return;
    const delay = 2200 + Math.random() * 3200;
    st(() => {
      if (!tracking) {
        gaze = { x: (Math.random() * 2 - 1) * 0.9, y: (Math.random() * 2 - 1) * 0.6 };
        st(() => { if (!tracking) gaze = { x: 0, y: 0 }; }, 1100);
      }
      scheduleGlance();
    }, delay);
  };
  scheduleGlance();

  // ---- Mood ----
  const setMood = (m) => {
    if (mood === m) return;
    mood = m;
    setMouth(m);
    const big = m === 'happy';
    blushL.setAttribute('opacity', big ? '1.3' : '1');
    blushR.setAttribute('opacity', big ? '1.3' : '1');
    blushL.setAttribute('rx', big ? '9' : '7');
    blushR.setAttribute('rx', big ? '9' : '7');
    emit('mood', m);
  };

  const moodInterval = setInterval(() => {
    if (destroyed) return;
    if (tracking && performance.now() - trackingStart > 2000) setMood('happy');
    else if (!tracking && mood !== 'neutral') st(() => { if (!tracking) setMood('neutral'); }, 400);
  }, 200);

  // ---- Pointer ----
  const onMove = (e) => {
    if (performance.now() < gazeLockUntil) return;
    const r = wrap.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    const now = performance.now();
    const dt = now - lastMoveTime;
    if (dt > 0) lastMoveSpeed = Math.hypot(e.movementX || 0, e.movementY || 0) / dt;
    lastMoveTime = now;

    if (dist < trackRange) {
      if (!tracking) {
        tracking = true;
        trackingStart = now;
        if (lastMoveSpeed > 2) {
          setMood('surprised');
          st(() => { if (tracking) setMood('neutral'); }, 600);
        }
      }
      gaze = {
        x: Math.max(-1, Math.min(1, dx / 160)),
        y: Math.max(-1, Math.min(1, dy / 160)),
      };
    } else if (tracking) {
      tracking = false;
      gaze = { x: 0, y: 0 };
      setMood('neutral');
    }
  };
  const end = () => {
    if (!tracking) return;
    tracking = false;
    gaze = { x: 0, y: 0 };
    setMood('neutral');
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', end, { passive: true });
  window.addEventListener('pointercancel', end, { passive: true });
  window.addEventListener('touchend', end, { passive: true });

  // ---- Tap: squash + burst ----
  const onTap = () => {
    bodyG.classList.remove('lg-body-squash');
    void bodyG.getBoundingClientRect();
    bodyG.classList.add('lg-body-squash');
    const host = wrap.parentElement;
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('div');
      p.className = 'lg-burst';
      const angle = (i / 8) * Math.PI * 2;
      const d = 40 + Math.random() * 30;
      p.style.setProperty('--dx', `${Math.cos(angle) * d}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * d}px`);
      const r = wrap.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      p.style.left = `${r.left - hr.left + r.width / 2 - 3}px`;
      p.style.top  = `${r.top  - hr.top  + r.height / 2 - 3}px`;
      host.appendChild(p);
      setTimeout(() => p.remove(), 900);
    }
    setMood('surprised');
    st(() => setMood('neutral'), 500);
    emit('pet');
  };
  wrap.addEventListener('pointerdown', onTap);

  // ---- Inject body-squash keyframes ----
  if (!document.getElementById('little-guy-squash')) {
    const s = document.createElement('style');
    s.id = 'little-guy-squash';
    s.textContent = `
      [data-body].lg-body-squash { animation: lg-body-squash .5s ease-out; transform-origin: 60px 90px; transform-box: fill-box; }
      @keyframes lg-body-squash {
        0%{transform:scale(1,1)} 30%{transform:scale(1.15,.85)}
        60%{transform:scale(.92,1.08)} 100%{transform:scale(1,1)}
      }
    `;
    document.head.appendChild(s);
  }

  const squash = () => {
    if (destroyed) return;
    bodyG.classList.remove('lg-body-squash');
    void bodyG.getBoundingClientRect();
    bodyG.classList.add('lg-body-squash');
  };

  const cosmeticEls = wrap.querySelectorAll('[data-cos]');
  const setCosmetics = (list) => {
    if (destroyed) return;
    const want = new Set(Array.isArray(list) ? list : []);
    cosmeticEls.forEach((el) => {
      el.style.display = want.has(el.getAttribute('data-cos')) ? '' : 'none';
    });
  };

  const lookAt = ({ clientX, clientY }, duration = 900) => {
    if (destroyed) return;
    const r = wrap.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    gaze = {
      x: Math.max(-1, Math.min(1, dx / 140)),
      y: Math.max(-1, Math.min(1, dy / 140)),
    };
    gazeLockUntil = performance.now() + duration;
    setMood('surprised');
    st(() => {
      gazeLockUntil = 0;
      tracking = false;
      gaze = { x: 0, y: 0 };
      setMood('neutral');
    }, duration);
  };

  return {
    say,
    on,
    emit,
    squash,
    lookAt,
    setCosmetics,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      clearInterval(moodInterval);
      clearTimeout(bubbleHideTimer);
      clearTimeout(bubbleRemoveTimer);
      timers.forEach(id => clearTimeout(id));
      timers.clear();
      listeners.clear();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('touchend', end);
      wrap.removeEventListener('pointerdown', onTap);
      bubble.remove();
      wrap.remove();
    },
  };
}
