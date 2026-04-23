// little-guy-wander.js
// External director that makes the mounted little guy wander the launcher,
// peek at a random tile, shrug, and walk home. Manipulates the mount element's
// transform only — does not touch little-guy.js internals.

const reduced =
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const AURA_STYLE_ID = "lg-aura-styles";
const AURA_ORBS = [
  { cx: 28, cy: 10, s: 16, d: 2.8, dl: 0 },
  { cx: 50, cy: 5,  s: 20, d: 3.0, dl: -0.4 },
  { cx: 72, cy: 10, s: 16, d: 3.2, dl: -0.8 },
  { cx: 22, cy: 32, s: 12, d: 3.4, dl: -0.2 },
  { cx: 78, cy: 32, s: 12, d: 3.6, dl: -0.6 },
  { cx: 20, cy: 58, s: 13, d: 3.8, dl: -1.0 },
  { cx: 80, cy: 58, s: 13, d: 3.4, dl: -0.3 },
  { cx: 26, cy: 80, s: 14, d: 3.6, dl: -1.4 },
  { cx: 74, cy: 80, s: 14, d: 3.2, dl: -0.5 },
  { cx: 40, cy: 92, s: 11, d: 3.2, dl: -1.2 },
  { cx: 60, cy: 92, s: 11, d: 3.0, dl: -0.7 },
  { cx: 50, cy: 52, s: 120, d: 5.5, dl: 0, halo: true },
];

function ensureAuraStyles() {
  if (document.getElementById(AURA_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = AURA_STYLE_ID;
  style.textContent = `
    .lg-aura {
      position: absolute;
      pointer-events: none;
      z-index: -1;
    }
    .lg-aura .lg-orb {
      position: absolute;
      border-radius: 50%;
      transform: translate(-50%, -50%) scale(1);
      background: radial-gradient(circle,
        rgba(255, 240, 255, 0.95) 0%,
        rgba(184, 155, 232, 0.55) 45%,
        rgba(184, 155, 232, 0) 72%);
      filter: blur(0.6px);
      animation: lg-orb-pulse var(--dur, 3s) ease-in-out infinite;
      animation-delay: var(--delay, 0s);
      will-change: opacity, transform;
    }
    .lg-aura .lg-orb.lg-orb-halo {
      background: radial-gradient(circle,
        rgba(232, 212, 255, 0.28) 0%,
        rgba(184, 155, 232, 0.12) 40%,
        rgba(184, 155, 232, 0) 72%);
      filter: blur(6px);
      animation-timing-function: ease-in-out;
    }
    @keyframes lg-orb-pulse {
      0%, 100% { opacity: 0.35; transform: translate(-50%, -50%) scale(1); }
      50%      { opacity: 0.9;  transform: translate(-50%, -50%) scale(1.35); }
    }
    @media (prefers-reduced-motion: reduce) {
      .lg-aura .lg-orb { animation: none; opacity: 0.55; }
    }
  `;
  document.head.appendChild(style);
}

function createAura(mountEl) {
  const host = mountEl.parentElement;
  if (!host) return null;
  ensureAuraStyles();
  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }
  // Own stacking context so the aura's z-index: -1 stays inside hero-main,
  // behind the greeting text and the guy, not bleeding back to the page body.
  host.style.isolation = "isolate";
  const aura = document.createElement("div");
  aura.className = "lg-aura";
  AURA_ORBS.forEach((o) => {
    const orb = document.createElement("div");
    orb.className = "lg-orb" + (o.halo ? " lg-orb-halo" : "");
    orb.style.left = o.cx + "%";
    orb.style.top = o.cy + "%";
    orb.style.width = o.s + "px";
    orb.style.height = o.s + "px";
    orb.style.setProperty("--dur", o.d + "s");
    orb.style.setProperty("--delay", o.dl + "s");
    aura.appendChild(orb);
  });
  host.insertBefore(aura, host.firstChild);

  const position = () => {
    const m = mountEl.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    // Aura lives at mount home, constrained to the mount's own box so orbs
    // never bleed into the greeting to the left. Callers must invoke this
    // while pose is 0,0.
    aura.style.left = m.left - h.left + "px";
    aura.style.top = m.top - h.top + "px";
    aura.style.width = m.width + "px";
    aura.style.height = m.height + "px";
  };
  position();

  const onResize = () => position();
  window.addEventListener("resize", onResize, { passive: true });

  return {
    reposition: position,
    destroy() {
      window.removeEventListener("resize", onResize);
      aura.remove();
    },
  };
}

export function startLittleGuyWander(mountEl, opts = {}) {
  if (!mountEl) throw new Error("startLittleGuyWander: mount element required");

  const aura = createAura(mountEl);

  if (reduced) {
    return {
      stop() {
        if (aura) aura.destroy();
      },
    };
  }

  const {
    tileSelector = "#grid .tile",
    idleMin = 6000,
    idleMax = 14000,
  } = opts;

  const pose = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
  let stopped = false;
  let rafId = 0;
  let sleepTimer = null;

  mountEl.style.willChange = "transform";
  mountEl.style.position = "relative";
  mountEl.style.zIndex = "30";

  const apply = () => {
    mountEl.style.transform =
      `translate(${pose.x}px, ${pose.y}px) rotate(${pose.rot}deg) scale(${pose.sx}, ${pose.sy})`;
  };

  const sleep = (ms) =>
    new Promise((resolve) => {
      if (stopped) return resolve();
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        resolve();
      }, ms);
    });

  const tween = (targets, duration, easing = (t) => t) =>
    new Promise((resolve) => {
      if (stopped) return resolve();
      const start = performance.now();
      const from = { ...pose };
      const step = (now) => {
        if (stopped) return resolve();
        const t = Math.min(1, (now - start) / duration);
        const e = easing(t);
        for (const k in targets) {
          pose[k] = from[k] + (targets[k] - from[k]) * e;
        }
        apply();
        if (t < 1) rafId = requestAnimationFrame(step);
        else resolve();
      };
      rafId = requestAnimationFrame(step);
    });

  const easeInOut = (t) =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOut = (t) => 1 - Math.pow(1 - t, 2);

  const pickTarget = () => {
    const tiles = document.querySelectorAll(tileSelector);
    const visible = [...tiles].filter((t) => {
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!visible.length) return null;
    // Only peek at the top-most row of tiles: sort by y, keep the two with
    // the smallest top. Ties (same row) are resolved by DOM order.
    const topTwo = visible
      .map((el, i) => ({ el, i, top: el.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top || a.i - b.i)
      .slice(0, 2)
      .map((x) => x.el);
    return topTwo[Math.floor(Math.random() * topTwo.length)];
  };

  const offsetTo = (tileEl) => {
    // Pose translate is relative to the mount's natural flow position.
    // The mount's current visual rect already includes our pose translate,
    // so subtract it to recover the untranslated origin.
    const m = mountEl.getBoundingClientRect();
    const t = tileEl.getBoundingClientRect();
    const originCX = m.left + m.width / 2 - pose.x;
    const originCY = m.top + m.height / 2 - pose.y;
    // Aim: hover his body-center just above the tile's top edge.
    const targetCX = t.left + t.width / 2;
    const targetCY = t.top - 10;
    return { x: targetCX - originCX, y: targetCY - originCY };
  };

  const walkTo = (x, y) =>
    new Promise((resolve) => {
      if (stopped) return resolve();
      const startX = pose.x;
      const startY = pose.y;
      const dx = x - startX;
      const dy = y - startY;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return resolve();
      const duration = Math.min(4500, Math.max(900, dist * 4.2));
      const cadenceHz = 2.2;
      const bobAmp = 5;
      const start = performance.now();
      const step = (now) => {
        if (stopped) return resolve();
        const elapsed = now - start;
        const t = Math.min(1, elapsed / duration);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        // Sine bob, attenuated at start/end so he doesn't jolt at rest.
        const fade = Math.sin(Math.PI * t);
        const bob = -bobAmp * fade * Math.sin(2 * Math.PI * cadenceHz * (elapsed / 1000));
        pose.x = startX + dx * e;
        pose.y = startY + dy * e + bob;
        apply();
        if (t < 1) rafId = requestAnimationFrame(step);
        else resolve();
      };
      rafId = requestAnimationFrame(step);
    });

  const peek = async (dir) => {
    // Lean over the tile and dip forward.
    await tween(
      { rot: 16 * dir, y: pose.y + 14, sy: 0.96 },
      440,
      easeOut,
    );
    await sleep(550);
    // A tiny "hmm, what's under here" second lean.
    await tween({ rot: 22 * dir, y: pose.y + 6 }, 260, easeInOut);
    await sleep(420);
  };

  const shrug = async () => {
    // Stand up straight from the peek.
    await tween({ rot: 0, y: pose.y - 12, sy: 1 }, 260, easeOut);
    // Quick shrug: shoulders-up then drop.
    await tween({ sy: 0.92, sx: 1.08, y: pose.y - 6 }, 140, easeInOut);
    await tween({ sy: 1, sx: 1, y: pose.y + 6 }, 180, easeOut);
    await tween({ y: pose.y - 6 }, 160, easeOut);
    await sleep(180);
  };

  const walkHome = async () => {
    await walkTo(0, 0);
    await tween({ rot: 0, sx: 1, sy: 1 }, 200, easeOut);
  };

  const loop = async () => {
    // Initial settling delay so he doesn't bolt on load.
    await sleep(3500 + Math.random() * 2500);
    while (!stopped) {
      const tile = pickTarget();
      if (tile) {
        const { x, y } = offsetTo(tile);
        await walkTo(x, y);
        if (stopped) break;
        // Choose peek direction from which side of the tile he approached.
        const tr = tile.getBoundingClientRect();
        const mr = mountEl.getBoundingClientRect();
        const dir = mr.left + mr.width / 2 < tr.left + tr.width / 2 ? 1 : -1;
        await peek(dir);
        if (stopped) break;
        await sleep(300);
        await shrug();
        if (stopped) break;
        await walkHome();
      }
      if (stopped) break;
      await sleep(idleMin + Math.random() * (idleMax - idleMin));
    }
  };

  loop();

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(rafId);
      if (sleepTimer) clearTimeout(sleepTimer);
      if (aura) aura.destroy();
      mountEl.style.transform = "";
      mountEl.style.willChange = "";
    },
  };
}
