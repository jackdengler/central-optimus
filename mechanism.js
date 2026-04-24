/* =====================================================================
   Mechanical watch movement — ambient background for the launcher.

   A hand-tuned Canvas2D simulation of a real ETA 2824-2 Swiss lever
   caliber. The tooth counts, mesh geometry, and phasing are pinned to
   real-world ratios: change one and the teeth stop interleaving at the
   mesh. The palette is a warm taupe-and-cream monotone — do not push
   these values darker or cooler; depth comes from opacity, not darkness.

   Exposed API (assigned onto the canvas element):
     canvas._setCamera(name, duration) — tween to a preset
                                         ('wide' | 'ambient' | 'closeup')
     canvas._getCameraName()           — name of the active (or tweening-to)
                                         preset
     canvas._launch(targetName)        — legacy alias for closeup dive
     canvas._close()                   — legacy alias for back-to-ambient

   Camera presets:
     wide     — entire watch plate framed on-screen (boot + pre-launch)
     ambient  — plate fills canvas, mechanism reads as a backdrop (default)
     closeup  — dive into the fourth wheel (kept for reduced-motion paths
                and possible future use)
   ===================================================================== */

export function startMovement(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Mechanism palette — warm monotone. Reads as brass-and-ivory on
     parchment: never near-black, never cool. Depth comes from opacity
     (the %a placeholder is filled at call sites via col()). */
  const C = {
    plateDark: "rgba(88, 70, 52, %a)",
    plateMid:  "rgba(130, 108, 82, %a)",
    plateHi:   "rgba(255, 250, 241, %a)",
    steel:     "rgba(108, 88, 66, %a)",
    steelBlue: "rgba(68, 54, 40, %a)",
    ruby:      "rgba(201, 106, 71, %a)",
    rubyHalo:  "rgba(218, 142, 108, %a)",
    gold:      "rgba(164, 79, 48, %a)",
    shadow:    "rgba(52, 38, 24, %a)",
  };
  const col = (c, a) => c.replace("%a", a);

  let W = 0, H = 0, DPR = 1;
  let cx = 0, cy = 0, R = 0;
  let isPortrait = true;

  /* Camera tween engine.
     The camera is defined by (cx, cy, R) where R is the plate radius
     in screen px. A preset is a function of (W, H) → {cx, cy, R}.
     _setCamera(name, duration) tweens from the current values to the
     target preset; duration=0 snaps immediately. */
  const PRESETS = {
    // Whole watch plate framed with margin. Diameter ≈ 0.86× the short
    // screen edge, so the full mechanism — bezel, bridges, balance —
    // reads as one object floating in the parchment.
    wide: () => ({
      cx: W * 0.5,
      cy: H * 0.5,
      R:  Math.min(W, H) * 0.43,
    }),
    // Plate fills the canvas; mechanism sits under the UI as a backdrop.
    // cy pushed below center so the gear cluster lands in the lower half
    // (the empty zone beneath the icon grid).
    ambient: () => ({
      cx: W * 0.5,
      cy: H * 0.52,
      R:  Math.max(W, H) * 1.7,
    }),
    // Dive into the fourth wheel (kept for reduced-motion / legacy paths).
    closeup: () => {
      const a = PRESETS.ambient();
      const g = gears && gears[3];
      if (!g) return a;
      const targetR = a.R * 4.5;
      return {
        cx: W / 2 - g.x * targetR,
        cy: H / 2 - g.y * targetR,
        R:  targetR,
      };
    },
  };

  // Start the session at "wide" so the launcher boots showing the whole
  // watch, then app.js tweens to "ambient" after first paint.
  const cam = {
    name: "wide",
    from: null,
    to: null,
    startTime: 0,
    duration: 0,
    eased: 0,
  };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    isPortrait = H >= W;

    // No tween in flight → snap camera to current preset at new dims.
    // Tween in flight → rebase endpoints so the animation re-resolves
    //   against the new viewport rather than drifting to stale coords.
    if (cam.to) {
      const toResolved = PRESETS[cam.name] ? PRESETS[cam.name]() : null;
      if (toResolved) cam.to = toResolved;
      if (cam.from) {
        const fromResolved = PRESETS[cam._fromName] ? PRESETS[cam._fromName]() : null;
        if (fromResolved) cam.from = fromResolved;
      }
    } else {
      const p = PRESETS[cam.name]();
      cx = p.cx; cy = p.cy; R = p.R;
    }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  /* Camera ease — shaped like a "fall-in": slow accel, rapid plunge,
     soft landing. That makes the zoom feel like diving into something
     rather than sliding toward it. */
  function easeInOutCubicSoft(t) {
    if (t < 0.5) return 4 * t * t * t;
    return 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function setCamera(name, duration = 900) {
    if (!PRESETS[name]) return;
    const target = PRESETS[name]();
    if (!duration || duration <= 0) {
      cam.name = name;
      cam.from = null;
      cam.to = null;
      cam._fromName = null;
      cam.duration = 0;
      cam.eased = 0;
      cx = target.cx; cy = target.cy; R = target.R;
      return;
    }
    cam._fromName = cam.name;
    cam.name = name;
    cam.from = { cx, cy, R };
    cam.to = target;
    cam.startTime = performance.now();
    cam.duration = duration;
    cam.eased = 0;
  }

  canvas._setCamera     = setCamera;
  canvas._getCameraName = () => cam.name;
  // Legacy aliases — any remaining callers still work.
  canvas._launch = (name) => setCamera(name === "fourthWheel" ? "closeup" : name, 1100);
  canvas._close  = () => setCamera("ambient", 800);
  canvas._getLaunchProgress = () => (cam.name === "closeup" ? cam.eased || 1 : 0);

  /* ====== Gear train — pinned to real ETA 2824-2 tooth counts ======
     Each stage has a wheel (driven by previous) + pinion (drives next)
     on one arbor. Mesh ratio is driver_wheel_teeth / driven_pinion_teeth.

       barrel:   72w                — mainspring-driven
       center:   72w / 10p          — 7.2×  barrel
       third:    75w / 10p          — 7.2×  center
       fourth:   70w / 10p          — 7.5×  third
       escape:   15w /  7p          — 10×   fourth

     A real 2824-2 beats at 4 Hz, but at full caliber speed behind the
     launcher the balance reads as fidgety in peripheral vision. We run
     it at 2 Hz instead — historically real for older calibers and visibly
     calmer. Whole train halves: escape 16 rpm, fourth ≈ 1.6 rpm (still
     unmistakably alive), third ≈ 0.21 rpm, center ≈ 34 min/rev. */

  const MODULE = 0.0038;
  const pr = (teeth) => (teeth * MODULE) / 2;

  const ESCAPE_RAD_PER_S = (2.0 * 2 * Math.PI * 2) / 15;
  const S_ESC    = ESCAPE_RAD_PER_S / 1000;
  const S_FOUR   = S_ESC    / (70 / 7);
  const S_THIRD  = S_FOUR   / (75 / 10);
  const S_CENTER = S_THIRD  / (72 / 10);
  const S_BARREL = S_CENTER / (72 / 10);

  const gears = [];
  {
    // Stage 0 — barrel anchor. Placed on the screen-vertical axis
    // (u = v) near the lower end of the visible diagonal corridor, so
    // the barrel-side cluster (mainspring, click, ratchet, barrel
    // bridge) actually lands inside the portrait viewport.
    const g0 = {
      kind: "barrel", x: -0.32, y: -0.32,
      wheelT: 72, pinionT: 10, wheelR: pr(72), pinionR: pr(10),
      speed: S_BARREL, phaseBias: 0,
    };
    gears.push(g0);

    // Stage 1 — center wheel, up-right from barrel.
    // Cascade angles are now tuned to hug the yaw=π/4 diagonal (≈0.785
    // rad) with ±0.25 rad wobble so the train zig-zags visually but
    // stays inside the portrait corridor |u - v| ≤ 0.28.
    const dir1 = { x: Math.cos(1.05), y: Math.sin(1.05) };
    const g1 = {
      kind: "wheel", wheelT: 72, pinionT: 10, wheelR: pr(72), pinionR: pr(10),
      speed: S_CENTER, phaseBias: 0,
    };
    const d01 = g0.wheelR + g1.pinionR;
    g1.x = g0.x + dir1.x * d01; g1.y = g0.y + dir1.y * d01;
    gears.push(g1);

    // Stage 2 — third wheel.
    const dir2 = { x: Math.cos(0.55), y: Math.sin(0.55) };
    const g2 = {
      kind: "wheel", wheelT: 75, pinionT: 10, wheelR: pr(75), pinionR: pr(10),
      speed: S_THIRD, phaseBias: 0,
    };
    const d12 = g1.wheelR + g2.pinionR;
    g2.x = g1.x + dir2.x * d12; g2.y = g1.y + dir2.y * d12;
    gears.push(g2);

    // Stage 3 — fourth wheel (this is the launch target).
    const dir3 = { x: Math.cos(1.05), y: Math.sin(1.05) };
    const g3 = {
      kind: "wheel", wheelT: 70, pinionT: 10, wheelR: pr(70), pinionR: pr(10),
      speed: S_FOUR, phaseBias: 0,
    };
    const d23 = g2.wheelR + g3.pinionR;
    g3.x = g2.x + dir3.x * d23; g3.y = g2.y + dir3.y * d23;
    gears.push(g3);

    // Stage 4 — escape wheel.
    const dir4 = { x: Math.cos(0.55), y: Math.sin(0.55) };
    const g4 = {
      kind: "escape", wheelT: 15, pinionT: 7, wheelR: pr(15), pinionR: pr(7),
      speed: S_ESC, phaseBias: 0,
    };
    const d34 = g3.wheelR + g4.pinionR;
    g4.x = g3.x + dir4.x * d34; g4.y = g3.y + dir4.y * d34;
    gears.push(g4);

    // Tooth phasing so meshed teeth actually interleave at the mesh.
    for (let i = 1; i < gears.length; i++) {
      const driver = gears[i - 1];
      const driven = gears[i];
      const dx = driven.x - driver.x;
      const dy = driven.y - driver.y;
      const contactAngleDriver = Math.atan2(dy, dx);
      const contactAngleDriven = contactAngleDriver + Math.PI;
      const driverToothPitch = (Math.PI * 2) / driver.wheelT;
      const drivenPinionPitch = (Math.PI * 2) / driven.pinionT;
      driven.phaseBias =
        contactAngleDriven -
        Math.round(contactAngleDriven / drivenPinionPitch) * drivenPinionPitch +
        drivenPinionPitch / 2 -
        (contactAngleDriver -
          Math.round(contactAngleDriver / driverToothPitch) * driverToothPitch);
    }
  }

  // Balance wheel sits beyond the escape; pallet fork bridges them.
  // amp is the PEAK swing of the balance (radians). Real watches swing
  // ~270°, but the 8 timing screws on the rim sit 45° apart, so any
  // amp > ~22° makes adjacent screws cross each other's rest positions
  // every cycle — the rim reads as "flickering beads" instead of a
  // clean oscillation. Keep amp under ~π/8 so each screw stays in its
  // own 45° lane and per-frame motion at 60 fps is well under 3°.
  const escG = gears[4];
  const balance = {
    x: escG.x + 0.17, y: escG.y + 0.17,
    r: 0.17, freqHz: 2.0, amp: 0.12 * Math.PI,
  };

  // Pallet fork — offset from escape toward balance.
  const pallet = {
    x: escG.x + 0.08,
    y: escG.y + 0.08,
    armLen: escG.wheelR * 0.95,
    armWidth: 0.018,
    forkReach: 0.14,
  };

  /* Jewels at real pivot points. A standard 17-jewel Swiss movement
     shows one cap jewel per arbor from the back; skip the barrel (not
     jeweled on most budget calibers). Balance staff is the
     chronometer-grade large cap jewel. */
  const jewels = [
    { px: gears[1].x, py: gears[1].y, size: 0.020, kind: "train"   },
    { px: gears[2].x, py: gears[2].y, size: 0.020, kind: "train"   },
    { px: gears[3].x, py: gears[3].y, size: 0.020, kind: "train"   },
    { px: gears[4].x, py: gears[4].y, size: 0.018, kind: "train"   },
    { px: pallet.x,   py: pallet.y,   size: 0.024, kind: "pallet"  },
    { px: balance.x,  py: balance.y,  size: 0.032, kind: "balance" },
  ];

  /* Bridges — each bridge anchors to two pivots (= a real bridge
     spanning two jewel holes). bowFactor produces the curved outline. */
  function bridgeArc(p1, p2, bowFactor, n) {
    const out = [];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const bow = len * bowFactor;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const bx = p1[0] + dx * t;
      const by = p1[1] + dy * t;
      const b = Math.sin(t * Math.PI) * bow;
      out.push([bx + nx * b, by + ny * b]);
    }
    return out;
  }

  const bridges = [
    { // balance cock
      points: bridgeArc(
        [balance.x - 0.22, balance.y - 0.18],
        [balance.x + 0.18, balance.y + 0.05],
        0.18, 22,
      ),
      width: 0.045,
    },
    { // pallet cock
      points: bridgeArc(
        [pallet.x - 0.12, pallet.y - 0.10],
        [pallet.x + 0.08, pallet.y + 0.10],
        0.22, 16,
      ),
      width: 0.032,
    },
    { // train bridge
      points: bridgeArc(
        [gears[2].x - 0.04, gears[2].y + 0.05],
        [gears[4].x + 0.08, gears[4].y - 0.05],
        0.22, 28,
      ),
      width: 0.075,
    },
    { // barrel bridge
      points: bridgeArc(
        [gears[0].x - 0.08, gears[0].y - 0.08],
        [gears[1].x + 0.08, gears[1].y - 0.04],
        0.28, 30,
      ),
      width: 0.090,
    },
  ];

  const shimmers = Array.from({ length: 4 }, (_, i) => ({
    bridgeIdx: i % bridges.length,
    t: Math.random(),
    speed: 0.00018 + Math.random() * 0.00014,
    hue: Math.random() < 0.5 ? "gold" : "ruby",
  }));

  function U(u, v, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [cx + (u * c - v * s) * R, cy + (u * s + v * c) * R];
  }

  /* =====================================================================
     DRAW FUNCTIONS — below this line the code is all rendering. Do not
     tree-shake anything; drawPerlage / drawCotes / drawEngraving all
     contribute to the plate texture and LOOK unused if you haven't
     watched a frame render. They are not.
     ===================================================================== */

  function drawMainplate(yaw) {
    // Halo tightened — at 1.7x zoom it was mostly off-screen and not
    // contributing. Anchor to the visible viewport radius, not the
    // oversize plate R.
    const haloR = Math.max(W, H) * 0.9;
    const halo = ctx.createRadialGradient(cx, cy, haloR * 0.15, cx, cy, haloR);
    halo.addColorStop(0, col(C.plateHi, 0.14));
    halo.addColorStop(1, col(C.plateDark, 0.00));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();

    // Disc gradient — stronger directional falloff sells the "light from
    // upper-left" read at the new zoom. Light source pulled in closer
    // (0.45 → 0.35) so the specular hot region is visible on-screen.
    const disc = ctx.createRadialGradient(
      cx - R * 0.35, cy - R * 0.35, R * 0.05, cx, cy, R * 1.0,
    );
    disc.addColorStop(0.00, col(C.plateHi, 0.28));
    disc.addColorStop(0.55, col(C.plateMid, 0.12));
    disc.addColorStop(1.00, col(C.plateDark, 0.00));
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // Grain — fine random hairlines across the plate. This is what lifts
    // the plate from "gradient fill" to "machined nickel-silver"; every
    // decorated layer above (perlage, côtes, bridges) reads more
    // premium against a textured substrate than a smooth one. Seed is
    // derived from R so the pattern is deterministic per viewport size
    // (doesn't shimmer between frames).
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    // Grain density scaled to visible viewport so grain reads the same
    // density on-screen regardless of how much plate bleeds off-edge.
    const visArea = W * H;
    const grainCount = Math.min(2200, Math.round(visArea * 0.0045));
    // Deterministic PRNG so grain doesn't flicker every frame.
    let seed = Math.floor(R * 997 + cx + cy);
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < grainCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * R * 0.98;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      // Hairline runs along a random direction, short length.
      const dirA = rnd() * Math.PI * 2;
      const len  = 2 + rnd() * 6;
      const dx = Math.cos(dirA) * len;
      const dy = Math.sin(dirA) * len;
      const dark = rnd() < 0.55;
      ctx.strokeStyle = dark
        ? col(C.plateDark, 0.03 + rnd() * 0.04)
        : col(C.plateHi,   0.02 + rnd() * 0.04);
      ctx.lineWidth = rnd() < 0.15 ? 0.6 : 0.35;
      ctx.beginPath();
      ctx.moveTo(x - dx / 2, y - dy / 2);
      ctx.lineTo(x + dx / 2, y + dy / 2);
      ctx.stroke();
    }
    // Tiny dark specks — pores / inclusions in the metal grain.
    const speckCount = Math.min(500, Math.round(visArea * 0.0010));
    for (let i = 0; i < speckCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * R * 0.98;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      ctx.fillStyle = col(C.shadow, 0.08 + rnd() * 0.10);
      ctx.beginPath();
      ctx.arc(x, y, 0.4 + rnd() * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Outer rim — beveled chamfer read: bright highlight + dark shadow
    // just inside, scaled to zoom so the edge stays a crisp feature.
    const rimW = Math.max(1.4, R * 0.0016);
    ctx.strokeStyle = col(C.plateHi, 0.52);
    ctx.lineWidth = rimW;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col(C.shadow, 0.30);
    ctx.lineWidth = Math.max(0.8, R * 0.0010);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.992, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col(C.plateDark, 0.26);
    ctx.lineWidth = Math.max(0.6, R * 0.0008);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.980, 0, Math.PI * 2); ctx.stroke();
  }

  function drawPerlage(yaw) {
    // Light vector (unit-space): upper-left across the plate. Each spot
    // brightens on its light-facing half and darkens on the shadow side,
    // which is what sells perlage as machined circular graining rather
    // than stamped dots.
    const LIGHT_ANG = -Math.PI * 0.75;
    const lightUx = Math.cos(LIGHT_ANG), lightUy = Math.sin(LIGHT_ANG);
    // Spot size shrunk at the new zoom — 0.022 now renders saucer-sized.
    const spot = 0.015 * R;
    // Tighter light-offset so the specular peak stays inside the spot.
    const offset = spot * 0.22;

    // More rings, proportional density — ring count chosen so spot
    // spacing equals spot diameter * ~1.4 at every radius.
    const rings = 9;
    for (let ri = 1; ri <= rings; ri++) {
      const rr = (ri / (rings + 0.5)) * 0.92;
      const circ = 2 * Math.PI * rr;
      const n  = Math.max(14, Math.round(circ / (spot * 2.0 / R)));
      const stagger = (ri % 2) * (Math.PI / n);
      for (let i = 0; i < n; i++) {
        const a  = (i / n) * Math.PI * 2 + yaw * 0.3 + stagger;
        const ux = Math.cos(a) * rr;
        const uy = Math.sin(a) * rr;
        const [x, y] = U(ux, uy, yaw);

        const facing = 0.5 + 0.5 * (
          Math.cos(a - yaw * 0.3) * lightUx +
          Math.sin(a - yaw * 0.3) * lightUy
        );

        // Shadow-side arc — narrower angular span, slightly crisper.
        ctx.strokeStyle = col(C.shadow, 0.08 + (1 - facing) * 0.16);
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        ctx.arc(x, y, spot, 0, Math.PI * 2);
        ctx.stroke();

        // Lensed specular highlight, tight falloff.
        const hx = x + lightUx * offset;
        const hy = y + lightUy * offset;
        const sg = ctx.createRadialGradient(hx, hy, 0, x, y, spot * 1.10);
        sg.addColorStop(0.0, col(C.plateHi, 0.06 + facing * 0.26));
        sg.addColorStop(0.5, col(C.plateHi, 0.02 + facing * 0.06));
        sg.addColorStop(1.0, col(C.plateHi, 0.00));
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(x, y, spot, 0, Math.PI * 2);
        ctx.fill();

        // Micro dark bite on the shadow rim.
        ctx.strokeStyle = col(C.shadow, 0.14 + (1 - facing) * 0.20);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, spot * 0.94,
                LIGHT_ANG + Math.PI - 0.75,
                LIGHT_ANG + Math.PI + 0.75);
        ctx.stroke();

        // Dimple center — tiny dark point where the grinding tool
        // pivoted. Gives each spot a visible well, like real perlage.
        ctx.fillStyle = col(C.shadow, 0.20 + (1 - facing) * 0.12);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.45, spot * 0.11), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCotes(yaw) {
    ctx.save();
    ctx.beginPath();
    const steps = 48;
    ctx.moveTo(...U(0.62, 0, yaw));
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = 0.62 + 0.04 * Math.sin(a * 3);
      ctx.lineTo(...U(Math.cos(a) * rr, Math.sin(a) * rr, yaw));
    }
    ctx.closePath();
    ctx.clip();

    // Each stripe is a ridge — three parallel lines spanning the full
    // frame: shadow trough on the light-facing side, bright peak on the
    // ridge crown, shadow trough on the far side. Repeating those across
    // the plate gives the banded sheen of real Côtes de Genève rather
    // than a flat set of hairlines.
    // Stripe spacing scaled so ~0.014R between peaks regardless of zoom.
    const bands = 36;
    const span = R * 1.7;
    const troughOff = Math.max(1.4, R * 0.0018);
    const faintOff  = Math.max(0.7, R * 0.0009);
    const peakLW    = Math.max(0.9, R * 0.0011);
    const troughLW  = Math.max(0.6, R * 0.00075);
    // Light direction across the stripe (perpendicular to stripe axis).
    // Stripes run along angle `yaw + π/2`; cross-stripe axis is `yaw`.
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = -bands; i <= bands; i++) {
      const offset = (i / bands) * span;
      // Endpoints of the stripe centerline across the whole plate.
      const cx0 = cx + sn * offset;
      const cy0 = cy - cs * offset;
      const x1 = cx0 - cs * span;
      const y1 = cy0 - sn * span;
      const x2 = cx0 + cs * span;
      const y2 = cy0 + sn * span;

      // Peak — bright specular crown of the ridge.
      const peakGrad = ctx.createLinearGradient(x1, y1, x2, y2);
      peakGrad.addColorStop(0.00, col(C.plateMid, 0.03));
      peakGrad.addColorStop(0.50, col(C.plateHi,  0.22));
      peakGrad.addColorStop(1.00, col(C.plateDark, 0.03));
      ctx.strokeStyle = peakGrad;
      ctx.lineWidth = peakLW;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();

      // Light-side trough.
      const troughA = ctx.createLinearGradient(x1, y1, x2, y2);
      troughA.addColorStop(0.00, col(C.shadow, 0.00));
      troughA.addColorStop(0.50, col(C.shadow, 0.14));
      troughA.addColorStop(1.00, col(C.shadow, 0.00));
      ctx.strokeStyle = troughA;
      ctx.lineWidth = troughLW;
      ctx.beginPath();
      ctx.moveTo(x1 + sn * troughOff, y1 - cs * troughOff);
      ctx.lineTo(x2 + sn * troughOff, y2 - cs * troughOff);
      ctx.stroke();

      // Far-side trough.
      const troughB = ctx.createLinearGradient(x1, y1, x2, y2);
      troughB.addColorStop(0.00, col(C.shadow, 0.00));
      troughB.addColorStop(0.50, col(C.shadow, 0.10));
      troughB.addColorStop(1.00, col(C.shadow, 0.00));
      ctx.strokeStyle = troughB;
      ctx.lineWidth = troughLW * 0.85;
      ctx.beginPath();
      ctx.moveTo(x1 - sn * troughOff, y1 + cs * troughOff);
      ctx.lineTo(x2 - sn * troughOff, y2 + cs * troughOff);
      ctx.stroke();

      // Subtle secondary highlight hairline on the light side.
      if (i % 2 === 0) {
        const faint = ctx.createLinearGradient(x1, y1, x2, y2);
        faint.addColorStop(0.00, col(C.plateHi, 0.00));
        faint.addColorStop(0.50, col(C.plateHi, 0.09));
        faint.addColorStop(1.00, col(C.plateHi, 0.00));
        ctx.strokeStyle = faint;
        ctx.lineWidth = Math.max(0.35, R * 0.0005);
        ctx.beginPath();
        ctx.moveTo(x1 + sn * faintOff, y1 - cs * faintOff);
        ctx.lineTo(x2 + sn * faintOff, y2 - cs * faintOff);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawEngraving(yaw) {
    // 1. Minute-marker dot ring (existing behaviour).
    ctx.fillStyle = col(C.plateDark, 0.28);
    const n = 72;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + yaw;
      const r = R * 0.955;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      ctx.beginPath(); ctx.arc(x, y, 0.7, 0, Math.PI * 2); ctx.fill();
    }

    // 2. Engraved caliber + adjustment text — arcs along the inner
    //    perimeter in two locations (upper and lower), readable from
    //    the correct side of the plate. Each glyph is rotated so the
    //    top of the character faces the center, matching how real
    //    engravings arc around the mainplate.
    const engraveR = R * 0.780;
    const fontPx = Math.max(7, R * 0.020);
    ctx.save();
    ctx.font = `500 ${fontPx}px -apple-system, system-ui, "Helvetica Neue", sans-serif`;
    ctx.fillStyle = col(C.shadow, 0.42);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const arcText = (text, centerAngle, inward) => {
      const arcLen = text.length * fontPx * 0.58;
      const span = Math.min(Math.PI * 0.85, arcLen / engraveR);
      const start = centerAngle - span / 2;
      for (let i = 0; i < text.length; i++) {
        const a = start + (span * (i + 0.5)) / text.length;
        const x = cx + Math.cos(a) * engraveR;
        const y = cy + Math.sin(a) * engraveR;
        ctx.save();
        ctx.translate(x, y);
        // Top of glyph points toward center for upper arc (inward),
        // and away from center for lower arc (outward). That keeps
        // both labels right-side-up for the viewer.
        ctx.rotate(a + (inward ? -Math.PI / 2 : Math.PI / 2));
        ctx.fillText(text[i], 0, 0);
        ctx.restore();
      }
    };

    // Upper arc — caliber stamp, text faces inward.
    arcText("·  ETA  2824·2  AUTOMATIC  ·  TWENTY FIVE JEWELS  ·",
            yaw - Math.PI / 2, true);
    // Lower arc — adjustment certificate, text faces outward.
    arcText("·  ADJUSTED  FIVE  POSITIONS  ·  HEAT  COLD  ISOCHRONISM  ·",
            yaw + Math.PI / 2, false);

    ctx.restore();
  }

  function drawBridges(yaw) {
    // Walk a bridge's polyline once; for each call emit moveTo/lineTo in
    // screen space. Used for the body, drop shadow, and anglage layers.
    const tracePath = (br, dx = 0, dy = 0) => {
      ctx.beginPath();
      for (let i = 0; i < br.points.length; i++) {
        const [x, y] = U(br.points[i][0], br.points[i][1], yaw);
        if (i === 0) ctx.moveTo(x + dx, y + dy);
        else         ctx.lineTo(x + dx, y + dy);
      }
    };

    for (const br of bridges) {
      const w = br.width * R;

      // 1. Cast shadow — offset scales with zoom so the perceived lift
      //    off the plate stays constant regardless of ambient R.
      const shOff = w * 0.22;
      tracePath(br, shOff * 0.55, shOff);
      ctx.strokeStyle = col(C.shadow, 0.26);
      ctx.lineWidth = w * 1.10;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.stroke();

      // 2. Body — warm taupe with a faint lengthwise gradient so each
      //    bridge reads as a machined plate, not a flat stroke.
      const p0 = U(br.points[0][0], br.points[0][1], yaw);
      const pN = U(br.points[br.points.length - 1][0],
                   br.points[br.points.length - 1][1], yaw);
      const bodyGrad = ctx.createLinearGradient(p0[0], p0[1], pN[0], pN[1]);
      bodyGrad.addColorStop(0.00, col(C.plateMid, 0.24));
      bodyGrad.addColorStop(0.50, col(C.plateMid, 0.14));
      bodyGrad.addColorStop(1.00, col(C.plateMid, 0.22));
      tracePath(br);
      ctx.strokeStyle = bodyGrad;
      ctx.lineWidth = w;
      ctx.stroke();

      // 3. Anglage — proper beveled read: a wide gentle gradient face
      //    from the centerline to each edge, plus a crisp hairline at
      //    the edge itself. The gradient face is what your eye reads as
      //    a polished chamfer; the hairline defines the silhouette.
      for (let side of [+1, -1]) {
        for (let k = 0; k < 3; k++) {
          const frac = 0.14 + k * 0.14;
          const alpha = side > 0
            ? 0.10 + (1 - k / 2) * 0.18
            : 0.08 + (1 - k / 2) * 0.16;
          ctx.strokeStyle = side > 0
            ? col(C.plateHi, alpha)
            : col(C.shadow, alpha);
          ctx.lineWidth = Math.max(0.5, w * 0.08);
          for (let i = 0; i < br.points.length - 1; i++) {
            const [x1, y1] = U(br.points[i][0],     br.points[i][1],     yaw);
            const [x2, y2] = U(br.points[i + 1][0], br.points[i + 1][1], yaw);
            const tx = x2 - x1, ty = y2 - y1;
            const len = Math.hypot(tx, ty) || 1;
            const nx = -ty / len, ny = tx / len;
            const off = side * w * frac;
            ctx.beginPath();
            ctx.moveTo(x1 + nx * off, y1 + ny * off);
            ctx.lineTo(x2 + nx * off, y2 + ny * off);
            ctx.stroke();
          }
        }
      }
      // Crisp edge hairlines define the silhouette.
      for (let i = 0; i < br.points.length - 1; i++) {
        const [x1, y1] = U(br.points[i][0],     br.points[i][1],     yaw);
        const [x2, y2] = U(br.points[i + 1][0], br.points[i + 1][1], yaw);
        const tx = x2 - x1, ty = y2 - y1;
        const len = Math.hypot(tx, ty) || 1;
        const nx = -ty / len, ny = tx / len;
        const edgeOff = w * 0.48;
        ctx.strokeStyle = col(C.plateHi, 0.55);
        ctx.lineWidth = Math.max(0.5, w * 0.035);
        ctx.beginPath();
        ctx.moveTo(x1 + nx * edgeOff, y1 + ny * edgeOff);
        ctx.lineTo(x2 + nx * edgeOff, y2 + ny * edgeOff);
        ctx.stroke();
        ctx.strokeStyle = col(C.shadow, 0.55);
        ctx.lineWidth = Math.max(0.4, w * 0.030);
        ctx.beginPath();
        ctx.moveTo(x1 - nx * edgeOff, y1 - ny * edgeOff);
        ctx.lineTo(x2 - nx * edgeOff, y2 - ny * edgeOff);
        ctx.stroke();
      }

      // 4. Centerline highlight — very narrow specular spine.
      tracePath(br);
      ctx.strokeStyle = col(C.plateHi, 0.18);
      ctx.lineWidth = Math.max(0.5, w * 0.06);
      ctx.stroke();

      // 5. Endpoint screws — use the actual screw renderer, not a flat
      //    shadow dot. Countersunk well first, then screw on top.
      for (const [u, v] of [br.points[0], br.points[br.points.length - 1]]) {
        const [x, y] = U(u, v, yaw);
        const wellR   = w * 0.40;
        const screwR  = w * 0.24;
        // Counter-sink well.
        const well = ctx.createRadialGradient(
          x - wellR * 0.25, y - wellR * 0.25, wellR * 0.2,
          x, y, wellR,
        );
        well.addColorStop(0.00, col(C.plateDark, 0.00));
        well.addColorStop(0.75, col(C.plateDark, 0.00));
        well.addColorStop(1.00, col(C.shadow,    0.45));
        ctx.fillStyle = well;
        ctx.beginPath(); ctx.arc(x, y, wellR, 0, Math.PI * 2); ctx.fill();
        drawBluedScrew(x, y, screwR, Math.atan2(v, u) + 0.6);
      }
    }

    // 6. Engraved caliber label on the train bridge — tiny caps along
    //    the bridge centerline, each character rotated to the tangent.
    const trainBridge = bridges[2];
    if (trainBridge) {
      const pts = trainBridge.points;
      const text = "ETA  2824·2";
      const fontPx = Math.max(6, trainBridge.width * R * 0.34);
      ctx.save();
      ctx.font = `500 ${fontPx}px "Times New Roman", Georgia, serif`;
      ctx.fillStyle = col(C.shadow, 0.60);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tStart = 0.30, tEnd = 0.70;
      for (let i = 0; i < text.length; i++) {
        const tt  = tStart + ((tEnd - tStart) * (i + 0.5)) / text.length;
        const idx = tt * (pts.length - 1);
        const i0  = Math.max(0, Math.floor(idx));
        const i1  = Math.min(i0 + 1, pts.length - 1);
        const f   = idx - i0;
        const u   = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * f;
        const v   = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * f;
        const [x, y]   = U(u, v, yaw);
        const [nxS, nyS] = U(pts[i1][0], pts[i1][1], yaw);
        const [pxS, pyS] = U(pts[i0][0], pts[i0][1], yaw);
        const ang = Math.atan2(nyS - pyS, nxS - pxS);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.fillText(text[i], 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  /* Draw one stage of the gear train: wheel (big) + pinion (small) on
     the same arbor. Rotation direction alternates per stage because
     meshed gears turn opposite ways. Phasing (g.phaseBias) was computed
     at setup so teeth interleave at the mesh. */
  function drawGear(g, stageIdx, yaw, t, zoomFactor = 1) {
    const dir = stageIdx % 2 === 0 ? 1 : -1;
    const angle = yaw + dir * g.speed * t + g.phaseBias;
    const [sx, sy] = U(g.x, g.y, yaw);

    const wR = g.wheelR  * R;
    const pR = g.pinionR * R;

    // Cast shadow beneath the wheel — offset south-east, soft falloff.
    const shadowOff = wR * 0.10;
    const shadowGrad = ctx.createRadialGradient(
      sx + shadowOff, sy + shadowOff * 1.2, wR * 0.4,
      sx + shadowOff, sy + shadowOff * 1.2, wR * 1.12,
    );
    shadowGrad.addColorStop(0.0, col(C.shadow, 0.22));
    shadowGrad.addColorStop(1.0, col(C.shadow, 0.00));
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.arc(sx + shadowOff, sy + shadowOff * 1.2, wR * 1.12, 0, Math.PI * 2);
    ctx.fill();

    // Wheel body.
    const body = ctx.createRadialGradient(sx - wR * 0.3, sy - wR * 0.3, 0, sx, sy, wR);
    if (g.kind === "barrel") {
      body.addColorStop(0, col(C.plateHi, 0.30));
      body.addColorStop(1, col(C.plateDark, 0.38));
    } else if (g.kind === "escape") {
      body.addColorStop(0, col(C.steel, 0.40));
      body.addColorStop(1, col(C.steel, 0.62));
    } else {
      body.addColorStop(0, col(C.gold, 0.32));
      body.addColorStop(1, col(C.plateDark, 0.42));
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(sx, sy, wR, 0, Math.PI * 2); ctx.fill();

    // Wheel teeth.
    if (g.kind === "escape") {
      // Swiss lever "club" tooth — asymmetric. Deeper contrast between
      // the vertical hook face and the sloped impulse face sells the
      // ratchet character at the new zoom.
      ctx.fillStyle = col(C.steel, 0.80);
      ctx.strokeStyle = col(C.shadow, 0.85);
      ctx.lineWidth = 0.75;
      const teeth = g.wheelT;
      const toothPitch = (Math.PI * 2) / teeth;
      const rBase = wR * 0.78;
      const rTip  = wR;
      for (let i = 0; i < teeth; i++) {
        const a = angle + i * toothPitch;
        const aRootTrail = a - toothPitch * 0.48;
        const aRootLead  = a + toothPitch * 0.02;
        const aTipLead   = a + toothPitch * 0.28;
        const aTipTrail  = a - toothPitch * 0.12;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(aRootTrail) * rBase, sy + Math.sin(aRootTrail) * rBase);
        ctx.lineTo(sx + Math.cos(aRootLead)  * rBase, sy + Math.sin(aRootLead)  * rBase);
        ctx.lineTo(sx + Math.cos(aTipLead)   * rTip,  sy + Math.sin(aTipLead)   * rTip);
        ctx.lineTo(sx + Math.cos(aTipTrail)  * rTip,  sy + Math.sin(aTipTrail)  * rTip);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        // Hook face highlight — polished impulse plane catches light.
        ctx.strokeStyle = col(C.plateHi, 0.35);
        ctx.lineWidth = 0.45;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(aRootLead) * rBase, sy + Math.sin(aRootLead) * rBase);
        ctx.lineTo(sx + Math.cos(aTipLead)  * rTip,  sy + Math.sin(aTipLead)  * rTip);
        ctx.stroke();
        ctx.strokeStyle = col(C.shadow, 0.85);
        ctx.lineWidth = 0.75;
      }
    } else {
      // Curved-flank tooth — two samples per flank so the tooth reads as
      // involute rather than a trapezoid. Depth bumped for the new zoom.
      ctx.strokeStyle = col(C.plateDark, 0.50);
      ctx.lineWidth = 0.85;
      ctx.fillStyle = body;
      const teeth = g.wheelT;
      const toothPitch = (Math.PI * 2) / teeth;
      const toothDepth = 0.115;
      const rRoot = wR * (1 - toothDepth * 0.55);
      const rMid  = wR * (1 + toothDepth * 0.25);
      const rTip  = wR * (1 + toothDepth);
      ctx.beginPath();
      for (let i = 0; i < teeth; i++) {
        const aC = angle + i * toothPitch;
        const aRoot0 = aC - toothPitch * 0.48;
        const aFlk0  = aC - toothPitch * 0.36;
        const aMid0  = aC - toothPitch * 0.22;
        const aTip0  = aC - toothPitch * 0.13;
        const aTip1  = aC + toothPitch * 0.13;
        const aMid1  = aC + toothPitch * 0.22;
        const aFlk1  = aC + toothPitch * 0.36;
        const aRoot1 = aC + toothPitch * 0.48;
        if (i === 0) ctx.moveTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        else         ctx.lineTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        // Up the leading flank — root → mid → tip (curving outward).
        ctx.lineTo(sx + Math.cos(aFlk0) * (rRoot * 0.45 + rMid * 0.55),
                   sy + Math.sin(aFlk0) * (rRoot * 0.45 + rMid * 0.55));
        ctx.lineTo(sx + Math.cos(aMid0) * rMid, sy + Math.sin(aMid0) * rMid);
        ctx.lineTo(sx + Math.cos(aTip0) * rTip, sy + Math.sin(aTip0) * rTip);
        // Across the tip.
        ctx.lineTo(sx + Math.cos(aTip1) * rTip, sy + Math.sin(aTip1) * rTip);
        // Down the trailing flank.
        ctx.lineTo(sx + Math.cos(aMid1) * rMid, sy + Math.sin(aMid1) * rMid);
        ctx.lineTo(sx + Math.cos(aFlk1) * (rRoot * 0.45 + rMid * 0.55),
                   sy + Math.sin(aFlk1) * (rRoot * 0.45 + rMid * 0.55));
        ctx.lineTo(sx + Math.cos(aRoot1) * rRoot, sy + Math.sin(aRoot1) * rRoot);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // Sunburst face finish — fine radial hairlines from hub to rim,
    // clipped to the wheel body. Common "soleillage" finish on polished
    // train wheels. Skip escape wheels (raw steel, not decorated) and
    // the barrel (its face is covered by the mainspring spiral).
    if (g.kind !== "escape" && g.kind !== "barrel") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, wR * 0.90, 0, Math.PI * 2);
      ctx.clip();
      // 48 rays read as individual hairlines at close zoom instead of
      // blurring into a fill. Counter-rays removed — a single set at
      // stronger alpha reads more convincingly as tool marks.
      const rays = 48;
      ctx.strokeStyle = col(C.plateHi, 0.09);
      ctx.lineWidth = 0.5;
      for (let i = 0; i < rays; i++) {
        const a = angle + (i / rays) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * wR * 0.90, sy + Math.sin(a) * wR * 0.90);
        ctx.stroke();
      }
      // Directional specular wedge — the side facing the light gets a
      // brighter sweep, which is what sunburst finishing actually does.
      ctx.strokeStyle = col(C.plateHi, 0.14);
      ctx.lineWidth = 0.55;
      const hotStart = angle - Math.PI * 0.60;
      for (let i = 0; i < 12; i++) {
        const a = hotStart + (i / 12) * Math.PI * 0.6;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * wR * 0.90, sy + Math.sin(a) * wR * 0.90);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Spokes (gear wheels, not escape, not barrel — barrel gets a
    // mainspring spiral instead since a real mainspring barrel is a
    // solid cap with the spring coiled inside, not a spoked wheel).
    if (g.kind !== "escape" && g.kind !== "barrel") {
      const spokes = g.kind === "barrel" ? 6 : 4;
      const spokeLW = Math.max(1, wR * 0.05);
      const rInner = Math.max(pR * 1.35, wR * 0.18);
      const rOuter = wR * 0.88;
      const gearClose = zoomFactor > 1.5;
      const gearVeryClose = zoomFactor > 5.0;

      ctx.strokeStyle = col(C.plateDark, 0.42);
      ctx.lineWidth = spokeLW;
      for (let i = 0; i < spokes; i++) {
        const a = angle + (i / spokes) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * rInner, sy + Math.sin(a) * rInner);
        ctx.lineTo(sx + Math.cos(a) * rOuter, sy + Math.sin(a) * rOuter);
        ctx.stroke();
      }

      // Closeup: round-bar shading so each spoke reads as a machined bar.
      if (gearClose) {
        for (let i = 0; i < spokes; i++) {
          const a = angle + (i / spokes) * Math.PI * 2;
          const perp = a + Math.PI / 2;
          const offset = spokeLW * 0.28;

          ctx.strokeStyle = `rgba(255, 245, 225, ${gearVeryClose ? 0.45 : 0.30})`;
          ctx.lineWidth = Math.max(0.8, spokeLW * 0.20);
          ctx.beginPath();
          ctx.moveTo(
            sx + Math.cos(a) * rInner + Math.cos(perp) * offset,
            sy + Math.sin(a) * rInner + Math.sin(perp) * offset,
          );
          ctx.lineTo(
            sx + Math.cos(a) * rOuter + Math.cos(perp) * offset,
            sy + Math.sin(a) * rOuter + Math.sin(perp) * offset,
          );
          ctx.stroke();

          ctx.strokeStyle = col(C.shadow, gearVeryClose ? 0.55 : 0.35);
          ctx.lineWidth = Math.max(0.8, spokeLW * 0.18);
          ctx.beginPath();
          ctx.moveTo(
            sx + Math.cos(a) * rInner - Math.cos(perp) * offset,
            sy + Math.sin(a) * rInner - Math.sin(perp) * offset,
          );
          ctx.lineTo(
            sx + Math.cos(a) * rOuter - Math.cos(perp) * offset,
            sy + Math.sin(a) * rOuter - Math.sin(perp) * offset,
          );
          ctx.stroke();

          if (gearVeryClose) {
            ctx.strokeStyle = col(C.shadow, 0.30);
            ctx.lineWidth = Math.max(0.4, spokeLW * 0.06);
            ctx.beginPath();
            ctx.moveTo(sx + Math.cos(a) * rInner, sy + Math.sin(a) * rInner);
            ctx.lineTo(sx + Math.cos(a) * rOuter, sy + Math.sin(a) * rOuter);
            ctx.stroke();
          }
        }

        if (gearVeryClose) {
          for (let i = 0; i < spokes; i++) {
            const a = angle + (i / spokes) * Math.PI * 2;
            ctx.fillStyle = col(C.plateDark, 0.30);
            ctx.beginPath();
            ctx.arc(
              sx + Math.cos(a) * (rInner * 1.02),
              sy + Math.sin(a) * (rInner * 1.02),
              spokeLW * 0.9, 0, Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
    }

    // Pinion — present on every stage except the last, since the last
    // stage has no downstream wheel to drive.
    const isLast = stageIdx === gears.length - 1;
    if (!isLast && g.kind !== "escape") {
      const gearVeryClose = zoomFactor > 5.0;
      const pBody = ctx.createRadialGradient(sx - pR * 0.3, sy - pR * 0.3, 0, sx, sy, pR);
      if (gearVeryClose) {
        pBody.addColorStop(0,   "rgba(180, 148, 112, 0.88)");
        pBody.addColorStop(0.6, "rgba(98, 74, 52, 0.95)");
        pBody.addColorStop(1,   "rgba(42, 28, 16, 0.97)");
      } else {
        pBody.addColorStop(0, col(C.steel, 0.60));
        pBody.addColorStop(1, col(C.shadow, 0.70));
      }
      ctx.fillStyle = pBody;
      ctx.beginPath(); ctx.arc(sx, sy, pR, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = col(C.shadow, 0.85);
      ctx.lineWidth = 0.7;
      ctx.fillStyle = pBody;
      const tCount = g.pinionT;
      const tPitch = (Math.PI * 2) / tCount;
      const rRoot = pR * 0.80;
      const rMid  = pR * 1.02;
      const rTip  = pR * 1.22;
      ctx.beginPath();
      for (let i = 0; i < tCount; i++) {
        const aC = angle + i * tPitch;
        const aRoot0 = aC - tPitch * 0.46;
        const aFlk0  = aC - tPitch * 0.22;
        const aTip0  = aC - tPitch * 0.10;
        const aTip1  = aC + tPitch * 0.10;
        const aFlk1  = aC + tPitch * 0.22;
        const aRoot1 = aC + tPitch * 0.46;
        if (i === 0) ctx.moveTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        else         ctx.lineTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        ctx.lineTo(sx + Math.cos(aFlk0) * rMid, sy + Math.sin(aFlk0) * rMid);
        ctx.lineTo(sx + Math.cos(aTip0) * rTip, sy + Math.sin(aTip0) * rTip);
        ctx.lineTo(sx + Math.cos(aTip1) * rTip, sy + Math.sin(aTip1) * rTip);
        ctx.lineTo(sx + Math.cos(aFlk1) * rMid, sy + Math.sin(aFlk1) * rMid);
        ctx.lineTo(sx + Math.cos(aRoot1) * rRoot, sy + Math.sin(aRoot1) * rRoot);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Polished crescent highlight — always drawn now that ambient is
      // zoomed in. Brightens the upper-left arc of the pinion.
      ctx.strokeStyle = "rgba(255, 245, 225, 0.48)";
      ctx.lineWidth = Math.max(0.5, pR * 0.06);
      ctx.beginPath();
      ctx.arc(sx, sy, pR * 0.92, -Math.PI * 0.85, -Math.PI * 0.25);
      ctx.stroke();
    }

    // Mainspring — tight Archimedean spiral inside the barrel cap.
    // On a real watch this lives between the barrel disc and the
    // barrel drum; coils wind / unwind as the watch runs, giving the
    // barrel its 2 hr/rev output. Spiral rotates with the barrel.
    if (g.kind === "barrel") {
      const rOuter = wR * 0.78;
      const rInner = Math.max(pR * 1.35, wR * 0.18);
      // More turns + finer line weight — at the new zoom the old 11
      // turns read as a stack of rings, not a spring. 18 turns with
      // thinner ribbon reads as coiled blue steel.
      const turns = 18;
      const samples = turns * 72;
      const thetaMax = turns * Math.PI * 2;

      const spiralPath = () => {
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const theta = (i / samples) * thetaMax;
          const rr = rInner + (rOuter - rInner) * (theta / thetaMax);
          const a = angle + theta;
          const x = sx + Math.cos(a) * rr;
          const y = sy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      };

      // Dark base pass.
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = col(C.steelBlue, 0.38);
      ctx.lineWidth = Math.max(0.6, wR * 0.009);
      spiralPath(); ctx.stroke();
      // Shadow trailing edge (one pixel offset inward).
      ctx.strokeStyle = col(C.shadow, 0.20);
      ctx.lineWidth = Math.max(0.4, wR * 0.004);
      spiralPath(); ctx.stroke();
      // Bright polish pass — thin highlight on each coil.
      ctx.strokeStyle = col(C.plateHi, 0.22);
      ctx.lineWidth = Math.max(0.3, wR * 0.003);
      spiralPath(); ctx.stroke();
    }

    // Central hub / arbor.
    if (g.kind === "escape") {
      const hubR = pR * 0.9;
      const hubBody = ctx.createRadialGradient(sx - hubR * 0.3, sy - hubR * 0.3, 0, sx, sy, hubR);
      hubBody.addColorStop(0, col(C.steel, 0.70));
      hubBody.addColorStop(1, col(C.shadow, 0.75));
      ctx.fillStyle = hubBody;
      ctx.beginPath(); ctx.arc(sx, sy, hubR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col(C.shadow, 0.70);
      ctx.beginPath(); ctx.arc(sx, sy, hubR * 0.35, 0, Math.PI * 2); ctx.fill();
    } else {
      // Larger hub centering dot — previous 0.18 of pinion radius
      // vanished at close zoom. 0.28 reads as a proper arbor cap.
      const hubR = Math.max(1.4, pR * 0.28);
      if (zoomFactor > 1.5 && g.kind !== "barrel") {
        const hubGrad = ctx.createRadialGradient(
          sx - hubR * 0.35, sy - hubR * 0.4, 0, sx, sy, hubR * 1.1,
        );
        hubGrad.addColorStop(0,   "rgba(180, 150, 115, 0.88)");
        hubGrad.addColorStop(0.6, "rgba(108, 82, 58, 0.92)");
        hubGrad.addColorStop(1,   "rgba(54, 38, 24, 0.94)");
        ctx.fillStyle = hubGrad;
        ctx.beginPath(); ctx.arc(sx, sy, hubR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(42, 28, 16, 0.68)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255, 245, 225, 0.45)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(sx, sy, hubR * 0.9, -Math.PI * 0.85, -Math.PI * 0.25);
        ctx.stroke();
        ctx.fillStyle = "rgba(42, 28, 16, 0.90)";
        ctx.beginPath(); ctx.arc(sx, sy, hubR * 0.22, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = col(C.shadow, 0.55);
        ctx.beginPath(); ctx.arc(sx, sy, hubR, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Wheel rim polish — dark seat at the tooth roots + bright polish
    // crescent catching light on the upper-left arc.
    ctx.strokeStyle = col(C.plateDark, 0.48);
    ctx.lineWidth = Math.max(0.6, wR * 0.012);
    ctx.beginPath(); ctx.arc(sx, sy, wR, 0, Math.PI * 2); ctx.stroke();
    if (g.kind !== "escape") {
      ctx.strokeStyle = col(C.plateHi, 0.28);
      ctx.lineWidth = Math.max(0.5, wR * 0.008);
      ctx.beginPath();
      ctx.arc(sx, sy, wR * 0.985, -Math.PI * 0.85, -Math.PI * 0.25);
      ctx.stroke();
    }
  }

  /* Swiss lever (pallet fork) — anchor-shaped lever pivoting on a pin
     with two ruby pallet stones at asymmetric geometries. Bi-stable
     motion: most of the cycle at ±1 rest, brief transit between. Real
     lock angle is ~5–7°; we use ~6° peak swing. */
  function drawPallet(t, yaw) {
    const phase = Math.sin((2 * Math.PI * balance.freqHz * t) / 1000);
    const bistable = Math.tanh(phase * 4.5);
    const swingDeg = 6;
    const ang = yaw + bistable * ((swingDeg * Math.PI) / 180);

    const [px, py] = U(pallet.x, pallet.y, yaw);
    const L  = pallet.armLen  * R;
    const W2 = pallet.armWidth * R;
    const forkR = pallet.forkReach * R;

    const toBalance = Math.atan2(balance.y - pallet.y, balance.x - pallet.x);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(toBalance + ang);

    // Anchor-shaped lever body. Drawn twice: a gold-plate undercoat
    // tint first (real Swiss levers are usually gilded or rhodium-
    // plated), then the polished steel face on top, which lets the
    // warm metal bleed at the edges and reads as plating.
    const leverPath = () => {
      ctx.beginPath();
      ctx.moveTo( forkR,        -W2 * 1.3);
      ctx.lineTo( forkR * 1.10,  0);
      ctx.lineTo( forkR,         W2 * 1.3);
      ctx.lineTo( W2 * 0.8,      W2 * 0.5);
      ctx.lineTo(-W2 * 0.8,      W2 * 0.5);
      ctx.lineTo(-L * 0.95,      L * 0.48);
      ctx.lineTo(-L * 1.05,      L * 0.38);
      ctx.lineTo(-L * 0.25,      W2 * 0.4);
      ctx.lineTo(-L * 0.25,     -W2 * 0.4);
      ctx.lineTo(-L * 1.05,     -L * 0.38);
      ctx.lineTo(-L * 0.95,     -L * 0.48);
      ctx.lineTo(-W2 * 0.8,     -W2 * 0.5);
      ctx.lineTo( W2 * 0.8,     -W2 * 0.5);
      ctx.closePath();
    };
    // Gold-plate undercoat (warm base bleeds through at edges).
    leverPath();
    ctx.fillStyle = col(C.gold, 0.55);
    ctx.fill();
    // Steel face, slightly inset by the 0.8 stroke width so a thin
    // gold rim stays visible around the perimeter.
    leverPath();
    const bodyGrad = ctx.createLinearGradient(0, -L * 0.5, 0, L * 0.5);
    bodyGrad.addColorStop(0.0, col(C.steel, 0.70));
    bodyGrad.addColorStop(0.5, col(C.steel, 0.55));
    bodyGrad.addColorStop(1.0, col(C.steel, 0.72));
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    // Anglage — wider gold bleed (1.4px inset) + hairline highlight.
    ctx.strokeStyle = col(C.shadow, 0.78);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.save();
    leverPath();
    ctx.clip();
    leverPath();
    ctx.strokeStyle = col(C.plateHi, 0.34);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // Fork notch — deeper slot so it reads as a fork opening, not a
    // painted line. Two tones: base dark + hairline shadow on lip.
    ctx.fillStyle = col(C.shadow, 0.55);
    ctx.beginPath();
    ctx.moveTo(forkR * 1.05,  W2 * 0.55);
    ctx.lineTo(forkR * 0.62,  W2 * 0.18);
    ctx.lineTo(forkR * 0.62, -W2 * 0.18);
    ctx.lineTo(forkR * 1.05, -W2 * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col(C.shadow, 0.85);
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Guard pin — a dowel with a bright polished tip.
    const gpX = forkR * 0.68, gpR = W2 * 0.25;
    const gpGrad = ctx.createRadialGradient(
      gpX - gpR * 0.35, -gpR * 0.35, 0, gpX, 0, gpR,
    );
    gpGrad.addColorStop(0.0, col(C.plateHi, 0.55));
    gpGrad.addColorStop(0.7, col(C.steel,   0.75));
    gpGrad.addColorStop(1.0, col(C.shadow,  0.70));
    ctx.fillStyle = gpGrad;
    ctx.beginPath(); ctx.arc(gpX, 0, gpR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col(C.shadow, 0.70);
    ctx.lineWidth = 0.4;
    ctx.stroke();

    // Pallet stones: entry is marginally longer than exit (Swiss lever
    // asymmetry) and the two sit at slightly different lock angles.
    // Both are polished synthetic ruby with a gold setting tint.
    const stones = [
      { x: -L * 1.02, y: -L * 0.42, angle: -0.35, w: 1.24, h: 0.92 }, // entry (longer)
      { x: -L * 1.02, y:  L * 0.42, angle:  0.52, w: 0.86, h: 0.84 }, // exit (shorter)
    ];
    for (const p of stones) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      // Gold setting frame.
      ctx.fillStyle = col(C.gold, 0.70);
      ctx.beginPath();
      ctx.rect(-W2 * 0.58 * p.w, -W2 * 0.52 * p.h,
                W2 * 1.16 * p.w,  W2 * 1.04 * p.h);
      ctx.fill();
      // Ruby stone body with lengthwise gradient.
      const rubyGrad = ctx.createLinearGradient(-W2 * 0.5 * p.w, 0, W2 * 0.5 * p.w, 0);
      rubyGrad.addColorStop(0.00, "rgba(128, 54, 30, 0.95)");
      rubyGrad.addColorStop(0.40, col(C.ruby, 0.92));
      rubyGrad.addColorStop(0.75, "rgba(218, 142, 108, 0.95)");
      rubyGrad.addColorStop(1.00, "rgba(128, 54, 30, 0.95)");
      ctx.fillStyle = rubyGrad;
      ctx.strokeStyle = col(C.shadow, 0.75);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.rect(-W2 * 0.5 * p.w, -W2 * 0.45 * p.h,
                W2 * 1.0 * p.w,  W2 * 0.90 * p.h);
      ctx.fill(); ctx.stroke();
      // Specular highlight on the impulse face — calmed and gradient'd
      // instead of a hot flat rectangle.
      const speGrad = ctx.createLinearGradient(
        0, -W2 * 0.45 * p.h, 0, -W2 * 0.2 * p.h,
      );
      speGrad.addColorStop(0, "rgba(255, 232, 210, 0.42)");
      speGrad.addColorStop(1, "rgba(255, 232, 210, 0.00)");
      ctx.fillStyle = speGrad;
      ctx.beginPath();
      ctx.rect(-W2 * 0.40 * p.w, -W2 * 0.45 * p.h,
                W2 * 0.80 * p.w,  W2 * 0.25 * p.h);
      ctx.fill();
      // Impulse face edge — thin bright line.
      ctx.strokeStyle = "rgba(255, 220, 195, 0.45)";
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(-W2 * 0.48 * p.w, -W2 * 0.44 * p.h);
      ctx.lineTo( W2 * 0.48 * p.w, -W2 * 0.44 * p.h);
      ctx.stroke();
      ctx.restore();
    }

    // Pivot jewel.
    ctx.fillStyle = col(C.gold, 0.50);
    ctx.beginPath(); ctx.arc(0, 0, W2 * 0.95, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col(C.ruby, 0.80);
    ctx.beginPath(); ctx.arc(0, 0, W2 * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col(C.shadow, 0.80);
    ctx.beginPath(); ctx.arc(0, 0, W2 * 0.18, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawBalanceWheel(t, yaw, zoomFactor = 1) {
    const phase = Math.sin((2 * Math.PI * balance.freqHz * t) / 1000);
    const ang = yaw + phase * balance.amp;
    const [bx, by] = U(balance.x, balance.y, yaw);
    const rr = balance.r * R;

    const closeUp = zoomFactor > 1.5;
    const veryClose = zoomFactor > 3.0;

    ctx.save();
    ctx.translate(bx, by);

    // Hairspring — breathing spiral. More turns + thinner line at the
    // new zoom so the coil reads as filament, not wire.
    const breathe = 1 + phase * 0.04;
    const turns = closeUp ? 12 : 9;
    const segs = closeUp ? 480 : 240;
    const hairLW = Math.max(0.45, rr * 0.006);
    const innerR = rr * 0.12;
    const outerR = rr * (closeUp ? 0.64 : 0.58);

    ctx.strokeStyle = col(C.steelBlue, closeUp ? 0.72 : 0.58);
    ctx.lineWidth = hairLW;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const tt = i / segs;
      const a = tt * turns * Math.PI * 2 + ang * (1 - tt);
      const r = (innerR + tt * (outerR - innerR)) * breathe;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (closeUp) {
      const studA = turns * Math.PI * 2 + ang;
      const studX = Math.cos(studA) * outerR * breathe;
      const studY = Math.sin(studA) * outerR * breathe;
      // Stud block — rectangular gold carrier that pins the spring's
      // outer end to the balance cock. More prominent than a bare dot.
      ctx.save();
      ctx.translate(studX, studY);
      ctx.rotate(studA + Math.PI / 2);
      const studW = rr * 0.060, studH = rr * 0.040;
      const studGrad = ctx.createLinearGradient(0, -studH, 0, studH);
      studGrad.addColorStop(0.0, col(C.gold, 0.85));
      studGrad.addColorStop(0.5, col(C.gold, 0.60));
      studGrad.addColorStop(1.0, col(C.shadow, 0.70));
      ctx.fillStyle = studGrad;
      ctx.fillRect(-studW / 2, -studH / 2, studW, studH);
      ctx.strokeStyle = col(C.shadow, 0.75);
      ctx.lineWidth = 0.4;
      ctx.strokeRect(-studW / 2, -studH / 2, studW, studH);
      // Tiny fixing screw in the stud.
      ctx.fillStyle = col(C.steelBlue, 0.85);
      ctx.beginPath();
      ctx.arc(0, 0, rr * 0.012, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Regulator curb pins — two blued pins straddling the outer coil
      // just before the stud. Moving the regulator slides these along
      // the spring to change the effective length (and thus rate).
      const curbA = studA - 0.28;
      const curbR = outerR * 0.98 * breathe;
      const curbTx = -Math.sin(curbA), curbTy = Math.cos(curbA);
      const curbGap = rr * 0.032;
      for (const side of [-1, 1]) {
        const cpx = Math.cos(curbA) * curbR + curbTx * side * curbGap;
        const cpy = Math.sin(curbA) * curbR + curbTy * side * curbGap;
        const cpr = rr * 0.012;
        const cpGrad = ctx.createRadialGradient(
          cpx - cpr * 0.3, cpy - cpr * 0.3, 0, cpx, cpy, cpr,
        );
        cpGrad.addColorStop(0, col(C.plateHi,   0.45));
        cpGrad.addColorStop(1, col(C.steelBlue, 0.90));
        ctx.fillStyle = cpGrad;
        ctx.beginPath(); ctx.arc(cpx, cpy, cpr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col(C.shadow, 0.65);
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }

      // Regulator index marks.
      ctx.strokeStyle = col(C.shadow, 0.45);
      ctx.lineWidth = 0.5;
      for (let k = -2; k <= 2; k++) {
        const ma = studA + k * 0.06;
        const r1 = outerR * 1.02, r2 = outerR * 1.08;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ma) * r1, Math.sin(ma) * r1);
        ctx.lineTo(Math.cos(ma) * r2, Math.sin(ma) * r2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Balance wheel — rotates with balance.
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(ang);

    const rimR = rr * 0.95;
    const rimW = Math.max(1.6, rr * 0.075);
    ctx.strokeStyle = col(C.gold, 0.75);
    ctx.lineWidth = rimW;
    ctx.beginPath(); ctx.arc(0, 0, rimR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col(C.shadow, 0.35);
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(0, 0, rimR, 0, Math.PI * 2); ctx.stroke();

    if (closeUp) {
      // Brushed circular polish marks on the gold rim.
      ctx.strokeStyle = col(C.gold, 0.22);
      ctx.lineWidth = 0.4;
      const polishMarks = 72;
      for (let i = 0; i < polishMarks; i++) {
        const a = (i / polishMarks) * Math.PI * 2;
        const r1 = rimR - rimW * 0.35;
        const r2 = rimR + rimW * 0.10;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.strokeStyle = col(C.shadow, 0.25);
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(0, 0, rimR - rimW * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255, 245, 225, 0.42)";
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, rimR + rimW * 0.2, -Math.PI * 0.85, -Math.PI * 0.25);
      ctx.stroke();
    }

    // Crossbar.
    ctx.strokeStyle = col(C.gold, 0.7);
    ctx.lineWidth = Math.max(1.2, rr * 0.045);
    ctx.beginPath();
    ctx.moveTo(-rimR, 0); ctx.lineTo(rimR, 0);
    ctx.stroke();

    if (closeUp) {
      ctx.strokeStyle = "rgba(255, 245, 225, 0.48)";
      ctx.lineWidth = Math.max(0.4, rr * 0.015);
      ctx.beginPath();
      ctx.moveTo(-rimR * 0.95, -rr * 0.012);
      ctx.lineTo( rimR * 0.95, -rr * 0.012);
      ctx.stroke();
      ctx.strokeStyle = col(C.shadow, 0.4);
      ctx.lineWidth = Math.max(0.4, rr * 0.012);
      ctx.beginPath();
      ctx.moveTo(-rimR * 0.95, rr * 0.020);
      ctx.lineTo( rimR * 0.95, rr * 0.020);
      ctx.stroke();
    }

    // Timing screws — now always routed through drawBluedScrew so each
    // one shows the proper slot + polished head at ambient zoom.
    const screwCount = 8;
    for (let i = 0; i < screwCount; i++) {
      const a = (i / screwCount) * Math.PI * 2;
      const x = Math.cos(a) * rimR, y = Math.sin(a) * rimR;
      const sz = Math.max(1.4, rr * 0.065);
      drawBluedScrew(x, y, sz, a + Math.PI / 4);
    }

    // Impulse roller + impulse jewel.
    const toPallet = Math.atan2(pallet.y - balance.y, pallet.x - balance.x);

    if (closeUp) {
      const rollerR = rr * 0.22;
      const rollerGrad = ctx.createRadialGradient(
        -rollerR * 0.3, -rollerR * 0.3, 0, 0, 0, rollerR,
      );
      rollerGrad.addColorStop(0, "rgba(165, 138, 105, 0.75)");
      rollerGrad.addColorStop(1, "rgba(68, 48, 32, 0.85)");
      ctx.fillStyle = rollerGrad;
      ctx.beginPath(); ctx.arc(0, 0, rollerR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col(C.shadow, 0.60);
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // Safety crescent notch.
      ctx.fillStyle = col(C.shadow, 0.55);
      ctx.beginPath();
      ctx.arc(0, 0, rollerR * 0.72, toPallet - ang - 0.9, toPallet - ang + 0.9);
      ctx.arc(0, 0, rollerR * 0.55, toPallet - ang + 0.9, toPallet - ang - 0.9, true);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = col(C.steel, 0.65);
      ctx.beginPath(); ctx.arc(0, 0, rr * 0.20, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col(C.shadow, 0.5);
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    const ijAngle = toPallet - ang;
    const ijR = rr * (closeUp ? 0.22 : 0.18);
    const ijX = Math.cos(ijAngle) * ijR;
    const ijY = Math.sin(ijAngle) * ijR;

    if (veryClose) {
      ctx.save();
      ctx.translate(ijX, ijY);
      ctx.rotate(ijAngle);
      const w = rr * 0.055, h = rr * 0.080;
      ctx.fillStyle = "rgba(108, 54, 32, 0.75)";
      ctx.fillRect(-w, -h / 2 + 0.5, w * 2, h);
      const rubyGrad = ctx.createLinearGradient(-w, 0, w, 0);
      rubyGrad.addColorStop(0,   "rgba(164, 79, 48, 0.95)");
      rubyGrad.addColorStop(0.4, "rgba(215, 130, 85, 0.98)");
      rubyGrad.addColorStop(1,   "rgba(128, 54, 30, 0.95)");
      ctx.fillStyle = rubyGrad;
      ctx.fillRect(-w, -h / 2, w * 2, h);
      ctx.strokeStyle = "rgba(250, 225, 200, 0.55)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-w * 0.8, -h / 2 + 0.4);
      ctx.lineTo( w * 0.8, -h / 2 + 0.4);
      ctx.stroke();
      ctx.restore();
    } else if (closeUp) {
      ctx.fillStyle = col(C.ruby, 0.95);
      ctx.beginPath();
      ctx.ellipse(ijX, ijY, rr * 0.055, rr * 0.032, ijAngle, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col(C.shadow, 0.70);
      ctx.lineWidth = 0.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = col(C.ruby, 0.95);
      ctx.beginPath(); ctx.arc(ijX, ijY, rr * 0.045, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col(C.shadow, 0.7);
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Central staff.
    ctx.fillStyle = col(C.steel, 0.85);
    ctx.beginPath(); ctx.arc(0, 0, rr * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col(C.shadow, 0.7);
    ctx.beginPath(); ctx.arc(0, 0, rr * 0.035, 0, Math.PI * 2); ctx.fill();

    if (veryClose) {
      ctx.strokeStyle = col(C.shadow, 0.5);
      ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.arc(0, 0, rr * 0.055, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /* Jewels drawn as countersunk chatons, top to bottom:
       1. Plate surface
       2. Countersunk well (chamfer ring catches light on one edge, shadow on other)
       3. Gold chaton (thin ring pressed into the well)
       4. Ruby cabochon (dome-shape — NOT faceted; depth from color, not white spec)
       5. Arbor hole in the center
     Balance + pallet jewels additionally get chaton screws. */
  function drawJewel(j, x, y) {
    const s = j.size * R;

    // 1. Countersunk well.
    const wellR = s * 1.95;
    const chamfer = ctx.createRadialGradient(
      x - wellR * 0.25, y - wellR * 0.25, wellR * 0.4,
      x, y, wellR,
    );
    chamfer.addColorStop(0.00, col(C.plateDark, 0.00));
    chamfer.addColorStop(0.72, col(C.plateDark, 0.00));
    chamfer.addColorStop(0.92, col(C.shadow,    0.32));
    chamfer.addColorStop(1.00, col(C.shadow,    0.45));
    ctx.fillStyle = chamfer;
    ctx.beginPath(); ctx.arc(x, y, wellR, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = col(C.plateHi, 0.55);
    ctx.lineWidth = Math.max(0.6, s * 0.10);
    ctx.beginPath();
    ctx.arc(x, y, wellR * 0.96, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.stroke();

    // 2. Gold chaton ring — widened band so the gold reads at new zoom.
    const chatonOuter = s * 1.62;
    const chatonInner = s * 1.10;
    const chatonGrad = ctx.createRadialGradient(
      x - chatonOuter * 0.3, y - chatonOuter * 0.3, 0,
      x, y, chatonOuter,
    );
    chatonGrad.addColorStop(0, col(C.gold, 0.85));
    chatonGrad.addColorStop(0.7, col(C.gold, 0.70));
    chatonGrad.addColorStop(1, col(C.plateDark, 0.70));
    ctx.fillStyle = chatonGrad;
    ctx.beginPath(); ctx.arc(x, y, chatonOuter, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(x, y, chatonInner, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    ctx.strokeStyle = col(C.shadow, 0.55);
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(x, y, chatonOuter, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col(C.plateHi, 0.50);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, chatonOuter * 0.98, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.stroke();
    ctx.strokeStyle = col(C.shadow, 0.7);
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(x, y, chatonInner, 0, Math.PI * 2); ctx.stroke();

    // 3. Ruby cabochon (polished dome, NOT faceted).
    const rubyGrad = ctx.createRadialGradient(
      x - s * 0.30, y - s * 0.35, 0,
      x, y, s * 1.05,
    );
    rubyGrad.addColorStop(0.00, "rgba(225, 158, 128, 0.82)");
    rubyGrad.addColorStop(0.45, col(C.ruby, 0.88));
    rubyGrad.addColorStop(0.85, col(C.ruby, 0.95));
    rubyGrad.addColorStop(1.00, "rgba(120, 50, 28, 0.95)");
    ctx.fillStyle = rubyGrad;
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();

    // Catchlight — thin crescent along upper-left rim.
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = "rgba(250, 220, 200, 0.42)";
    ctx.lineWidth = Math.max(0.5, s * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, s * 0.82, -Math.PI * 0.85, -Math.PI * 0.35);
    ctx.stroke();
    ctx.restore();

    // Tight specular hot-spot — shrunk so it reads as a wet pinpoint
    // rather than taking over the dome. Size now 0.18 of jewel radius.
    const hotX = x - s * 0.30, hotY = y - s * 0.32;
    const hot = ctx.createRadialGradient(hotX, hotY, 0, hotX, hotY, s * 0.18);
    hot.addColorStop(0.0, "rgba(255, 245, 230, 0.92)");
    hot.addColorStop(0.5, "rgba(255, 240, 220, 0.35)");
    hot.addColorStop(1.0, "rgba(255, 240, 220, 0.00)");
    ctx.fillStyle = hot;
    ctx.beginPath(); ctx.arc(hotX, hotY, s * 0.18, 0, Math.PI * 2); ctx.fill();

    // Rim shadow on the opposite side — sells the dome curvature.
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = "rgba(60, 30, 18, 0.50)";
    ctx.lineWidth = Math.max(0.5, s * 0.10);
    ctx.beginPath();
    ctx.arc(x, y, s * 0.92, Math.PI * 0.1, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();

    // Secondary (Fresnel) rim reflection — a faint bounce of light
    // along the shadow-side rim. On a real cabochon this is light
    // grazing around the dome's shoulder.
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = "rgba(255, 195, 165, 0.30)";
    ctx.lineWidth = Math.max(0.4, s * 0.05);
    ctx.beginPath();
    ctx.arc(x, y, s * 0.88, Math.PI * 0.15, Math.PI * 0.72);
    ctx.stroke();
    ctx.restore();

    // 4. Arbor hole (the pivot rides here).
    const holeR = s * 0.12;
    ctx.fillStyle = "rgba(42, 24, 12, 0.82)";
    ctx.beginPath(); ctx.arc(x, y, holeR, 0, Math.PI * 2); ctx.fill();

    // 5. Chaton screws — balance + pallet only.
    if (j.kind === "balance" || j.kind === "pallet") {
      const screwR = s * 0.18;
      const screwDist = (chatonOuter + wellR) * 0.5;
      const angles =
        j.kind === "balance"
          ? [-Math.PI / 2, Math.PI / 2]
          : [Math.PI * 0.25, Math.PI * 1.25];
      for (const a of angles) {
        const sx = x + Math.cos(a) * screwDist;
        const sy = y + Math.sin(a) * screwDist;
        drawBluedScrew(sx, sy, screwR, a + 0.6);
      }
    }
  }

  function drawJewelsAndScrews(t, yaw, zoomFactor = 1) {
    jewels.forEach((j) => {
      const [x, y] = U(j.px, j.py, yaw);
      drawJewel(j, x, y);
    });
  }

  /* Screw — warm polished ink with cream sheen (not heat-blued steel,
     which would read cool against the cream parchment). The multiply
     blend onto cream gives these naturally-warm "iron in paper" tones. */
  function drawBluedScrew(x, y, r, slotAngle) {
    // Cast shadow — bumped alpha so the head actually lifts off the
    // substrate at close zoom.
    const castShadow = ctx.createRadialGradient(x, y + r * 0.25, r * 0.75, x, y + r * 0.25, r * 1.45);
    castShadow.addColorStop(0,    "rgba(0, 0, 0, 0)");
    castShadow.addColorStop(0.60, "rgba(16, 12, 8, 0)");
    castShadow.addColorStop(1,    "rgba(16, 12, 8, 0.38)");
    ctx.fillStyle = castShadow;
    ctx.beginPath(); ctx.arc(x, y + r * 0.25, r * 1.45, 0, Math.PI * 2); ctx.fill();

    // Body — warm brass-taupe gradient with stronger rim falloff so
    // the dome-shaped head shows curvature instead of reading flat.
    const body = ctx.createRadialGradient(
      x - r * 0.28, y - r * 0.32, 0,
      x + r * 0.08, y + r * 0.10, r * 1.08,
    );
    body.addColorStop(0.00, "rgba(195, 165, 130, 0.96)");
    body.addColorStop(0.25, "rgba(145, 118, 88, 0.96)");
    body.addColorStop(0.65, "rgba(82, 62, 42, 0.97)");
    body.addColorStop(1.00, "rgba(36, 24, 14, 0.97)");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // Edge.
    ctx.strokeStyle = "rgba(42, 28, 16, 0.70)";
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(x, y, r - 0.3, 0, Math.PI * 2); ctx.stroke();

    // Slot — calmed lip alpha so it no longer glows at close zoom.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(slotAngle);
    const slotW = Math.max(0.9, r * 0.16);
    const slotL = r * 0.80;
    const slotGrad = ctx.createLinearGradient(0, -slotW / 2, 0, slotW / 2);
    slotGrad.addColorStop(0.00, "rgba(12, 6, 2, 0.96)");
    slotGrad.addColorStop(0.45, "rgba(34, 22, 12, 0.92)");
    slotGrad.addColorStop(1.00, "rgba(60, 42, 26, 0.85)");
    ctx.fillStyle = slotGrad;
    ctx.beginPath();
    ctx.rect(-slotL, -slotW / 2, slotL * 2, slotW);
    ctx.fill();
    // Upper lip — softer highlight (0.40 → 0.22).
    ctx.strokeStyle = "rgba(245, 225, 195, 0.22)";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(-slotL, -slotW / 2);
    ctx.lineTo( slotL, -slotW / 2);
    ctx.stroke();
    // Lower lip.
    ctx.strokeStyle = "rgba(8, 4, 2, 0.40)";
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(-slotL, slotW / 2);
    ctx.lineTo( slotL, slotW / 2);
    ctx.stroke();
    ctx.restore();

    // Satin sheen.
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r * 0.96, 0, Math.PI * 2); ctx.clip();
    const sheenGrad = ctx.createLinearGradient(x, y - r, x, y);
    sheenGrad.addColorStop(0,   "rgba(235, 215, 185, 0.40)");
    sheenGrad.addColorStop(0.5, "rgba(210, 185, 155, 0.14)");
    sheenGrad.addColorStop(1,   "rgba(0, 0, 0, 0)");
    ctx.fillStyle = sheenGrad;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.96, -Math.PI * 0.95, -Math.PI * 0.05);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* Date wheel — large thin ring sitting just inside the plate's outer
     engraving dots. On a real movement it has the date numerals printed
     on its top face (dial side) and 31 shallow teeth on its outer edge
     where it meshes with the date driving wheel. From the caseback we
     see only the ring and teeth, not the numerals — we approximate the
     numerals with regularly-spaced tick dots. Rotates once per 31 days
     (essentially still for our purposes). */
  function drawDateWheel(t, yaw) {
    const [ox, oy] = U(0, 0, yaw);
    const innerR = 0.860 * R;
    const outerR = 0.900 * R;
    const tipR   = 0.918 * R;
    const teeth  = 31;
    const pitch  = (Math.PI * 2) / teeth;
    // Deeper teeth for better silhouette at close zoom.
    const tipR2  = 0.926 * R;

    // Aperture window — positioned at the "3 o'clock" axis in plate
    // space (u = +1), which is where ETA 2824-2 displays the date.
    // After the yaw rotation, this lands on the right side of the
    // frame. Today's numeral is what sits under this window.
    const APERTURE_U = 1.0, APERTURE_V = 0.0;
    const apertureAng = Math.atan2(APERTURE_V, APERTURE_U); // plate-frame angle = 0

    // Real calendar day (1..31). Sub-day fraction so the wheel glides
    // between days rather than snapping (on a real watch the date jumps
    // at midnight, but a gliding ring reads as "alive" on a backdrop).
    const d = new Date(t);
    const dayOfMonth = d.getDate(); // 1..31
    const msIntoDay =
      d.getHours() * 3600000 +
      d.getMinutes() * 60000 +
      d.getSeconds() * 1000 +
      d.getMilliseconds();
    const dayFrac = msIntoDay / 86400000; // 0..1 within today
    const dayIndex = (dayOfMonth - 1) + dayFrac; // 0-based continuous

    // Rotate the ring so that today's tooth sits at the aperture angle.
    // Numerals are laid out at angles `yaw + i*pitch + intrinsicOffset`,
    // we choose intrinsicOffset such that i=dayOfMonth-1 lands at
    // `yaw + apertureAng`.
    const intrinsicOffset = apertureAng - dayIndex * pitch;
    const dateAng = yaw + intrinsicOffset;

    // Ring body — annulus with a soft radial gradient so it reads as
    // a stamped metal ring, not a flat band.
    const ringGrad = ctx.createRadialGradient(ox, oy, innerR, ox, oy, outerR);
    ringGrad.addColorStop(0.0, col(C.plateHi,   0.18));
    ringGrad.addColorStop(0.5, col(C.plateMid,  0.22));
    ringGrad.addColorStop(1.0, col(C.plateDark, 0.26));
    ctx.fillStyle = ringGrad;
    ctx.beginPath();
    ctx.arc(ox, oy, outerR, 0, Math.PI * 2);
    ctx.arc(ox, oy, innerR, 0, Math.PI * 2, true);
    ctx.fill("evenodd");

    // Concentric machining grooves (turned/lathed finish) inside the
    // ring annulus — fine concentric rings with alternating tone.
    ctx.save();
    ctx.beginPath();
    ctx.arc(ox, oy, outerR, 0, Math.PI * 2);
    ctx.arc(ox, oy, innerR, 0, Math.PI * 2, true);
    ctx.clip("evenodd");
    // Denser, evenly-spaced grooves so the machined-lathe finish reads
    // at close zoom; spacing locked to a pixel pitch rather than a
    // count so it stays consistent across display densities.
    const groovePitch = Math.max(1.6, R * 0.0026);
    const grooveCount = Math.floor((outerR - innerR) / groovePitch);
    for (let i = 1; i < grooveCount; i++) {
      const rr = innerR + i * groovePitch;
      ctx.strokeStyle = col(C.plateDark, 0.08);
      ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.arc(ox, oy, rr,        0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col(C.plateHi, 0.12);
      ctx.lineWidth = 0.35;
      ctx.beginPath(); ctx.arc(ox, oy, rr + 0.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // Inner and outer rim accents.
    ctx.strokeStyle = col(C.plateHi, 0.26);
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(ox, oy, innerR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col(C.plateDark, 0.32);
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(ox, oy, outerR, 0, Math.PI * 2); ctx.stroke();

    // Outer teeth with anglage — shadow flank + highlight flank.
    ctx.strokeStyle = col(C.shadow, 0.42);
    ctx.lineWidth = 0.5;
    ctx.fillStyle = col(C.plateMid, 0.24);
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a = dateAng + i * pitch;
      const aB0 = a - pitch * 0.42;
      const aB1 = a + pitch * 0.42;
      const aT0 = a - pitch * 0.14;
      const aT1 = a + pitch * 0.14;
      if (i === 0) ctx.moveTo(ox + Math.cos(aB0) * outerR, oy + Math.sin(aB0) * outerR);
      else         ctx.lineTo(ox + Math.cos(aB0) * outerR, oy + Math.sin(aB0) * outerR);
      ctx.lineTo(ox + Math.cos(aT0) * tipR2, oy + Math.sin(aT0) * tipR2);
      ctx.lineTo(ox + Math.cos(aT1) * tipR2, oy + Math.sin(aT1) * tipR2);
      ctx.lineTo(ox + Math.cos(aB1) * outerR, oy + Math.sin(aB1) * outerR);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Anglage highlight along the leading flank of each tooth.
    ctx.strokeStyle = col(C.plateHi, 0.30);
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a = dateAng + i * pitch;
      const aB0 = a - pitch * 0.42;
      const aT0 = a - pitch * 0.14;
      ctx.moveTo(ox + Math.cos(aB0) * outerR, oy + Math.sin(aB0) * outerR);
      ctx.lineTo(ox + Math.cos(aT0) * tipR2,  oy + Math.sin(aT0) * tipR2);
    }
    ctx.stroke();

    // Printed numerals 1..31 — real date numbers, each rotated so the
    // top of the character faces outward (toward the plate edge), which
    // is how they appear on an actual date ring.
    const numR = (innerR + outerR) / 2;
    const fontPx = Math.max(7, (outerR - innerR) * 0.56);
    ctx.save();
    // 500-weight + slightly larger font reads as printed on the dial
    // rather than stamped. Serif fallback preferred on printed calendars.
    ctx.font = `500 ${fontPx * 1.08}px "Times New Roman", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < teeth; i++) {
      const a = dateAng + i * pitch;
      const numeral = String(i + 1);
      const x = ox + Math.cos(a) * numR;
      const y = oy + Math.sin(a) * numR;
      const major = (i + 1) % 5 === 0 || (i + 1) === 1;
      ctx.fillStyle = col(C.plateDark, major ? 0.72 : 0.56);
      ctx.save();
      ctx.translate(x, y);
      // Characters face outward — top of glyph points away from center.
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(numeral, 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // Date aperture — small cutout window on the plate at 3 o'clock,
    // showing today's numeral more prominently. Drawn as a gold bezel
    // with a slightly larger repeat of today's glyph inside, so it
    // reads as a dial window over the ring.
    const apx = ox + Math.cos(yaw + apertureAng) * numR;
    const apy = oy + Math.sin(yaw + apertureAng) * numR;
    const apW = (outerR - innerR) * 1.20;
    const apH = (outerR - innerR) * 0.90;
    ctx.save();
    ctx.translate(apx, apy);
    ctx.rotate(yaw + apertureAng + Math.PI / 2);
    // Bezel frame (gold ring around the window).
    const bezelGrad = ctx.createLinearGradient(0, -apH / 2, 0, apH / 2);
    bezelGrad.addColorStop(0.0, col(C.gold,      0.85));
    bezelGrad.addColorStop(0.5, col(C.plateDark, 0.55));
    bezelGrad.addColorStop(1.0, col(C.gold,      0.85));
    ctx.fillStyle = bezelGrad;
    // Thicker bezel so the window reads as a recessed port rather than
    // a drawn rectangle; shadow cast inside sells the depth.
    const bezPad = Math.max(2.2, R * 0.008);
    ctx.beginPath();
    ctx.rect(-apW / 2 - bezPad, -apH / 2 - bezPad,
              apW + bezPad * 2,  apH + bezPad * 2);
    ctx.fill();
    // Outer bezel shadow (dropped below).
    ctx.strokeStyle = col(C.shadow, 0.55);
    ctx.lineWidth = Math.max(0.7, R * 0.0012);
    ctx.strokeRect(-apW / 2 - bezPad, -apH / 2 - bezPad,
                    apW + bezPad * 2,  apH + bezPad * 2);
    // Window well — slightly recessed cream background so the numeral
    // sits on dial-white, not on the ring metal.
    const wellGrad = ctx.createLinearGradient(0, -apH / 2, 0, apH / 2);
    wellGrad.addColorStop(0.0, col(C.plateHi, 0.55));
    wellGrad.addColorStop(1.0, col(C.plateHi, 0.38));
    ctx.fillStyle = wellGrad;
    ctx.fillRect(-apW / 2, -apH / 2, apW, apH);
    // Inner shadow along the upper lip (sells the recess).
    ctx.strokeStyle = col(C.shadow, 0.45);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-apW / 2, -apH / 2);
    ctx.lineTo( apW / 2, -apH / 2);
    ctx.stroke();
    // Today's numeral — serif at the aperture matches the ring so both
    // feel printed. Slightly calmer weight than before (700 → 600).
    const apFont = Math.max(10, apH * 0.80);
    ctx.font = `600 ${apFont}px "Times New Roman", Georgia, serif`;
    ctx.fillStyle = col(C.shadow, 0.88);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(dayOfMonth), 0, 0);
    ctx.restore();
  }

  /* Keyless works — the hand-winding/time-setting mechanism that enters
     the movement at 3 o'clock via the crown stem. We don't draw the
     full linkage (sliding pinion, setting lever, setting lever spring,
     minute wheel, intermediate wheel) — just the recognizable core:
     the winding stem as a straight steel rod, a winding pinion on it,
     and the yoke spring that biases the pinion into winding position.
     Placed inside the visible plate area (not at the true plate edge,
     which sits off-screen at this zoom) so it actually shows up. */
  function drawKeylessWorks(yaw) {
    // Stem runs along v ≈ 0.12 in unit space (horizontal in plate frame).
    // Stem runs along the u=v diagonal so it stays inside the portrait
    // corridor. Outer terminus bleeds slightly off the bottom-right
    // corner, selling "the crown is outside the case".
    const stemU0 = 0.50;  // outer — "toward the crown"
    const stemU1 = 0.38;  // inner — where the pinion sits
    const stemV  = 0.32;
    const pinionU = 0.40;
    const pinionV = 0.30;

    const [s0x, s0y] = U(stemU0, stemV, yaw);
    const [s1x, s1y] = U(stemU1, stemV, yaw);
    const [pcx, pcy] = U(pinionU, pinionV, yaw);

    // Stem shaft — thick steel rod.
    ctx.strokeStyle = col(C.steelBlue, 0.60);
    ctx.lineWidth = Math.max(2.0, R * 0.012);
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(s0x, s0y); ctx.lineTo(s1x, s1y);
    ctx.stroke();

    // Stem highlight.
    ctx.strokeStyle = col(C.plateHi, 0.32);
    ctx.lineWidth = Math.max(0.5, R * 0.0032);
    ctx.stroke();

    ctx.strokeStyle = col(C.shadow, 0.45);
    ctx.lineWidth = Math.max(0.8, R * 0.005);
    ctx.beginPath();
    ctx.moveTo(s0x, s0y); ctx.lineTo(s1x, s1y);
    ctx.stroke();

    // Outer terminus — square cross-section shoulder where the crown
    // threads onto the stem. Real winding stems are square at the
    // crown end (keeps the crown from spinning independently of the
    // stem), round where they ride through case bushings and the
    // keyless wheels. Drawn as a square section followed by a small
    // round collar transitioning back to the round shaft.
    const stemAngScreen = Math.atan2(s1y - s0y, s1x - s0x);
    const stemW = Math.max(2.0, R * 0.012);
    const sqLen = Math.max(6.0, R * 0.028);
    const collarR = Math.max(3.0, R * 0.012);
    ctx.save();
    ctx.translate(s0x, s0y);
    ctx.rotate(stemAngScreen);
    // Square shoulder — body, then highlight top edge + shadow bottom.
    const sqGrad = ctx.createLinearGradient(0, -stemW * 0.7, 0, stemW * 0.7);
    sqGrad.addColorStop(0.0, col(C.plateHi,   0.40));
    sqGrad.addColorStop(0.5, col(C.steel,     0.70));
    sqGrad.addColorStop(1.0, col(C.shadow,    0.60));
    ctx.fillStyle = sqGrad;
    ctx.fillRect(-sqLen, -stemW * 0.7, sqLen, stemW * 1.4);
    ctx.strokeStyle = col(C.shadow, 0.62);
    ctx.lineWidth = 0.5;
    ctx.strokeRect(-sqLen, -stemW * 0.7, sqLen, stemW * 1.4);
    // Polished top lip of the square section.
    ctx.strokeStyle = col(C.plateHi, 0.45);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-sqLen + 0.5, -stemW * 0.68);
    ctx.lineTo(-0.5,          -stemW * 0.68);
    ctx.stroke();
    // Round collar at the transition between square and round sections.
    const cGrad = ctx.createRadialGradient(
      -collarR * 0.3, -collarR * 0.3, 0, 0, 0, collarR,
    );
    cGrad.addColorStop(0, col(C.plateHi, 0.45));
    cGrad.addColorStop(1, col(C.shadow,  0.60));
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.arc(0, 0, collarR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col(C.shadow, 0.60);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();

    // Winding pinion — small toothed wheel on the stem.
    const pinR = R * 0.024;
    const pinTeeth = 10;
    const pinTpitch = (Math.PI * 2) / pinTeeth;
    // Pinion rotation is unrelated to any gear we drive; show it static
    // (the keyless works only moves when the user winds).
    const pinAng = stemAngScreen;

    const pinBody = ctx.createRadialGradient(
      pcx - pinR * 0.3, pcy - pinR * 0.3, 0, pcx, pcy, pinR,
    );
    pinBody.addColorStop(0, col(C.steel, 0.55));
    pinBody.addColorStop(1, col(C.shadow, 0.62));
    ctx.fillStyle = pinBody;
    ctx.beginPath(); ctx.arc(pcx, pcy, pinR, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = col(C.shadow, 0.62);
    ctx.lineWidth = 0.5;
    const pinBase = pinR * 0.80;
    const pinTip  = pinR * 1.10;
    ctx.beginPath();
    for (let i = 0; i < pinTeeth; i++) {
      const a = pinAng + i * pinTpitch;
      const a0 = a - pinTpitch * 0.30;
      const a1 = a + pinTpitch * 0.30;
      const t0 = a - pinTpitch * 0.12;
      const t1 = a + pinTpitch * 0.12;
      if (i === 0) ctx.moveTo(pcx + Math.cos(a0) * pinBase, pcy + Math.sin(a0) * pinBase);
      else         ctx.lineTo(pcx + Math.cos(a0) * pinBase, pcy + Math.sin(a0) * pinBase);
      ctx.lineTo(pcx + Math.cos(t0) * pinTip,  pcy + Math.sin(t0) * pinTip);
      ctx.lineTo(pcx + Math.cos(t1) * pinTip,  pcy + Math.sin(t1) * pinTip);
      ctx.lineTo(pcx + Math.cos(a1) * pinBase, pcy + Math.sin(a1) * pinBase);
    }
    ctx.closePath();
    ctx.stroke();

    // Pinion bore where the stem passes through it.
    ctx.fillStyle = col(C.shadow, 0.72);
    ctx.beginPath();
    ctx.arc(pcx, pcy, pinR * 0.30, 0, Math.PI * 2);
    ctx.fill();

    // Yoke — spring-loaded arm that presses the pinion into winding
    // position. Anchored to a post and sweeping around to contact the
    // pinion from below.
    const yokeAnchorU = 0.48;
    const yokeAnchorV = 0.40;
    const yokeBendU   = 0.43;
    const yokeBendV   = 0.34;
    const yokeTipU    = pinionU + 0.015;
    const yokeTipV    = pinionV + 0.018;
    const [yax, yay] = U(yokeAnchorU, yokeAnchorV, yaw);
    const [ybx, yby] = U(yokeBendU, yokeBendV, yaw);
    const [ytx, yty] = U(yokeTipU, yokeTipV, yaw);

    ctx.strokeStyle = col(C.steel, 0.55);
    ctx.lineWidth = Math.max(1.2, R * 0.007);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(yax, yay);
    ctx.quadraticCurveTo(ybx, yby, ytx, yty);
    ctx.stroke();

    ctx.strokeStyle = col(C.plateHi, 0.25);
    ctx.lineWidth = Math.max(0.4, R * 0.0022);
    ctx.stroke();

    // Yoke anchor post with screw slot.
    ctx.fillStyle = col(C.steel, 0.68);
    ctx.beginPath();
    ctx.arc(yax, yay, Math.max(1.8, R * 0.009), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col(C.shadow, 0.55);
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.strokeStyle = col(C.shadow, 0.70);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(yax - Math.max(1.2, R * 0.006), yay);
    ctx.lineTo(yax + Math.max(1.2, R * 0.006), yay);
    ctx.stroke();
  }

  /* Click and ratchet — sits on top of the barrel arbor. The ratchet
     wheel is concentric with the barrel and rotates with it; the click
     is a spring-loaded pawl with a hooked tooth that rides the ratchet
     and prevents it from turning backward (mainspring can't unwind
     through the barrel, so it has to unwind through the train — which
     is how the watch runs). Saw-tooth profile is asymmetric: steep
     face catches the click, sloped face lets it slip when winding. */
  function drawClickAndRatchet(t, yaw) {
    const bg = gears[0];
    const [bcx, bcy] = U(bg.x, bg.y, yaw);

    // Ratchet rotates with the barrel (stage 0, dir=+1).
    const barrelAng = yaw + bg.speed * t + bg.phaseBias;
    const ratchetR = 0.088 * R;
    const teeth = 48;
    const toothPitch = (Math.PI * 2) / teeth;
    const rBase = ratchetR * 0.93;
    const rTip  = ratchetR;

    // Disc body.
    const body = ctx.createRadialGradient(
      bcx - ratchetR * 0.3, bcy - ratchetR * 0.3, 0, bcx, bcy, ratchetR,
    );
    body.addColorStop(0, col(C.plateHi, 0.32));
    body.addColorStop(1, col(C.steelBlue, 0.58));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(bcx, bcy, ratchetR, 0, Math.PI * 2); ctx.fill();

    // Asymmetric saw teeth.
    ctx.strokeStyle = col(C.shadow, 0.60);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = barrelAng + i * toothPitch;
      const a1 = a0 + toothPitch;
      const aHook = a0 + toothPitch * 0.02;  // near-vertical hook face
      const aSlope = a0 + toothPitch * 0.85; // long sloped face
      if (i === 0) ctx.moveTo(bcx + Math.cos(a0) * rBase, bcy + Math.sin(a0) * rBase);
      else         ctx.lineTo(bcx + Math.cos(a0) * rBase, bcy + Math.sin(a0) * rBase);
      ctx.lineTo(bcx + Math.cos(aHook) * rTip,  bcy + Math.sin(aHook) * rTip);
      ctx.lineTo(bcx + Math.cos(aSlope) * rTip, bcy + Math.sin(aSlope) * rTip);
      ctx.lineTo(bcx + Math.cos(a1) * rBase,    bcy + Math.sin(a1) * rBase);
    }
    ctx.closePath();
    ctx.stroke();

    // Central arbor screw with slot.
    ctx.fillStyle = col(C.shadow, 0.68);
    ctx.beginPath();
    ctx.arc(bcx, bcy, ratchetR * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col(C.plateHi, 0.40);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    const slotAng = barrelAng;
    ctx.moveTo(
      bcx + Math.cos(slotAng) * ratchetR * 0.15,
      bcy + Math.sin(slotAng) * ratchetR * 0.15,
    );
    ctx.lineTo(
      bcx - Math.cos(slotAng) * ratchetR * 0.15,
      bcy - Math.sin(slotAng) * ratchetR * 0.15,
    );
    ctx.stroke();

    // Click lever — pivots at a post offset from the ratchet, with its
    // tooth tip resting on a ratchet tooth. Static (doesn't animate;
    // the ratchet just turns underneath it).
    // Click offsets rotated to follow the new cascade direction
    // (dir1 ≈ 1.05 rad); keeps the click between the barrel and center
    // wheel instead of orbiting around to the off-screen side.
    const pivotU = bg.x + 0.091;
    const pivotV = bg.y + 0.148;
    const elbowU = bg.x + 0.032;
    const elbowV = bg.y + 0.106;
    const tipU   = bg.x + 0.008;
    const tipV   = bg.y + 0.070;
    const [pvx, pvy] = U(pivotU, pivotV, yaw);
    const [ebx, eby] = U(elbowU, elbowV, yaw);
    const [tpx, tpy] = U(tipU, tipV, yaw);

    ctx.strokeStyle = col(C.steel, 0.62);
    ctx.lineWidth = Math.max(1.4, R * 0.009);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pvx, pvy);
    ctx.lineTo(ebx, eby);
    ctx.lineTo(tpx, tpy);
    ctx.stroke();

    ctx.strokeStyle = col(C.plateHi, 0.28);
    ctx.lineWidth = Math.max(0.4, R * 0.0025);
    ctx.stroke();

    // Pivot post with screw slot.
    ctx.fillStyle = col(C.steel, 0.68);
    ctx.beginPath();
    ctx.arc(pvx, pvy, Math.max(2.0, R * 0.010), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col(C.shadow, 0.55);
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.strokeStyle = col(C.shadow, 0.70);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(pvx - Math.max(1.4, R * 0.007), pvy);
    ctx.lineTo(pvx + Math.max(1.4, R * 0.007), pvy);
    ctx.stroke();

    // Click spring — a formed flat steel spring that arcs from its
    // anchor post, bends in a reverse curve along its length (so it
    // can flex without fatiguing), and terminates in a hooked tip
    // resting against the click lever. Drawn with a body stroke, a
    // blued centerline highlight, a shadow edge, and an explicit hook
    // cap at the working end so it reads as a formed part, not a wire.
    const spAnchorU = bg.x + 0.045;
    const spAnchorV = bg.y + 0.186;
    const [sax, say] = U(spAnchorU, spAnchorV, yaw);

    // Reverse-curve control points. First curves up & away from the
    // ratchet, then tucks back down to meet the click elbow from above.
    const midU = bg.x + 0.095, midV = bg.y + 0.163;
    const bendU = bg.x + 0.076, bendV = bg.y + 0.127;
    const [mx, my] = U(midU, midV, yaw);
    const [bx, by] = U(bendU, bendV, yaw);

    const springPath = () => {
      ctx.beginPath();
      ctx.moveTo(sax, say);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.quadraticCurveTo(
        (bx + ebx) / 2 - (eby - by) * 0.12,
        (by + eby) / 2 - (ebx - bx) * 0.12,
        ebx, eby,
      );
    };
    // Body (blued steel).
    springPath();
    ctx.strokeStyle = col(C.steelBlue, 0.62);
    ctx.lineWidth = Math.max(1.1, R * 0.0050);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    // Shadow edge.
    springPath();
    ctx.strokeStyle = col(C.shadow, 0.45);
    ctx.lineWidth = Math.max(0.5, R * 0.0020);
    ctx.stroke();
    // Polished centerline highlight.
    springPath();
    ctx.strokeStyle = col(C.plateHi, 0.28);
    ctx.lineWidth = Math.max(0.4, R * 0.0015);
    ctx.stroke();

    // Hook cap at the working tip — a small curled loop of the spring
    // that grips the click lever's elbow. Drawn as a short arc segment
    // centered on the elbow point.
    const hookR = Math.max(1.6, R * 0.009);
    ctx.strokeStyle = col(C.steelBlue, 0.72);
    ctx.lineWidth = Math.max(0.9, R * 0.0040);
    ctx.beginPath();
    const hookAng = Math.atan2(eby - by, ebx - bx);
    ctx.arc(ebx, eby, hookR, hookAng - Math.PI * 0.9, hookAng + Math.PI * 0.3);
    ctx.stroke();

    // Spring anchor post — countersunk dot with a tiny slot so it
    // reads as screwed down, not floating.
    ctx.fillStyle = col(C.steel, 0.72);
    ctx.beginPath();
    ctx.arc(sax, say, Math.max(1.6, R * 0.0060), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col(C.shadow, 0.62);
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.strokeStyle = col(C.shadow, 0.75);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(sax - Math.max(1.0, R * 0.0040), say);
    ctx.lineTo(sax + Math.max(1.0, R * 0.0040), say);
    ctx.stroke();
  }

  /* Regulator index — the fine-timing lever that sits on the balance
     cock. Arm pivots near the balance staff jewel and extends out to
     a short curved scale (+ / − ends). Two tiny curb pins at the tip
     grip the hairspring between them; sliding the lever changes the
     spring's effective length and hence the rate. Purely decorative
     here (static position) — real regulators don't move unless the
     watch is being adjusted. */
  function drawRegulator(yaw) {
    // Scale arc — short curve around the balance staff, above the wheel.
    const scaleR = balance.r * 1.25;
    const scaleCenterAng = -Math.PI / 2 - 0.25; // above-and-slightly-left
    const scaleSpan = 0.55;
    const scaleStart = scaleCenterAng - scaleSpan / 2;
    const scaleEnd   = scaleCenterAng + scaleSpan / 2;

    ctx.strokeStyle = col(C.plateDark, 0.50);
    ctx.lineWidth = Math.max(0.5, R * 0.0025);
    ctx.beginPath();
    const arcSamples = 18;
    for (let i = 0; i <= arcSamples; i++) {
      const a = scaleStart + (scaleEnd - scaleStart) * (i / arcSamples);
      const [x, y] = U(
        balance.x + Math.cos(a) * scaleR,
        balance.y + Math.sin(a) * scaleR,
        yaw,
      );
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Tick marks — longer at ends (for + / −), shorter between.
    const ticks = 7;
    for (let i = 0; i <= ticks; i++) {
      const a = scaleStart + (scaleEnd - scaleStart) * (i / ticks);
      const end = i === 0 || i === ticks;
      const t0 = scaleR - (end ? 0.020 : 0.010);
      const t1 = scaleR + (end ? 0.014 : 0.006);
      const [x0, y0] = U(balance.x + Math.cos(a) * t0, balance.y + Math.sin(a) * t0, yaw);
      const [x1, y1] = U(balance.x + Math.cos(a) * t1, balance.y + Math.sin(a) * t1, yaw);
      ctx.strokeStyle = col(C.plateDark, end ? 0.65 : 0.45);
      ctx.lineWidth = end ? Math.max(0.9, R * 0.0035) : Math.max(0.5, R * 0.002);
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Lever arm — pivots near balance staff jewel, extends to scale midpoint.
    // Pivot sits at a tiny offset from balance center (the regulator is
    // concentric with the balance staff but pivots around it on a friction fit).
    const pivotR = balance.r * 0.18;
    const leverAng = scaleCenterAng + 0.08; // slightly biased to the "+"
    const pivotX = balance.x + Math.cos(leverAng) * pivotR;
    const pivotY = balance.y + Math.sin(leverAng) * pivotR;
    const tipX   = balance.x + Math.cos(leverAng) * (scaleR + 0.005);
    const tipY   = balance.y + Math.sin(leverAng) * (scaleR + 0.005);

    const [px, py] = U(pivotX, pivotY, yaw);
    const [tx, ty] = U(tipX, tipY, yaw);

    // Arm body — thin steel lever.
    ctx.strokeStyle = col(C.steel, 0.58);
    ctx.lineWidth = Math.max(1.2, R * 0.007);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px, py); ctx.lineTo(tx, ty);
    ctx.stroke();

    // Highlight streak down the arm.
    ctx.strokeStyle = col(C.plateHi, 0.30);
    ctx.lineWidth = Math.max(0.4, R * 0.0022);
    ctx.stroke();

    // Pivot boss at base of arm.
    ctx.fillStyle = col(C.steel, 0.70);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1.4, R * 0.007), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col(C.shadow, 0.55);
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Curb pins at tip — two tiny parallel pins straddling the hairspring.
    const pinGap = Math.max(1.6, R * 0.006);
    const tipPerpAng = leverAng + Math.PI / 2;
    const [pinAx, pinAy] = [
      tx + Math.cos(tipPerpAng) * pinGap,
      ty + Math.sin(tipPerpAng) * pinGap,
    ];
    const [pinBx, pinBy] = [
      tx - Math.cos(tipPerpAng) * pinGap,
      ty - Math.sin(tipPerpAng) * pinGap,
    ];
    ctx.fillStyle = col(C.shadow, 0.75);
    ctx.beginPath(); ctx.arc(pinAx, pinAy, Math.max(0.9, R * 0.003), 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(pinBx, pinBy, Math.max(0.9, R * 0.003), 0, Math.PI * 2); ctx.fill();
  }

  /* Shimmers — light glinting off polished anglage (the beveled bridge
     edge). Not traveling particles; each shimmer is an elongated
     specular streak aligned with the bridge tangent, tapering at both
     ends. This is how gold/steel catches light when a camera pans
     across a fine movement. */
  function drawShimmers(yaw) {
    // Sample the bridge polyline at t, returning the screen-space
    // position plus the local tangent + normal vectors. Shimmers ride
    // the bevel edge (offset along the normal), not the centerline.
    const sample = (pts, t) => {
      const totalIdx = pts.length - 1;
      const idx = Math.max(0, Math.min(totalIdx - 0.0001, t * totalIdx));
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, totalIdx);
      const f  = idx - i0;
      const u  = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * f;
      const v  = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * f;
      const [x, y]   = U(u, v, yaw);
      const [x2, y2] = U(pts[i1][0], pts[i1][1], yaw);
      const [x0, y0] = U(pts[i0][0], pts[i0][1], yaw);
      const tx = x2 - x0, ty = y2 - y0;
      const tl = Math.hypot(tx, ty) || 1;
      return { x, y, tx: tx / tl, ty: ty / tl, nx: -ty / tl, ny: tx / tl };
    };

    for (const sh of shimmers) {
      const br = bridges[sh.bridgeIdx];
      const pts = br.points;
      const headT = sh.t;
      const streakLen = 0.10;
      const width = Math.max(1.0, br.width * R * 0.20);
      // Offset from centerline to the highlight bevel edge.
      const bevelOff = br.width * R * 0.38;

      const samples = 16;
      for (let i = 0; i < samples; i++) {
        const tt = (i + 0.5) / samples;
        const pathT = headT - streakLen + tt * streakLen;
        if (pathT < 0 || pathT > 1) continue;

        const s = sample(pts, pathT);
        const px = s.x + s.nx * bevelOff;
        const py = s.y + s.ny * bevelOff;

        const envelope = Math.pow(tt, 1.8) * Math.pow(1 - (1 - tt) * 0.05, 6);
        // Elongated along the tangent — elliptical, not round.
        const lenR = width * (0.6 + envelope * 1.2);
        const wideR = width * (0.20 + envelope * 0.28);
        const ang = Math.atan2(s.ty, s.tx);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, lenR);
        if (sh.hue === "gold") {
          coreGrad.addColorStop(0,   `rgba(255, 240, 210, ${0.90 * envelope})`);
          coreGrad.addColorStop(0.45, col(C.gold, 0.55 * envelope));
          coreGrad.addColorStop(1,   col(C.gold, 0));
        } else {
          coreGrad.addColorStop(0,   `rgba(255, 220, 225, ${0.85 * envelope})`);
          coreGrad.addColorStop(0.45, col(C.rubyHalo, 0.55 * envelope));
          coreGrad.addColorStop(1,   col(C.rubyHalo, 0));
        }
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, lenR, wideR, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Head bright spot — tight specular peak at the leading edge.
      if (headT >= 0 && headT <= 1) {
        const s = sample(pts, headT);
        const hx = s.x + s.nx * bevelOff;
        const hy = s.y + s.ny * bevelOff;
        const headR = width * 0.95;
        const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, headR);
        if (sh.hue === "gold") {
          glow.addColorStop(0,   "rgba(255, 248, 220, 0.98)");
          glow.addColorStop(0.3, col(C.gold, 0.80));
          glow.addColorStop(1,   col(C.gold, 0));
        } else {
          glow.addColorStop(0,   "rgba(255, 230, 230, 0.96)");
          glow.addColorStop(0.3, col(C.rubyHalo, 0.75));
          glow.addColorStop(1,   col(C.rubyHalo, 0));
        }
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(hx, hy, headR, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Static yaw — the composition holds still as a backdrop. Aliveness
  // comes from the gear train and balance, not from the whole frame
  // rotating. 45° tilt — bridges and gear train read on a strong
  // diagonal across the canvas.
  const yaw = Math.PI / 4;
  const YAW_SPEED = 0;

  function frame(now) {
    // Wall-clock time drives the whole mechanism: gear phase, balance
    // oscillation, and the date wheel all evaluate to a deterministic
    // function of Date.now(). This means reloading the launcher does
    // NOT reset the movement — it resumes where the calendar says it
    // should be. Double precision holds sin()/cos() arguments at
    // microsecond fidelity at current wall-clock magnitudes, so the
    // phase error across decades is imperceptible.
    const t = Date.now();

    if (cam.to) {
      const elapsed = now - cam.startTime;
      const raw = Math.min(1, elapsed / cam.duration);
      const e = easeInOutCubicSoft(raw);
      cam.eased = e;
      cx = cam.from.cx + (cam.to.cx - cam.from.cx) * e;
      cy = cam.from.cy + (cam.to.cy - cam.from.cy) * e;
      R  = cam.from.R  + (cam.to.R  - cam.from.R)  * e;
      if (raw >= 1) {
        cx = cam.to.cx; cy = cam.to.cy; R = cam.to.R;
        cam.from = null;
        cam.to = null;
        cam._fromName = null;
        cam.duration = 0;
        cam.eased = 0;
      }
    }

    const renderT = reduced ? 0 : t;

    // zoomFactor drives the close-up detail gates. Normalised against
    // a stable reference — max(W, H) * 1.04 — so ambient ≈ 1.0 and
    // zoomed-in branches start unlocking as R grows. Thresholds like
    // >2.5 / >4 correspond to their original visual scale regardless
    // of how the 'ambient' preset is tuned.
    const zoomFactor = R / (Math.max(W, H) * 1.04);

    ctx.clearRect(0, 0, W, H);
    drawMainplate(yaw);
    drawPerlage(yaw);
    drawCotes(yaw);
    drawEngraving(yaw);
    drawDateWheel(renderT, yaw);
    drawBridges(yaw);
    for (let i = 0; i < gears.length; i++) {
      drawGear(gears[i], i, yaw, renderT, zoomFactor);
    }
    drawClickAndRatchet(renderT, yaw);
    drawKeylessWorks(yaw);
    drawPallet(renderT, yaw);
    drawBalanceWheel(renderT, yaw, zoomFactor);
    drawRegulator(yaw);
    drawJewelsAndScrews(renderT, yaw, zoomFactor);

    if (!reduced) {
      for (const sh of shimmers) {
        sh.t += sh.speed * 16;
        if (sh.t > 1.15) {
          sh.t = -0.12;
          sh.bridgeIdx = Math.floor(Math.random() * bridges.length);
          sh.hue = Math.random() < 0.5 ? "gold" : "ruby";
        }
      }
    }
    drawShimmers(yaw);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ===== Peek easter egg — hit test on the barrel ratchet screw =====
     The slotted screw at the centre of the ratchet (on top of the
     barrel arbor) is the hidden handle. Press-and-hold tweens the
     camera to the 'wide' preset (whole plate framed); release tweens
     back to 'ambient'. Hit radius is generous (~3× the visual) so
     fingers can find it. */
  const hitRatchetScrew = (ex, ey) => {
    const bg = gears[0];
    const [bcx, bcy] = U(bg.x, bg.y, yaw);
    const ratchetR = 0.088 * R;
    const visualR  = ratchetR * 0.18;
    const hitR     = Math.max(22, visualR * 3.0);
    const dx = ex - bcx, dy = ey - bcy;
    return (dx * dx + dy * dy) <= hitR * hitR;
  };

  const peek = { pointerId: null };

  canvas.addEventListener("pointerdown", (ev) => {
    // Don't fire while launched into an app — the case-back flip owns
    // the camera there.
    if (cam.name === "closeup") return;
    const rect = canvas.getBoundingClientRect();
    const ex = ev.clientX - rect.left;
    const ey = ev.clientY - rect.top;
    if (!hitRatchetScrew(ex, ey)) return;
    ev.preventDefault();
    peek.pointerId = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch {}
    setCamera("wide", 520);
  });

  const releaseIfMatching = (ev) => {
    if (peek.pointerId === null || ev.pointerId !== peek.pointerId) return;
    peek.pointerId = null;
    // Only revert if the user is still in the wide preset — if they
    // navigated elsewhere mid-hold, don't stomp on that state.
    if (cam.name === "wide") setCamera("ambient", 520);
  };
  canvas.addEventListener("pointerup",     releaseIfMatching);
  canvas.addEventListener("pointercancel", releaseIfMatching);
  canvas.addEventListener("pointerleave",  releaseIfMatching);

  return { canvas, setCamera };
}
