/* =====================================================================
   Tilt: a little parallax as the phone moves. Band names and readings
   drift against each other and the tape slides the other way, driven by
   deviceorientation. The rest angle follows the hand slowly, so holding
   the phone at any angle settles back to centre.

   Writes --tilt-x / --tilt-y (−1…1) on the root element; input.css turns
   them into `translate`. iOS only reports motion after a permission
   prompt, which must come from a tap: the first tap on the page asks.
   Off for reduced motion, and switchable from search ("tilt").
   ===================================================================== */

const KEY = "co.tilt"; // "off" disables
const RANGE_DEG = 12; // degrees from rest for full travel
const FOLLOW = 0.006; // how fast the rest angle catches up, per event

let root = null;
let listening = false;
let rest = null;
let target = { x: 0, y: 0 };
let cur = { x: 0, y: 0 };
let frame = 0;

const clamp = (v) => Math.max(-1, Math.min(1, v));
const reduced = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function tiltOn() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch (_) {
    return true;
  }
}

function onOrient(e) {
  if (e.gamma == null || e.beta == null) return;
  if (!rest) rest = { x: e.gamma, y: e.beta };
  rest.x += (e.gamma - rest.x) * FOLLOW;
  rest.y += (e.beta - rest.y) * FOLLOW;
  target = {
    x: clamp((e.gamma - rest.x) / RANGE_DEG),
    y: clamp((e.beta - rest.y) / RANGE_DEG),
  };
  if (!frame) frame = requestAnimationFrame(step);
}

function step() {
  cur.x += (target.x - cur.x) * 0.14;
  cur.y += (target.y - cur.y) * 0.14;
  root.style.setProperty("--tilt-x", cur.x.toFixed(3));
  root.style.setProperty("--tilt-y", cur.y.toFixed(3));
  const settled =
    Math.abs(target.x - cur.x) < 0.002 && Math.abs(target.y - cur.y) < 0.002;
  frame = settled ? 0 : requestAnimationFrame(step);
}

function listen() {
  if (listening) return;
  listening = true;
  rest = null;
  window.addEventListener("deviceorientation", onOrient);
}

function stop() {
  listening = false;
  window.removeEventListener("deviceorientation", onOrient);
  cancelAnimationFrame(frame);
  frame = 0;
  cur = { x: 0, y: 0 };
  target = { x: 0, y: 0 };
  root?.style.removeProperty("--tilt-x");
  root?.style.removeProperty("--tilt-y");
}

function start() {
  if (listening || reduced() || typeof DeviceOrientationEvent === "undefined")
    return;
  const ask = DeviceOrientationEvent.requestPermission;
  if (typeof ask !== "function") return listen();
  // iOS: ask on the first tap (a prompt needs a user gesture).
  document.addEventListener(
    "click",
    () => {
      ask
        .call(DeviceOrientationEvent)
        .then((r) => r === "granted" && tiltOn() && listen())
        .catch(() => {});
    },
    { once: true, capture: true },
  );
}

export function initTilt(el = document.documentElement) {
  root = el;
  if (tiltOn()) start();
}

export function setTilt(on) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "off");
  } catch (_) {}
  if (on) start();
  else stop();
}
