/* =====================================================================
   Mechanical watch movement — ambient background for the launcher.

   A hand-tuned Canvas2D simulation of a real ETA 2824-2 Swiss lever
   caliber. The tooth counts, mesh geometry, and phasing are pinned to
   real-world ratios: change one and the teeth stop interleaving at the
   mesh. The palette is a warm taupe-and-cream monotone — do not push
   these values darker or cooler; depth comes from opacity, not darkness.

   Exposed API (assigned onto the canvas element):
     canvas._launch(targetName)  — zoom the camera toward a component
     canvas._close()             — pull back to the ambient wide shot
     canvas._getLaunchProgress() — eased 0..1, 0 = ambient, 1 = closeup

   The only registered launch target is 'fourthWheel' (gears[3] — the
   ~60 rpm wheel that drives the seconds hand). All app tiles share
   the same dive for consistency.
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
  let cxA = 0, cyA = 0, RA = 0; // ambient camera
  let isPortrait = true;

  /* Launch state machine.
     mode: 'idle' | 'launching' | 'open' | 'closing'
     Eased 0..1 drives camera lerp between ambient and target. When the
     app is fully open, frozenT latches the animation clock so the gears
     sit perfectly still — the quiet-backdrop feeling behind the open app. */
  const launch = {
    mode: "idle",
    startTime: 0,
    durationIn: 1100,
    durationOut: 800,
    target: null,
    eased: 0,
    frozenT: null,
  };

  // Launch targets in UNIT space; zoom multiplies the ambient R.
  const LAUNCH_TARGETS = {
    fourthWheel: { u: null, v: null, zoom: 4.5 },
  };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width  = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    isPortrait = H >= W;
    if (isPortrait) {
      // Anchor so the gear train (gears 1..4 + balance, which live in
      // unit space around v ≈ 0.12..0.20, u ≈ -0.42..0.20) lands as a
      // horizontal band across the lower spacer between the icon grid
      // and the version footer — out from behind the tappable icons.
      RA  = W * 1.75;
      cxA = W * 1.00;
      cyA = H * 0.70;
    } else {
      const longSide = Math.max(W, H);
      RA  = longSide * 0.95;
      cxA = W * 1.02;
      cyA = H * 0.72;
    }
    if (launch.mode === "idle") { cx = cxA; cy = cyA; R = RA; }
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

  function launchTo(targetName) {
    const target = LAUNCH_TARGETS[targetName];
    if (!target || target.u == null) return;
    const targetR  = RA * target.zoom;
    const targetCx = W / 2 - target.u * targetR;
    const targetCy = H / 2 - target.v * targetR;
    launch.mode = "launching";
    launch.startTime = performance.now();
    launch.target = { cx: targetCx, cy: targetCy, R: targetR };
  }
  function closeTo() {
    if (launch.mode === "idle") return;
    launch.mode = "closing";
    launch.startTime = performance.now();
  }
  canvas._launch = launchTo;
  canvas._close  = closeTo;
  canvas._getLaunchProgress = () => launch.eased;

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
    // Stage 0 — barrel (wheel only, anchored lower-left).
    const g0 = {
      kind: "barrel", x: -0.55, y: 0.25,
      wheelT: 72, pinionT: 10, wheelR: pr(72), pinionR: pr(10),
      speed: S_BARREL, phaseBias: 0,
    };
    gears.push(g0);

    // Stage 1 — center wheel, up-right from barrel.
    const dir1 = { x: Math.cos(-0.55), y: Math.sin(-0.55) };
    const g1 = {
      kind: "wheel", wheelT: 72, pinionT: 10, wheelR: pr(72), pinionR: pr(10),
      speed: S_CENTER, phaseBias: 0,
    };
    const d01 = g0.wheelR + g1.pinionR;
    g1.x = g0.x + dir1.x * d01; g1.y = g0.y + dir1.y * d01;
    gears.push(g1);

    // Stage 2 — third wheel.
    const dir2 = { x: Math.cos(-0.15), y: Math.sin(-0.15) };
    const g2 = {
      kind: "wheel", wheelT: 75, pinionT: 10, wheelR: pr(75), pinionR: pr(10),
      speed: S_THIRD, phaseBias: 0,
    };
    const d12 = g1.wheelR + g2.pinionR;
    g2.x = g1.x + dir2.x * d12; g2.y = g1.y + dir2.y * d12;
    gears.push(g2);

    // Stage 3 — fourth wheel (this is the launch target).
    const dir3 = { x: Math.cos(0.30), y: Math.sin(0.30) };
    const g3 = {
      kind: "wheel", wheelT: 70, pinionT: 10, wheelR: pr(70), pinionR: pr(10),
      speed: S_FOUR, phaseBias: 0,
    };
    const d23 = g2.wheelR + g3.pinionR;
    g3.x = g2.x + dir3.x * d23; g3.y = g2.y + dir3.y * d23;
    gears.push(g3);

    // Stage 4 — escape wheel.
    const dir4 = { x: Math.cos(-0.75), y: Math.sin(-0.75) };
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
  const escG = gears[4];
  const balance = {
    x: escG.x + 0.28, y: escG.y - 0.05,
    r: 0.17, freqHz: 2.0, amp: 0.52 * Math.PI,
  };

  // Register fourth wheel as the shared launch target for all apps.
  // gears[3] rotates at ~60 rpm — visibly alive motion as background.
  LAUNCH_TARGETS.fourthWheel.u = gears[3].x;
  LAUNCH_TARGETS.fourthWheel.v = gears[3].y;

  // Pallet fork — offset from escape toward balance.
  const pallet = {
    x: escG.x + 0.10,
    y: escG.y - 0.12,
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

  const screws = [
    { r: 0.55, a: -0.55, size: 0.030 },
    { r: 0.62, a:  0.55, size: 0.030 },
    { r: 0.60, a:  2.20, size: 0.030 },
    { r: 0.56, a: -2.55, size: 0.030 },
    { r: 0.35, a:  1.10, size: 0.024 },
    { r: 0.40, a: -1.25, size: 0.024 },
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
        [gears[0].x - 0.12, gears[0].y + 0.05],
        [gears[1].x + 0.10, gears[1].y - 0.15],
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
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.15);
    halo.addColorStop(0, col(C.plateHi, 0.10));
    halo.addColorStop(1, col(C.plateDark, 0.00));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2); ctx.fill();

    const disc = ctx.createRadialGradient(
      cx - R * 0.45, cy - R * 0.45, R * 0.05, cx, cy, R * 1.0,
    );
    disc.addColorStop(0.00, col(C.plateHi, 0.22));
    disc.addColorStop(0.55, col(C.plateMid, 0.10));
    disc.addColorStop(1.00, col(C.plateDark, 0.00));
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = col(C.plateHi, 0.42);
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col(C.plateDark, 0.22);
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2); ctx.stroke();
  }

  function drawPerlage(yaw) {
    const rings = 5;
    const perRing = 15;
    for (let ri = 1; ri <= rings; ri++) {
      const rr = (ri / (rings + 0.5)) * 0.88;
      for (let i = 0; i < perRing + ri * 2; i++) {
        const a = (i / (perRing + ri * 2)) * Math.PI * 2 + yaw * 0.3;
        const [x, y] = U(Math.cos(a) * rr, Math.sin(a) * rr, yaw);
        const spot = 0.022 * R;
        const front = 0.5 + 0.5 * Math.cos(a - yaw * 0.3 - 0.9);
        ctx.strokeStyle = col(C.plateMid, 0.06 + front * 0.12);
        ctx.lineWidth = front > 0.5 ? 0.75 : 0.5;
        ctx.fillStyle  = col(C.plateHi, 0.02 + front * 0.05);
        ctx.beginPath(); ctx.arc(x, y, spot, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
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

    const bands = 16;
    const span = R * 1.6;
    for (let i = -bands; i <= bands; i++) {
      const offset = (i / bands) * span;
      const x1 = cx - Math.cos(yaw) * span + Math.sin(yaw) * offset;
      const y1 = cy - Math.sin(yaw) * span - Math.cos(yaw) * offset;
      const x2 = cx + Math.cos(yaw) * span + Math.sin(yaw) * offset;
      const y2 = cy + Math.sin(yaw) * span - Math.cos(yaw) * offset;
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0.0, col(C.plateMid, 0.04));
      grad.addColorStop(0.5, col(C.plateHi, 0.14));
      grad.addColorStop(1.0, col(C.plateDark, 0.04));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEngraving(yaw) {
    ctx.fillStyle = col(C.plateDark, 0.28);
    const n = 72;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + yaw;
      const r = R * 0.955;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      ctx.beginPath(); ctx.arc(x, y, 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawBridges(yaw) {
    for (const br of bridges) {
      ctx.beginPath();
      for (let i = 0; i < br.points.length; i++) {
        const [x, y] = U(br.points[i][0], br.points[i][1], yaw);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = col(C.plateMid, 0.18);
      ctx.lineWidth = br.width * R;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.stroke();

      ctx.strokeStyle = col(C.plateHi, 0.32);
      ctx.lineWidth = Math.max(0.8, br.width * R * 0.18);
      ctx.stroke();

      ctx.strokeStyle = col(C.shadow, 0.18);
      ctx.lineWidth = Math.max(0.5, br.width * R * 0.08);
      ctx.stroke();

      for (const [u, v] of [br.points[0], br.points[br.points.length - 1]]) {
        const [x, y] = U(u, v, yaw);
        ctx.fillStyle = col(C.shadow, 0.35);
        ctx.beginPath(); ctx.arc(x, y, br.width * R * 0.42, 0, Math.PI * 2); ctx.fill();
      }
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
      // Swiss lever "club" tooth — asymmetric. The hook + impulse face
      // is what lets the pallet stone actually catch.
      ctx.fillStyle = col(C.steel, 0.75);
      ctx.strokeStyle = col(C.shadow, 0.75);
      ctx.lineWidth = 0.6;
      const teeth = g.wheelT;
      const toothPitch = (Math.PI * 2) / teeth;
      const rBase = wR * 0.82;
      const rTip  = wR;
      for (let i = 0; i < teeth; i++) {
        const a = angle + i * toothPitch;
        const aRootTrail = a - toothPitch * 0.45;
        const aRootLead  = a + toothPitch * 0.05;
        const aTipLead   = a + toothPitch * 0.25;
        const aTipTrail  = a - toothPitch * 0.08;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(aRootTrail) * rBase, sy + Math.sin(aRootTrail) * rBase);
        ctx.lineTo(sx + Math.cos(aRootLead)  * rBase, sy + Math.sin(aRootLead)  * rBase);
        ctx.lineTo(sx + Math.cos(aTipLead)   * rTip,  sy + Math.sin(aTipLead)   * rTip);
        ctx.lineTo(sx + Math.cos(aTipTrail)  * rTip,  sy + Math.sin(aTipTrail)  * rTip);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = col(C.plateDark, 0.45);
      ctx.lineWidth = 0.85;
      ctx.fillStyle = body;
      const teeth = g.wheelT;
      const toothPitch = (Math.PI * 2) / teeth;
      const toothDepth = 0.085;
      const rRoot = wR * (1 - toothDepth * 0.6);
      const rTip  = wR * (1 + toothDepth);
      ctx.beginPath();
      for (let i = 0; i < teeth; i++) {
        const aC = angle + i * toothPitch;
        const aRoot0 = aC - toothPitch * 0.45;
        const aRoot1 = aC + toothPitch * 0.45;
        const aTip0  = aC - toothPitch * 0.22;
        const aTip1  = aC + toothPitch * 0.22;
        if (i === 0) ctx.moveTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        else         ctx.lineTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        ctx.lineTo(sx + Math.cos(aTip0)  * rTip,  sy + Math.sin(aTip0)  * rTip);
        ctx.lineTo(sx + Math.cos(aTip1)  * rTip,  sy + Math.sin(aTip1)  * rTip);
        ctx.lineTo(sx + Math.cos(aRoot1) * rRoot, sy + Math.sin(aRoot1) * rRoot);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    // Spokes (gear wheels, not escape).
    if (g.kind !== "escape") {
      const spokes = g.kind === "barrel" ? 6 : 4;
      const spokeLW = Math.max(1, wR * 0.05);
      const rInner = Math.max(pR * 1.35, wR * 0.18);
      const rOuter = wR * 0.88;
      const gearClose = zoomFactor > 4;
      const gearVeryClose = zoomFactor > 9;

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
      const gearVeryClose = zoomFactor > 9;
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

      ctx.strokeStyle = col(C.shadow, 0.75);
      ctx.lineWidth = 0.6;
      const tCount = g.pinionT;
      const tPitch = (Math.PI * 2) / tCount;
      const rRoot = pR * 0.82;
      const rTip  = pR * 1.15;
      ctx.beginPath();
      for (let i = 0; i < tCount; i++) {
        const aC = angle + i * tPitch;
        const aRoot0 = aC - tPitch * 0.30;
        const aRoot1 = aC + tPitch * 0.30;
        const aTip0  = aC - tPitch * 0.12;
        const aTip1  = aC + tPitch * 0.12;
        if (i === 0) ctx.moveTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        else         ctx.lineTo(sx + Math.cos(aRoot0) * rRoot, sy + Math.sin(aRoot0) * rRoot);
        ctx.lineTo(sx + Math.cos(aTip0)  * rTip,  sy + Math.sin(aTip0)  * rTip);
        ctx.lineTo(sx + Math.cos(aTip1)  * rTip,  sy + Math.sin(aTip1)  * rTip);
        ctx.lineTo(sx + Math.cos(aRoot1) * rRoot, sy + Math.sin(aRoot1) * rRoot);
      }
      ctx.closePath();
      ctx.stroke();

      if (gearVeryClose) {
        ctx.strokeStyle = "rgba(255, 245, 225, 0.45)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(sx, sy, pR * 0.92, -Math.PI * 0.85, -Math.PI * 0.25);
        ctx.stroke();
      }
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
      const hubR = Math.max(0.9, pR * 0.18);
      if (zoomFactor > 4 && g.kind !== "barrel") {
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

    // Wheel rim polish.
    ctx.strokeStyle = col(C.plateDark, 0.40);
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(sx, sy, wR, 0, Math.PI * 2); ctx.stroke();
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

    // Anchor-shaped lever body.
    ctx.fillStyle = col(C.steel, 0.62);
    ctx.strokeStyle = col(C.shadow, 0.70);
    ctx.lineWidth = 0.8;
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
    ctx.fill(); ctx.stroke();

    // Fork notch (receives balance impulse jewel).
    ctx.fillStyle = col(C.shadow, 0.25);
    ctx.beginPath();
    ctx.moveTo(forkR * 1.02,  W2 * 0.5);
    ctx.lineTo(forkR * 0.75,  W2 * 0.2);
    ctx.lineTo(forkR * 0.75, -W2 * 0.2);
    ctx.lineTo(forkR * 1.02, -W2 * 0.5);
    ctx.closePath();
    ctx.fill();

    // Guard pin.
    ctx.fillStyle = col(C.steel, 0.80);
    ctx.beginPath(); ctx.arc(forkR * 0.68, 0, W2 * 0.25, 0, Math.PI * 2); ctx.fill();

    // Pallet stones (entry + exit). Different angles because real
    // entry/exit lock geometries aren't identical on a Swiss lever.
    const stones = [
      { x: -L * 1.02, y: -L * 0.42, angle: -0.35 },
      { x: -L * 1.02, y:  L * 0.42, angle:  0.52 },
    ];
    for (const p of stones) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = col(C.ruby, 0.88);
      ctx.strokeStyle = col(C.shadow, 0.75);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.rect(-W2 * 0.5, -W2 * 0.45, W2 * 1.0, W2 * 0.9);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255, 230, 220, 0.45)";
      ctx.beginPath();
      ctx.rect(-W2 * 0.35, -W2 * 0.35, W2 * 0.25, W2 * 0.2);
      ctx.fill();
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

    const closeUp = zoomFactor > 2.5;
    const veryClose = zoomFactor > 4.5;

    ctx.save();
    ctx.translate(bx, by);

    // Hairspring — breathing spiral.
    const breathe = 1 + phase * 0.04;
    const turns = closeUp ? 9 : 6;
    const segs = closeUp ? 360 : 180;
    const hairLW = closeUp ? 0.45 : 0.6;
    const innerR = rr * 0.12;
    const outerR = rr * (closeUp ? 0.62 : 0.55);

    ctx.strokeStyle = col(C.steelBlue, closeUp ? 0.70 : 0.55);
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
      ctx.fillStyle = col(C.gold, 0.75);
      ctx.beginPath(); ctx.arc(studX, studY, rr * 0.022, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col(C.shadow, 0.70);
      ctx.lineWidth = 0.4;
      ctx.stroke();
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

    // Timing screws.
    const screwCount = 8;
    for (let i = 0; i < screwCount; i++) {
      const a = (i / screwCount) * Math.PI * 2;
      const x = Math.cos(a) * rimR, y = Math.sin(a) * rimR;
      const sz = Math.max(1.2, rr * 0.065);
      if (closeUp) {
        drawBluedScrew(x, y, sz, a + Math.PI / 4);
      } else {
        ctx.fillStyle = col(C.steelBlue, 0.85);
        ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col(C.shadow, 0.55);
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
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

    // 2. Gold chaton ring (annulus).
    const chatonOuter = s * 1.55;
    const chatonInner = s * 1.08;
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

    // Rim shadow on the opposite side — sells the dome curvature.
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = "rgba(60, 30, 18, 0.50)";
    ctx.lineWidth = Math.max(0.5, s * 0.10);
    ctx.beginPath();
    ctx.arc(x, y, s * 0.92, Math.PI * 0.1, Math.PI * 0.85);
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
    screws.forEach((s) => {
      const [x, y] = U(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, yaw);
      const sz = s.size * R;
      // Slot rotates slowly with yaw so the screw reads as set into
      // the plate rather than floating on it.
      drawBluedScrew(x, y, sz, s.a + yaw * 0.6);
    });
  }

  /* Screw — warm polished ink with cream sheen (not heat-blued steel,
     which would read cool against the cream parchment). The multiply
     blend onto cream gives these naturally-warm "iron in paper" tones. */
  function drawBluedScrew(x, y, r, slotAngle) {
    // Cast shadow.
    const castShadow = ctx.createRadialGradient(x, y + r * 0.2, r * 0.8, x, y + r * 0.2, r * 1.35);
    castShadow.addColorStop(0,    "rgba(0, 0, 0, 0)");
    castShadow.addColorStop(0.75, "rgba(16, 12, 8, 0)");
    castShadow.addColorStop(1,    "rgba(16, 12, 8, 0.22)");
    ctx.fillStyle = castShadow;
    ctx.beginPath(); ctx.arc(x, y + r * 0.2, r * 1.35, 0, Math.PI * 2); ctx.fill();

    // Body — warm brass-taupe gradient.
    const body = ctx.createRadialGradient(
      x - r * 0.2, y - r * 0.25, 0,
      x, y, r * 1.02,
    );
    body.addColorStop(0.00, "rgba(165, 138, 105, 0.95)");
    body.addColorStop(0.35, "rgba(125, 98, 70, 0.96)");
    body.addColorStop(0.75, "rgba(82, 62, 42, 0.97)");
    body.addColorStop(1.00, "rgba(48, 34, 22, 0.97)");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    // Edge.
    ctx.strokeStyle = "rgba(42, 28, 16, 0.70)";
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(x, y, r - 0.3, 0, Math.PI * 2); ctx.stroke();

    // Slot.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(slotAngle);
    const slotW = Math.max(0.9, r * 0.16);
    const slotL = r * 0.80;
    ctx.fillStyle = "rgba(28, 18, 10, 0.92)";
    ctx.beginPath();
    ctx.rect(-slotL, -slotW / 2, slotL * 2, slotW);
    ctx.fill();
    ctx.strokeStyle = "rgba(12, 8, 4, 0.45)";
    ctx.lineWidth = 0.4;
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

  /* Shimmers — light glinting off polished anglage (the beveled bridge
     edge). Not traveling particles; each shimmer is an elongated
     specular streak aligned with the bridge tangent, tapering at both
     ends. This is how gold/steel catches light when a camera pans
     across a fine movement. */
  function drawShimmers(yaw) {
    for (const sh of shimmers) {
      const br = bridges[sh.bridgeIdx];
      const pts = br.points;
      const totalIdx = pts.length - 1;
      const headT = sh.t;
      const streakLen = 0.12;
      const width = Math.max(1.0, br.width * R * 0.22);

      const samples = 20;
      for (let i = 0; i < samples; i++) {
        const tt = (i + 0.5) / samples;
        const pathT = headT - streakLen + tt * streakLen;
        if (pathT < 0 || pathT > 1) continue;

        const idx = pathT * totalIdx;
        const i0 = Math.max(0, Math.floor(idx));
        const i1 = Math.min(i0 + 1, totalIdx);
        const f = idx - i0;
        const u = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * f;
        const v = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * f;
        const [x, y] = U(u, v, yaw);

        const envelope = Math.pow(tt, 1.6) * Math.pow(1 - (1 - tt) * 0.05, 6);
        const coreR = width * (0.35 + envelope * 0.5);
        const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, coreR);
        if (sh.hue === "gold") {
          coreGrad.addColorStop(0,   `rgba(255, 240, 210, ${0.85 * envelope})`);
          coreGrad.addColorStop(0.4, col(C.gold, 0.55 * envelope));
          coreGrad.addColorStop(1,   col(C.gold, 0));
        } else {
          coreGrad.addColorStop(0,   `rgba(255, 220, 225, ${0.80 * envelope})`);
          coreGrad.addColorStop(0.4, col(C.rubyHalo, 0.55 * envelope));
          coreGrad.addColorStop(1,   col(C.rubyHalo, 0));
        }
        ctx.fillStyle = coreGrad;
        ctx.beginPath(); ctx.arc(x, y, coreR, 0, Math.PI * 2); ctx.fill();
      }

      // Head bright spot — peak of the specular reflection.
      if (headT >= 0 && headT <= 1) {
        const idx = headT * totalIdx;
        const i0 = Math.max(0, Math.floor(idx));
        const i1 = Math.min(i0 + 1, totalIdx);
        const f = idx - i0;
        const u = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * f;
        const v = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * f;
        const [x, y] = U(u, v, yaw);
        const headR = width * 1.2;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, headR);
        if (sh.hue === "gold") {
          glow.addColorStop(0,   "rgba(255, 248, 220, 0.95)");
          glow.addColorStop(0.3, col(C.gold, 0.75));
          glow.addColorStop(1,   col(C.gold, 0));
        } else {
          glow.addColorStop(0,   "rgba(255, 230, 230, 0.95)");
          glow.addColorStop(0.3, col(C.rubyHalo, 0.70));
          glow.addColorStop(1,   col(C.rubyHalo, 0));
        }
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, headR, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  let start = performance.now();
  let yaw = 0.34;
  // Ambient drift is intentionally near-imperceptible: ~25°/min, so
  // the composition slowly breathes without ever reading as "spinning".
  const YAW_SPEED = reduced ? 0 : 0.0000072;

  function frame(now) {
    const t = now - start;

    if (launch.mode === "launching" || launch.mode === "closing") {
      const elapsed = now - launch.startTime;
      const dur = launch.mode === "launching" ? launch.durationIn : launch.durationOut;
      const raw = Math.min(1, elapsed / dur);
      const e = easeInOutCubicSoft(raw);
      launch.eased = launch.mode === "launching" ? e : 1 - e;

      if (launch.target) {
        cx = cxA + (launch.target.cx - cxA) * launch.eased;
        cy = cyA + (launch.target.cy - cyA) * launch.eased;
        R  = RA  + (launch.target.R  - RA)  * launch.eased;
      }

      if (raw >= 1) {
        if (launch.mode === "launching") {
          launch.mode = "open";
          launch.eased = 1;
          launch.frozenT = t;
        } else {
          launch.mode = "idle";
          launch.eased = 0;
          launch.target = null;
          launch.frozenT = null;
          cx = cxA; cy = cyA; R = RA;
        }
      }
    } else if (launch.mode === "idle") {
      cx = cxA; cy = cyA; R = RA;
      launch.eased = 0;
    } else if (launch.mode === "open") {
      cx = launch.target.cx; cy = launch.target.cy; R = launch.target.R;
      launch.eased = 1;
    }

    // Yaw locks during launch so the composition doesn't drift.
    if (!reduced && launch.eased < 0.02) {
      yaw = 0.34 + t * YAW_SPEED;
    }

    // While the app is fully open, hold the clock still — the gears,
    // balance, pallet, and jewels all sit perfectly static behind it.
    const renderT =
      launch.mode === "open" && launch.frozenT !== null
        ? launch.frozenT
        : reduced
          ? 0
          : t;

    const zoomFactor = R / RA;

    ctx.clearRect(0, 0, W, H);
    drawMainplate(yaw);
    drawPerlage(yaw);
    drawCotes(yaw);
    drawEngraving(yaw);
    drawBridges(yaw);
    for (let i = 0; i < gears.length; i++) {
      drawGear(gears[i], i, yaw, renderT, zoomFactor);
    }
    drawPallet(renderT, yaw);
    drawBalanceWheel(renderT, yaw, zoomFactor);
    drawJewelsAndScrews(renderT, yaw, zoomFactor);

    // Shimmers pause entirely while the app is open (they'd contradict
    // the frozen-mechanism rule otherwise).
    if (!reduced && launch.mode !== "open") {
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

  return { canvas, launchTo, closeTo };
}
