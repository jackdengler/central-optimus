// little-guy-wander.js
// External director that makes the mounted little guy wander the launcher,
// peek at a random tile, shrug, and walk home. Manipulates the mount element's
// transform only — does not touch little-guy.js internals.

const reduced =
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function startLittleGuyWander(mountEl, opts = {}) {
  if (!mountEl) throw new Error("startLittleGuyWander: mount element required");
  if (reduced) return { stop() {} };

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
    return visible[Math.floor(Math.random() * visible.length)];
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
      mountEl.style.transform = "";
      mountEl.style.willChange = "";
    },
  };
}
