// globe.js
// Ambient wireframe-globe background, lavender/lilac to match the little guy.
// - Slowly rotates, gently tracks pointer parallax
// - Pulsing data nodes scattered across the surface
// - Great-circle "data" arcs that travel between random nodes and recycle
// - Honors prefers-reduced-motion (no rotation, no traveling arcs)

export function mountGlobe(target, opts = {}) {
  if (!target) throw new Error("mountGlobe: target element required");

  const {
    nodeCount = 46,
    arcCount = 7,
    rotationSpeed = 0.00018,
    tilt = 0.34,
    blendMode = "multiply",
    radiusFactor = 0.42,
  } = opts;

  const TAU = Math.PI * 2;
  const reduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  if (getComputedStyle(target).position === "static") {
    target.style.position = "relative";
  }

  const canvas = document.createElement("canvas");
  canvas.className = "co-globe";
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    display: "block",
    pointerEvents: "none",
    mixBlendMode: blendMode,
  });
  target.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  let w = 0;
  let h = 0;
  let cx = 0;
  let cy = 0;
  let radius = 0;

  const resize = () => {
    const r = target.getBoundingClientRect();
    w = Math.max(1, Math.floor(r.width));
    h = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2;
    cy = h / 2;
    radius = Math.min(w, h) * radiusFactor;
  };

  const ro = new ResizeObserver(resize);
  ro.observe(target);
  resize();

  const sphericalToVec = (lat, lon) => ({
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.sin(lat),
    z: Math.cos(lat) * Math.sin(lon),
  });

  const rand = (a, b) => a + Math.random() * (b - a);

  // Nodes — even-ish unit-sphere distribution
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const u = Math.random();
    const v = Math.random();
    const lat = Math.asin(2 * u - 1);
    const lon = TAU * v;
    nodes.push({
      lat,
      lon,
      pulse: Math.random() * TAU,
      pulseSpeed: rand(0.0008, 0.0019),
      base: rand(1.2, 2.2),
    });
  }

  const makeArc = () => {
    let a = (Math.random() * nodes.length) | 0;
    let b = (Math.random() * nodes.length) | 0;
    let tries = 0;
    while (b === a && tries++ < 8) b = (Math.random() * nodes.length) | 0;
    return {
      a,
      b,
      t: -rand(0, 0.4),
      speed: rand(0.00045, 0.00085),
      hue: Math.random() < 0.55 ? "warm" : "cool",
    };
  };
  const arcs = Array.from({ length: arcCount }, makeArc);

  // 3D rotation: yaw around Y, then pitch around X
  const rot = (v, ya, pi) => {
    const cy_ = Math.cos(ya);
    const sy_ = Math.sin(ya);
    const x = v.x * cy_ + v.z * sy_;
    const z = -v.x * sy_ + v.z * cy_;
    const y = v.y;
    const cp = Math.cos(pi);
    const sp = Math.sin(pi);
    return { x, y: y * cp - z * sp, z: y * sp + z * cp };
  };

  const project = (v) => ({ x: cx + v.x * radius, y: cy + v.y * radius, z: v.z });

  // Great-circle interpolation
  const slerp = (a, b, t) => {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    const omega = Math.acos(dot);
    if (omega < 1e-4) return { ...a };
    const so = Math.sin(omega);
    const k0 = Math.sin((1 - t) * omega) / so;
    const k1 = Math.sin(t * omega) / so;
    return {
      x: a.x * k0 + b.x * k1,
      y: a.y * k0 + b.y * k1,
      z: a.z * k0 + b.z * k1,
    };
  };

  // Drawing
  const drawHalo = () => {
    const grad = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.55,
      cx,
      cy,
      radius * 1.45,
    );
    grad.addColorStop(0, "rgba(184, 155, 232, 0)");
    grad.addColorStop(0.55, "rgba(184, 155, 232, 0.10)");
    grad.addColorStop(1, "rgba(184, 155, 232, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.45, 0, TAU);
    ctx.fill();
  };

  const drawDisc = () => {
    const grad = ctx.createRadialGradient(
      cx - radius * 0.28,
      cy - radius * 0.32,
      radius * 0.18,
      cx,
      cy,
      radius,
    );
    grad.addColorStop(0, "rgba(234, 215, 255, 0.22)");
    grad.addColorStop(0.55, "rgba(184, 155, 232, 0.10)");
    grad.addColorStop(1, "rgba(110, 77, 176, 0.04)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
  };

  const segs = 64;
  const drawWireRing = (vertsFn) => {
    const pts = new Array(segs + 1);
    for (let j = 0; j <= segs; j++) pts[j] = vertsFn(j / segs);
    for (let j = 0; j < segs; j++) {
      const a = pts[j];
      const b = pts[j + 1];
      const za = a.z;
      const zb = b.z;
      const front = (za + zb) >= 0;
      const depth = (za + zb) * 0.5; // -1..1
      const alpha = front ? 0.18 + 0.22 * (depth + 1) : 0.06 + 0.06 * (depth + 1);
      ctx.strokeStyle = `rgba(152, 118, 212, ${alpha.toFixed(3)})`;
      ctx.lineWidth = front ? 0.75 : 0.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  };

  const drawWireframe = (yaw, pitch) => {
    const latCount = 9;
    for (let i = 1; i < latCount; i++) {
      const lat = -Math.PI / 2 + (i / latCount) * Math.PI;
      drawWireRing((t) => {
        const v = rot(sphericalToVec(lat, t * TAU), yaw, pitch);
        return project(v);
      });
    }
    const lonCount = 12;
    for (let i = 0; i < lonCount; i++) {
      const lon = (i / lonCount) * TAU;
      drawWireRing((t) => {
        const v = rot(sphericalToVec(-Math.PI / 2 + t * Math.PI, lon), yaw, pitch);
        return project(v);
      });
    }
    // Outer rim
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.strokeStyle = "rgba(152, 118, 212, 0.42)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  };

  const drawNodes = (yaw, pitch, time) => {
    for (const n of nodes) {
      const v = rot(sphericalToVec(n.lat, n.lon), yaw, pitch);
      if (v.z < -0.08) continue;
      const p = project(v);
      const phase = 0.5 + 0.5 * Math.sin(n.pulse + time * n.pulseSpeed);
      const depth = Math.max(0.25, v.z * 0.5 + 0.55);
      const r = n.base + phase * 1.1;
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 6);
      halo.addColorStop(0, `rgba(255, 240, 255, ${(0.55 * depth).toFixed(3)})`);
      halo.addColorStop(0.4, `rgba(184, 155, 232, ${(0.22 * depth).toFixed(3)})`);
      halo.addColorStop(1, "rgba(184, 155, 232, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 246, 255, ${(0.92 * depth).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
  };

  const drawArcs = (yaw, pitch, dt) => {
    const arcSegs = 48;
    for (let i = 0; i < arcs.length; i++) {
      const arc = arcs[i];
      arc.t += arc.speed * dt;
      if (arc.t >= 1.1) {
        arcs[i] = makeArc();
        continue;
      }
      const aN = nodes[arc.a];
      const bN = nodes[arc.b];
      if (!aN || !bN) continue;
      const va = sphericalToVec(aN.lat, aN.lon);
      const vb = sphericalToVec(bN.lat, bN.lon);
      const head = Math.max(0, Math.min(1, arc.t));
      const tail = Math.max(0, head - 0.42);
      if (head <= 0) continue;

      const pts = new Array(arcSegs + 1);
      for (let s = 0; s <= arcSegs; s++) {
        const tt = tail + (s / arcSegs) * (head - tail);
        const v0 = slerp(va, vb, tt);
        const lift = 1 + 0.18 * Math.sin(Math.PI * tt);
        const v0l = { x: v0.x * lift, y: v0.y * lift, z: v0.z * lift };
        const v = rot(v0l, yaw, pitch);
        pts[s] = { p: project(v), z: v.z };
      }
      const color = arc.hue === "warm" ? "247, 168, 208" : "152, 118, 212";

      for (let s = 1; s < pts.length; s++) {
        const a0 = pts[s - 1];
        const b0 = pts[s];
        if (a0.z < -0.05 && b0.z < -0.05) continue;
        const headFrac = s / (pts.length - 1);
        const depth = Math.max(0.2, ((a0.z + b0.z) * 0.5) * 0.5 + 0.55);
        const alpha = (0.12 + 0.78 * headFrac) * depth;
        ctx.strokeStyle = `rgba(${color}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.7 + 1.0 * headFrac;
        ctx.beginPath();
        ctx.moveTo(a0.p.x, a0.p.y);
        ctx.lineTo(b0.p.x, b0.p.y);
        ctx.stroke();
      }

      const headPt = pts[pts.length - 1];
      if (headPt && headPt.z >= -0.05) {
        const da = Math.max(0.3, headPt.z * 0.5 + 0.55);
        const grad = ctx.createRadialGradient(
          headPt.p.x,
          headPt.p.y,
          0,
          headPt.p.x,
          headPt.p.y,
          16,
        );
        grad.addColorStop(0, `rgba(255, 246, 255, ${(0.85 * da).toFixed(3)})`);
        grad.addColorStop(0.4, `rgba(${color}, ${(0.5 * da).toFixed(3)})`);
        grad.addColorStop(1, "rgba(255, 246, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(headPt.p.x, headPt.p.y, 16, 0, TAU);
        ctx.fill();
      }
    }
  };

  let yaw = 0;
  let last = performance.now();
  let destroyed = false;

  const frame = (now) => {
    if (destroyed) return;
    const dt = Math.min(64, now - last);
    last = now;
    if (!reduced) yaw += rotationSpeed * dt;

    ctx.clearRect(0, 0, w, h);
    drawHalo();
    drawDisc();
    drawWireframe(yaw, tilt);
    drawArcs(yaw, tilt, reduced ? 0 : dt);
    drawNodes(yaw, tilt, now);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    destroy() {
      destroyed = true;
      ro.disconnect();
      canvas.remove();
    },
  };
}
