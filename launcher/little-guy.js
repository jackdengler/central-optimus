// little-guy.js
// Compact ambient mascot for the FaceTime-style PiP overlay.
// - Breathes, blinks, idle glances
// - Tracks the pointer when nearby
// - Tap = squash + sparkle burst

export function mountLittleGuy(target, opts = {}) {
  if (!target) throw new Error("mountLittleGuy: target element required");

  const { trackRange = 360 } = opts;

  const STYLE_ID = "little-guy-styles";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes lg-float {
        0%   { transform: translate(0, 0); }
        25%  { transform: translate(3px, -4px); }
        50%  { transform: translate(0, -2px); }
        75%  { transform: translate(-3px, -4px); }
        100% { transform: translate(0, 0); }
      }
      @keyframes lg-antenna-l { 0%,100%{transform:rotate(-4deg)} 50%{transform:rotate(4deg)} }
      @keyframes lg-antenna-c { 0%,100%{transform:rotate(-2deg)} 50%{transform:rotate(2deg)} }
      @keyframes lg-antenna-r { 0%,100%{transform:rotate(4deg)} 50%{transform:rotate(-4deg)} }
      @keyframes lg-pulse { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.25)} }
      @keyframes lg-halo  { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:.6;transform:scale(1.4)} }
      @keyframes lg-hue   { 0%,100%{filter:hue-rotate(0deg)} 50%{filter:hue-rotate(25deg)} }
      @keyframes lg-squash {
        0%{transform:scale(1,1)} 30%{transform:scale(1.15,.85)}
        60%{transform:scale(.92,1.08)} 100%{transform:scale(1,1)}
      }
      .lg-burst {
        position:absolute; width:5px; height:5px; pointer-events:none;
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
    `;
    document.head.appendChild(style);
  }

  const targetPos = getComputedStyle(target).position;
  if (targetPos === "static") target.style.position = "relative";

  const wrap = document.createElement("div");
  wrap.className = "lg-wrap";
  Object.assign(wrap.style, {
    width: "100%",
    height: "100%",
    display: "block",
    transform: "rotate(0deg)",
    transition: "transform 700ms cubic-bezier(.2,.8,.2,1)",
    animation: "lg-float 7s ease-in-out infinite",
    touchAction: "manipulation",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTapHighlightColor: "transparent",
    cursor: "pointer",
    position: "relative",
  });

  wrap.innerHTML = `
    <svg viewBox="0 0 120 140" width="100%" height="100%" overflow="visible" preserveAspectRatio="xMidYMax meet">
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

          <path d="M60 28 C 90 28, 96 56, 92 76 C 88 92, 76 102, 60 102 C 44 102, 32 92, 28 76 C 24 56, 30 28, 60 28 Z" fill="url(#lg-headGrad)" />
          <path d="M60 28 C 90 28, 96 56, 92 76 C 88 92, 76 102, 60 102 C 44 102, 32 92, 28 76 C 24 56, 30 28, 60 28 Z" fill="url(#lg-innerGlow)">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="3.8s" repeatCount="indefinite" />
          </path>
          <g style="animation: lg-hue 8s ease-in-out infinite; mix-blend-mode: screen;">
            <path d="M60 28 C 90 28, 96 56, 92 76 C 88 92, 76 102, 60 102 C 44 102, 32 92, 28 76 C 24 56, 30 28, 60 28 Z" fill="url(#lg-rimLight)" />
          </g>

          <ellipse cx="36" cy="74" rx="7" ry="4" fill="url(#lg-blush)" />
          <ellipse cx="84" cy="74" rx="7" ry="4" fill="url(#lg-blush)" />

          <ellipse data-eye="left"  cx="48" cy="66" rx="7.5" ry="9" fill="url(#lg-eyeGrad)" transform="rotate(-8 48 66)" />
          <ellipse data-eye="right" cx="72" cy="66" rx="7.5" ry="9" fill="url(#lg-eyeGrad)" transform="rotate(8 72 66)" />

          <circle data-spark="ls"  cx="45.5" cy="62" r="1.8" fill="#FFF0FF" />
          <circle data-spark="rs"  cx="69.5" cy="62" r="1.8" fill="#FFF0FF" />
          <circle data-spark="ls2" cx="49.5" cy="69" r="0.9" fill="#FFF0FF" />
          <circle data-spark="rs2" cx="73.5" cy="69" r="0.9" fill="#FFF0FF" />

          <rect data-lid="left"  x="40" y="55" width="16" height="0" fill="url(#lg-headGrad)" clip-path="url(#lg-eye-clip-l)" />
          <rect data-lid="right" x="64" y="55" width="16" height="0" fill="url(#lg-headGrad)" clip-path="url(#lg-eye-clip-r)" />

          <path data-mouth d="M55 84 Q60 87 65 84" fill="none" stroke="#3A2B5C" stroke-width="1.6" stroke-linecap="round" />
        </g>
      </g>
    </svg>
  `;

  target.appendChild(wrap);

  const svg = wrap.querySelector("svg");
  const body = wrap.querySelector("[data-body]");
  const eyeL = wrap.querySelector('[data-eye="left"]');
  const eyeR = wrap.querySelector('[data-eye="right"]');
  const sparkLS = wrap.querySelector('[data-spark="ls"]');
  const sparkRS = wrap.querySelector('[data-spark="rs"]');
  const sparkLS2 = wrap.querySelector('[data-spark="ls2"]');
  const sparkRS2 = wrap.querySelector('[data-spark="rs2"]');
  const lidL = wrap.querySelector('[data-lid="left"]');
  const lidR = wrap.querySelector('[data-lid="right"]');
  const mouth = wrap.querySelector("[data-mouth]");

  const baseEyes = {
    l: { cx: 48, cy: 66 },
    r: { cx: 72, cy: 66 },
  };

  let destroyed = false;
  let pointerX = null;
  let pointerY = null;
  let lastMove = performance.now();
  let glanceX = 0;
  let glanceY = 0;

  const onPointer = (e) => {
    if (destroyed) return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    lastMove = performance.now();
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  const tick = () => {
    if (destroyed) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let targetX = 0;
    let targetY = 0;
    const idle = performance.now() - lastMove > 1800;
    if (pointerX !== null && !idle) {
      const dx = pointerX - cx;
      const dy = pointerY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < trackRange) {
        const max = 2.4;
        const k = Math.min(1, dist / 80);
        targetX = (dx / (dist || 1)) * max * k;
        targetY = (dy / (dist || 1)) * max * k;
      }
    } else if (idle) {
      targetX = glanceX;
      targetY = glanceY;
    }
    const ease = 0.18;
    const curX = parseFloat(eyeL.dataset.gx || "0");
    const curY = parseFloat(eyeL.dataset.gy || "0");
    const nx = curX + (targetX - curX) * ease;
    const ny = curY + (targetY - curY) * ease;
    eyeL.dataset.gx = nx;
    eyeL.dataset.gy = ny;
    eyeL.setAttribute("cx", baseEyes.l.cx + nx);
    eyeL.setAttribute("cy", baseEyes.l.cy + ny);
    eyeR.setAttribute("cx", baseEyes.r.cx + nx);
    eyeR.setAttribute("cy", baseEyes.r.cy + ny);
    sparkLS.setAttribute("cx", 45.5 + nx);
    sparkLS.setAttribute("cy", 62 + ny);
    sparkRS.setAttribute("cx", 69.5 + nx);
    sparkRS.setAttribute("cy", 62 + ny);
    sparkLS2.setAttribute("cx", 49.5 + nx);
    sparkLS2.setAttribute("cy", 69 + ny);
    sparkRS2.setAttribute("cx", 73.5 + nx);
    sparkRS2.setAttribute("cy", 69 + ny);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Idle glance
  const glanceTimer = setInterval(() => {
    if (destroyed) return;
    if (performance.now() - lastMove < 1800) return;
    glanceX = (Math.random() - 0.5) * 4;
    glanceY = (Math.random() - 0.5) * 2;
  }, 2600);

  // Blink
  const blink = (times = 1) => {
    if (destroyed) return;
    let n = 0;
    const step = () => {
      if (n >= times) return;
      lidL.setAttribute("y", "55");
      lidR.setAttribute("y", "55");
      lidL.setAttribute("height", "0");
      lidR.setAttribute("height", "0");
      requestAnimationFrame(() => {
        lidL.setAttribute("height", "20");
        lidR.setAttribute("height", "20");
        setTimeout(() => {
          lidL.setAttribute("height", "0");
          lidR.setAttribute("height", "0");
          n++;
          if (n < times) setTimeout(step, 140);
        }, 110);
      });
    };
    step();
  };
  const blinkTimer = setInterval(() => {
    if (Math.random() < 0.6) blink(1);
    else if (Math.random() < 0.4) blink(2);
  }, 3400);

  // Tap = squash + sparkle burst
  const onTap = (e) => {
    if (destroyed) return;
    const g = body;
    g.style.animation = "lg-squash .5s ease-out";
    g.addEventListener("animationend", () => (g.style.animation = ""), {
      once: true,
    });
    mouth.setAttribute("d", "M54 83 Q60 90 66 83");
    setTimeout(() => mouth.setAttribute("d", "M55 84 Q60 87 65 84"), 800);
    const rect = wrap.getBoundingClientRect();
    const ox = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
    const oy = (e.clientY ?? rect.top + rect.height / 2) - rect.top;
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("div");
      s.className = "lg-burst";
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 24 + Math.random() * 22;
      s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      s.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      s.style.left = `${ox}px`;
      s.style.top = `${oy}px`;
      wrap.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
    blink(1);
  };
  wrap.addEventListener("pointerup", onTap);

  return {
    destroy() {
      destroyed = true;
      clearInterval(glanceTimer);
      clearInterval(blinkTimer);
      window.removeEventListener("pointermove", onPointer);
      wrap.remove();
    },
  };
}
