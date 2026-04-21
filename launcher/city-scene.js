// city-scene.js
// Roku-style living city launcher backdrop.
// Drop-in ES module. No dependencies.
//
// Usage:
//   import { initCityScene } from './city-scene.js';
//   initCityScene({
//     container: document.getElementById('city-root'),
//     apps: [
//       { name: 'Notion', color: '#3B82F6', shade: '#1E40AF', iconUrl: '/icons/notion.png', url: '/apps/notion/' },
//       …
//     ],
//     onLaunch: (app) => { window.location.href = app.url; }
//   });
//
// The container should be a full-viewport element (position: fixed; inset: 0; or similar).
// Balloons are rendered as tappable circles containing the app's icon image.
// Everything else (city, sky, ambient events) is pure decoration.

export function initCityScene({ container, apps, onLaunch, onSettings }) {
if (!container) throw new Error('city-scene: container is required');
if (!Array.isArray(apps) || apps.length === 0) throw new Error('city-scene: apps array is required');
if (typeof onLaunch !== 'function') throw new Error('city-scene: onLaunch callback is required');

// ––––– measure container –––––
const rect = container.getBoundingClientRect();
const SCREEN_W = Math.max(rect.width, 320);
const SCREEN_H = Math.max(rect.height, 600);

// ––––– city dimensions –––––
const NEAR_H = Math.max(215, Math.floor(SCREEN_H * 0.42));
const MID_H = Math.max(175, Math.floor(SCREEN_H * 0.32));
const FAR_H = Math.max(130, Math.floor(SCREEN_H * 0.24));
const DISTRICT_W = SCREEN_W * 1.5;
const NUM_DISTRICTS = 5;
const TOTAL_W = DISTRICT_W * NUM_DISTRICTS;

// ––––– root –––––
container.style.position = container.style.position || 'relative';
container.style.overflow = 'hidden';
container.style.background = 'linear-gradient(to bottom, #1B1235 0%, #3A2456 28%, #6B3866 52%, #B85575 72%, #E89368 88%, #F5B574 100%)';

const root = document.createElement('div');
root.style.cssText = `position:absolute; inset:0; overflow:hidden;`;
container.appendChild(root);

// Inject animations once
if (!document.getElementById('city-scene-styles')) {
const st = document.createElement('style');
st.id = 'city-scene-styles';
st.textContent = `@keyframes city-twinkle { 0%,100% { opacity: 0.2; } 50% { opacity: 0.9; } } @keyframes city-blink { 0%,90%,100% { opacity: 1; } 92%,98% { opacity: 0.2; } } .city-blink { animation: city-blink 2s infinite; } @keyframes city-shimmer { 0%,100% { opacity:0.3; transform:translateX(0); } 50% { opacity:0.9; transform:translateX(2px); } } @keyframes city-lhpulse { 0%,100% { opacity: 0.95; } 50% { opacity: 0.4; } } .city-lighthouse-lamp, .city-lighthouse-glow { animation: city-lhpulse 4s infinite; } @keyframes city-heliblink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } } .city-heli-blink { animation: city-heliblink 0.4s infinite; } @keyframes city-fwfade { 0% { opacity: 1; transform: scale(0.3); } 100% { opacity: 0; transform: scale(1.4); } }`;
document.head.appendChild(st);
}

// ––––– layer stack –––––
const layers = {
stars: mkLayer('position:absolute; inset:0; z-index:1; pointer-events:none;'),
satellites: mkLayer('position:absolute; inset:0; z-index:1; pointer-events:none;'),
mountains: mkLayer(`position:absolute; bottom:${NEAR_H - 15}px; left:0; height:50px; z-index:2; will-change:transform; pointer-events:none;`),
haze: mkLayer(`position:absolute; bottom:${FAR_H - 50}px; left:0; right:0; height:180px; z-index:2; pointer-events:none; background: linear-gradient(to bottom, rgba(184,85,117,0) 0%, rgba(184,85,117,0.15) 70%, rgba(232,147,104,0.22) 100%);`),
clouds: mkLayer('position:absolute; top:60px; left:0; right:0; height:200px; z-index:2; will-change:transform; pointer-events:none;'),
skyEvents: mkLayer('position:absolute; inset:0; z-index:3; pointer-events:none;'),
cityFar: mkLayer(`position:absolute; bottom:${NEAR_H - 15}px; left:0; height:${FAR_H}px; will-change:transform; z-index:3;`),
cityMid: mkLayer(`position:absolute; bottom:${NEAR_H - 55}px; left:0; height:${MID_H}px; will-change:transform; z-index:4;`),
cityNear: mkLayer(`position:absolute; bottom:0; left:0; height:${NEAR_H}px; will-change:transform; z-index:6;`),
rooftopEvents: mkLayer(`position:absolute; bottom:0; left:0; height:${NEAR_H}px; z-index:7; pointer-events:none; will-change:transform;`),
river: mkLayer('position:absolute; bottom:0; left:0; height:22px; z-index:5; pointer-events:none; will-change:transform;'),
waterEvents: mkLayer('position:absolute; bottom:0; left:0; height:28px; z-index:7; pointer-events:none; will-change:transform;'),
balloons: mkLayer('position:absolute; inset:0; z-index:8;'),
powerlines: mkLayer('position:absolute; top:30px; left:0; right:0; height:50px; z-index:9; pointer-events:none;'),
lightning: mkLayer('position:absolute; inset:0; background:rgba(180,200,255,0); z-index:49; pointer-events:none; transition: background 0.1s;'),
celestial: null,
};

function mkLayer(css) {
const d = document.createElement('div');
d.style.cssText = css;
root.appendChild(d);
return d;
}

// Celestial body (moon) — clickable when onSettings is provided
const cel = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
cel.setAttribute('width', '44'); cel.setAttribute('height', '44'); cel.setAttribute('viewBox', '0 0 44 44');
cel.style.cssText = `position:absolute; top:max(env(safe-area-inset-top), 44px); right:24px; z-index:20; ${onSettings ? 'cursor:pointer; pointer-events:auto;' : 'pointer-events:none;'} transition: transform 0.15s cubic-bezier(.34,1.56,.64,1);`;
cel.innerHTML = `<circle cx="22" cy="22" r="18" fill="#FAE8C8"/><circle cx="22" cy="22" r="18" fill="#FAE8C8" opacity="0.3" transform="scale(1.15) translate(-3,-3)"/><circle cx="16" cy="18" r="2.8" fill="#D4B896" opacity="0.6"/><circle cx="27" cy="25" r="1.8" fill="#D4B896" opacity="0.6"/>`;
if (onSettings) {
cel.setAttribute('role', 'button');
cel.setAttribute('aria-label', 'Settings');
cel.addEventListener('click', (e) => { e.stopPropagation(); cel.style.transform = 'scale(1.2)'; setTimeout(() => { cel.style.transform = ''; }, 180); onSettings(); });
}
root.appendChild(cel);
layers.celestial = cel;

// ––––– stars –––––
let starHTML = '';
for (let i = 0; i < 35; i++) {
const x = Math.random() * SCREEN_W;
const y = Math.random() * Math.min(220, SCREEN_H * 0.35);
const s = 0.4 + Math.random() * 1.2;
const op = 0.3 + Math.random() * 0.6;
const flicker = Math.random() > 0.7;
starHTML += `<div style="position:absolute; left:${x}px; top:${y}px; width:${s}px; height:${s}px; background:#fff; border-radius:50%; opacity:${op}; ${flicker ? 'animation: city-twinkle 3s infinite;' : ''}"></div>`;
}
layers.stars.innerHTML = starHTML;

// ––––– city building helpers –––––
function addWindows(out, bx, by, bw, bh, density = 0.42) {
const wRows = Math.floor((bh - 10) / 7);
const wCols = Math.max(2, Math.floor(bw / 6));
const colSpacing = bw / (wCols + 1);
for (let r = 0; r < wRows; r++) for (let c = 0; c < wCols; c++) {
if (Math.random() > density + 0.1) {
const wx = bx + colSpacing * (c + 1) - 1.2;
const wy = by + 8 + r * 7;
if (wy < NEAR_H - 6) {
const lit = Math.random();
let color = '#FFD580', op = 1;
if (lit < 0.1) color = '#9FE1FF';
else if (lit < 0.16) color = '#FF9F70';
else if (lit > 0.72) { op = 0.45; color = '#4A3A20'; }
if (op > 0.8 && (color === '#FFD580' || color === '#FF9F70')) {
out.push(`<rect x="${(wx-0.5).toFixed(1)}" y="${(wy-0.5).toFixed(1)}" width="3.5" height="4.2" fill="${color}" opacity="0.22"/>`);
}
out.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="2.5" height="3.2" fill="${color}" opacity="${op}"/>`);
}
}
}
}

function buildDowntown(startX, parts, windows, signs, extras) {
const h = NEAR_H, endX = startX + DISTRICT_W;
const theaterX = startX + 30 + Math.random() * 80;
const tw = 56, th = 165;
let fillX = startX;
while (fillX < theaterX - 10) {
const bw = 26 + Math.random() * 14, bh = 90 + Math.random() * 35;
parts.push(`<rect x="${fillX}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
if (Math.random() > 0.5) parts.push(`<rect x="${fillX - 1}" y="${h - bh - 2}" width="${bw + 2}" height="3" fill="#080419"/>`);
addWindows(windows, fillX, h - bh, bw, bh);
fillX += bw + 2;
}
parts.push(`<rect x="${theaterX}" y="${h - th}" width="${tw}" height="${th}" fill="#080419"/>`);
parts.push(`<rect x="${theaterX - 3}" y="${h - th - 3}" width="${tw + 6}" height="4" fill="#080419"/>`);
parts.push(`<rect x="${theaterX + tw/2 - 3}" y="${h - th - 18}" width="6" height="15" fill="#080419"/>`);
parts.push(`<polygon points="${theaterX + tw/2 - 6},${h - th - 18} ${theaterX + tw/2},${h - th - 30} ${theaterX + tw/2 + 6},${h - th - 18}" fill="#080419"/>`);
parts.push(`<circle cx="${theaterX + tw/2}" cy="${h - th - 32}" r="1.2" fill="#FFE070" class="city-blink"/>`);
const sw = tw - 6, sh = 14, sx = theaterX + 3, sy = h - th + 8;
signs.push(`<rect x="${sx - 1}" y="${sy - 1}" width="${sw + 2}" height="${sh + 2}" fill="#FFD580" opacity="0.15"/>`);
signs.push(`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="1" fill="#080419" stroke="#FFD580" stroke-width="0.7"/>`);
signs.push(`<text x="${sx + sw/2}" y="${sy + 6}" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="6" font-weight="700" fill="#FFD580" letter-spacing="0.5">ROXY</text>`);
signs.push(`<text x="${sx + sw/2}" y="${sy + 11.5}" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="3.5" fill="#FFB070" letter-spacing="0.2">★ ★ ★</text>`);
for (let bi = 0; bi < 8; bi++) {
const bx = sx + (bi / 7) * sw;
signs.push(`<circle cx="${bx}" cy="${sy - 1.5}" r="0.6" fill="#FFE070" opacity="${(0.6 + Math.random() * 0.4).toFixed(2)}"/>`);
signs.push(`<circle cx="${bx}" cy="${sy + sh + 1.5}" r="0.6" fill="#FFE070" opacity="${(0.6 + Math.random() * 0.4).toFixed(2)}"/>`);
}
addWindows(windows, theaterX, h - th + 30, tw, th - 30);
fillX = theaterX + tw + 4;
let didChurch = false;
while (fillX < endX) {
if (!didChurch && fillX > endX - 100 && Math.random() > 0.3) {
didChurch = true;
const cw = 32, ch = 70;
parts.push(`<rect x="${fillX}" y="${h - ch}" width="${cw}" height="${ch}" fill="#080419"/>`);
parts.push(`<path d="M ${fillX + cw/2 - 4} ${h} L ${fillX + cw/2 - 4} ${h - 14} Q ${fillX + cw/2} ${h - 18} ${fillX + cw/2 + 4} ${h - 14} L ${fillX + cw/2 + 4} ${h}" fill="#1a0e35"/>`);
signs.push(`<circle cx="${fillX + cw/2}" cy="${h - ch + 20}" r="3" fill="#FFD580" opacity="0.85"/>`);
signs.push(`<circle cx="${fillX + cw/2}" cy="${h - ch + 20}" r="3.5" fill="#FFD580" opacity="0.2"/>`);
const stX = fillX + cw / 2;
parts.push(`<rect x="${stX - 5}" y="${h - ch - 12}" width="10" height="12" fill="#080419"/>`);
parts.push(`<polygon points="${stX - 6},${h - ch - 12} ${stX},${h - ch - 35} ${stX + 6},${h - ch - 12}" fill="#080419"/>`);
parts.push(`<rect x="${stX - 0.4}" y="${h - ch - 42}" width="0.8" height="7" fill="#080419"/>`);
parts.push(`<rect x="${stX - 1.5}" y="${h - ch - 39}" width="3" height="0.8" fill="#080419"/>`);
signs.push(`<rect x="${stX - 2}" y="${h - ch - 8}" width="4" height="5" fill="#FFD580" opacity="0.7"/>`);
fillX += cw + 2;
continue;
}
const bw = 24 + Math.random() * 14, bh = 95 + Math.random() * 40;
parts.push(`<rect x="${fillX}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
if (Math.random() > 0.5) parts.push(`<rect x="${fillX - 1}" y="${h - bh - 2}" width="${bw + 2}" height="3" fill="#080419"/>`);
addWindows(windows, fillX, h - bh, bw, bh);
fillX += bw + 2;
}
}

function buildHarbor(startX, parts, windows, signs, extras) {
const h = NEAR_H, endX = startX + DISTRICT_W;
let x = startX, didBillboard = false, didLighthouse = false;
while (x < endX) {
if (!didLighthouse && x > endX - 50) {
didLighthouse = true;
const lhX = x, lhBaseW = 18, lhBaseH = 14;
parts.push(`<polygon points="${lhX - 2},${h} ${lhX + lhBaseW + 2},${h} ${lhX + lhBaseW},${h - lhBaseH} ${lhX},${h - lhBaseH}" fill="#080419"/>`);
parts.push(`<polygon points="${lhX + 3},${h - lhBaseH} ${lhX + lhBaseW - 3},${h - lhBaseH} ${lhX + lhBaseW - 5},${h - lhBaseH - 50} ${lhX + 5},${h - lhBaseH - 50}" fill="#080419"/>`);
signs.push(`<polygon points="${lhX + 3.5},${h - lhBaseH - 16} ${lhX + lhBaseW - 3.5},${h - lhBaseH - 16} ${lhX + lhBaseW - 4},${h - lhBaseH - 22} ${lhX + 4},${h - lhBaseH - 22}" fill="#E24B4A" opacity="0.7"/>`);
signs.push(`<polygon points="${lhX + 4.4},${h - lhBaseH - 32} ${lhX + lhBaseW - 4.4},${h - lhBaseH - 32} ${lhX + lhBaseW - 5},${h - lhBaseH - 38} ${lhX + 5},${h - lhBaseH - 38}" fill="#E24B4A" opacity="0.7"/>`);
parts.push(`<rect x="${lhX + 3}" y="${h - lhBaseH - 52}" width="${lhBaseW - 6}" height="2" fill="#080419"/>`);
parts.push(`<rect x="${lhX + 1}" y="${h - lhBaseH - 53}" width="${lhBaseW - 2}" height="1.5" fill="#080419"/>`);
parts.push(`<rect x="${lhX + 5}" y="${h - lhBaseH - 60}" width="${lhBaseW - 10}" height="8" fill="#080419"/>`);
signs.push(`<circle cx="${lhX + lhBaseW/2}" cy="${h - lhBaseH - 56}" r="2.5" fill="#FFE890" class="city-lighthouse-lamp"/>`);
signs.push(`<circle cx="${lhX + lhBaseW/2}" cy="${h - lhBaseH - 56}" r="5" fill="#FFE890" opacity="0.4" class="city-lighthouse-glow"/>`);
signs.push(`<circle cx="${lhX + lhBaseW/2}" cy="${h - lhBaseH - 56}" r="9" fill="#FFE890" opacity="0.18" class="city-lighthouse-glow"/>`);
parts.push(`<path d="M ${lhX + 5} ${h - lhBaseH - 60} Q ${lhX + lhBaseW/2} ${h - lhBaseH - 70} ${lhX + lhBaseW - 5} ${h - lhBaseH - 60}" fill="#080419"/>`);
parts.push(`<rect x="${lhX + lhBaseW/2 - 0.4}" y="${h - lhBaseH - 75}" width="0.8" height="6" fill="#080419"/>`);
signs.push(`<circle cx="${lhX + lhBaseW/2}" cy="${h - lhBaseH - 76}" r="0.8" fill="#FF3030" class="city-blink"/>`);
x += lhBaseW + 6;
continue;
}
const t = Math.random();
let bw, bh;
if (t < 0.3) {
bw = 40 + Math.random() * 16; bh = 60 + Math.random() * 25;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
for (let p = 0; p < 3; p++) {
const px = x + (p + 0.5) * bw / 3;
parts.push(`<polygon points="${px - bw/6},${h - bh} ${px},${h - bh - 8} ${px + bw/6},${h - bh}" fill="#080419"/>`);
}
if (!didBillboard && Math.random() > 0.3) {
didBillboard = true;
const bbW = bw + 4, bbH = 14, bbX = x - 2, bbY = h - bh - 22;
const colors = ['#9FE1FF', '#FFD580', '#FF6B9D', '#A8FFB0'];
const sc = colors[Math.floor(Math.random() * colors.length)];
const msgs = ['HARBOR FRESH', 'COLD BEER', 'OPEN LATE', 'BAIT & TACKLE'];
const msg = msgs[Math.floor(Math.random() * msgs.length)];
signs.push(`<rect x="${bbX - 1}" y="${bbY - 1}" width="${bbW + 2}" height="${bbH + 2}" fill="${sc}" opacity="0.12"/>`);
signs.push(`<rect x="${bbX}" y="${bbY}" width="${bbW}" height="${bbH}" fill="#080419" stroke="${sc}" stroke-width="0.6"/>`);
signs.push(`<text x="${bbX + bbW/2}" y="${bbY + 9}" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="5.5" font-weight="700" fill="${sc}" letter-spacing="0.3">${msg}</text>`);
signs.push(`<line x1="${bbX + 4}" y1="${bbY + bbH}" x2="${bbX + 4}" y2="${h - bh}" stroke="#080419" stroke-width="0.6"/>`);
signs.push(`<line x1="${bbX + bbW - 4}" y1="${bbY + bbH}" x2="${bbX + bbW - 4}" y2="${h - bh}" stroke="#080419" stroke-width="0.6"/>`);
}
}
else if (t < 0.5) {
bw = 12; bh = 110;
parts.push(`<rect x="${x}" y="${h - bh}" width="2" height="${bh}" fill="#080419"/>`);
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="2" fill="#080419"/>`);
parts.push(`<line x1="${x + 2}" y1="${h - bh}" x2="${x + bw}" y2="${h - bh + 8}" stroke="#080419" stroke-width="0.8"/>`);
parts.push(`<rect x="${x - 1}" y="${h - 30}" width="4" height="30" fill="#080419"/>`);
}
else {
bw = 24 + Math.random() * 12; bh = 35 + Math.random() * 25;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
}
addWindows(windows, x, h - bh, bw, bh, 0.55);
x += bw + 1;
}
}

function buildMidtown(startX, parts, windows, signs, extras) {
const h = NEAR_H, endX = startX + DISTRICT_W;
let x = startX, didStadium = false;
while (x < endX) {
if (!didStadium && x > startX + DISTRICT_W * 0.4 && x < startX + DISTRICT_W * 0.6) {
didStadium = true;
const stX = x, stW = 70, stH = 50;
parts.push(`<path d="M ${stX} ${h} L ${stX} ${h - 30} Q ${stX} ${h - stH} ${stX + 10} ${h - stH} L ${stX + stW - 10} ${h - stH} Q ${stX + stW} ${h - stH} ${stX + stW} ${h - 30} L ${stX + stW} ${h} Z" fill="#080419"/>`);
for (let p = 0; p < 4; p++) {
const px = stX + 10 + p * (stW - 20) / 3;
parts.push(`<rect x="${px - 0.6}" y="${h - stH - 22}" width="1.2" height="22" fill="#080419"/>`);
parts.push(`<rect x="${px - 4}" y="${h - stH - 26}" width="8" height="4" fill="#080419"/>`);
extras.push(`<rect x="${px - 3.5}" y="${h - stH - 25}" width="7" height="3" fill="#FFE890" opacity="0.85"/>`);
extras.push(`<rect x="${px - 5}" y="${h - stH - 26.5}" width="10" height="6" fill="#FFE890" opacity="0.18"/>`);
}
parts.push(`<path d="M ${stX + stW/2 - 5} ${h} L ${stX + stW/2 - 5} ${h - 12} Q ${stX + stW/2} ${h - 16} ${stX + stW/2 + 5} ${h - 12} L ${stX + stW/2 + 5} ${h}" fill="#1a0e35"/>`);
extras.push(`<ellipse cx="${stX + stW/2}" cy="${h - 8}" rx="${stW/2 - 3}" ry="6" fill="#FFE890" opacity="0.18"/>`);
x += stW + 4;
continue;
}
const t = Math.random(); let bw, bh;
if (t < 0.18) {
bw = 32 + Math.random() * 12; bh = 150 + Math.random() * 40;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
parts.push(`<rect x="${x - 2}" y="${h - bh - 4}" width="${bw + 4}" height="4" fill="#080419"/>`);
parts.push(`<rect x="${x + bw/2 - 2}" y="${h - bh - 16}" width="4" height="12" fill="#080419"/>`);
} else if (t < 0.34) {
bw = 18 + Math.random() * 10; bh = 175 + Math.random() * 30;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
parts.push(`<rect x="${x + bw/2 - 0.6}" y="${h - bh - 14}" width="1.2" height="14" fill="#080419"/>`);
parts.push(`<circle cx="${x + bw/2}" cy="${h - bh - 14}" r="1" fill="#FF3030" class="city-blink"/>`);
} else if (t < 0.5) {
bw = 38 + Math.random() * 14; bh = 105 + Math.random() * 35;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
for (let i = 0; i < 4; i++) {
const tx = x + 4 + i * (bw - 8) / 3;
parts.push(`<rect x="${tx - 1}" y="${h - bh - 8}" width="2" height="8" fill="#080419"/>`);
}
} else {
bw = 30 + Math.random() * 14; bh = 95 + Math.random() * 40;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
}
addWindows(windows, x, h - bh, bw, bh);
x += bw + 1;
}
}

function buildBridgeDistrict(startX, parts, windows, signs, extras) {
const h = NEAR_H, endX = startX + DISTRICT_W, bankW = 90;
let lx = startX;
while (lx < startX + bankW - 4) {
const bw = 20 + Math.random() * 12, bh = 70 + Math.random() * 30;
parts.push(`<rect x="${lx}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
addWindows(windows, lx, h - bh, bw, bh);
lx += bw + 2;
}
let rx = startX + DISTRICT_W - bankW;
while (rx < endX) {
const bw = 20 + Math.random() * 12, bh = 70 + Math.random() * 30;
parts.push(`<rect x="${rx}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
addWindows(windows, rx, h - bh, bw, bh);
rx += bw + 2;
}
const bStartX = startX + bankW, bEndX = startX + DISTRICT_W - bankW;
const bridgeY = h - 30, bridgeSpan = bEndX - bStartX;
extras.push(`<rect x="${bStartX}" y="${bridgeY}" width="${bridgeSpan}" height="3" fill="#080419"/>`);
for (let p = 0; p < 3; p++) {
const px = bStartX + (p / 2) * bridgeSpan;
extras.push(`<rect x="${px - 2}" y="${bridgeY - 38}" width="4" height="38" fill="#080419"/>`);
extras.push(`<rect x="${px - 6}" y="${bridgeY - 38}" width="12" height="3" fill="#080419"/>`);
}
extras.push(`<path d="M ${bStartX} ${bridgeY - 35} Q ${bStartX + bridgeSpan/4} ${bridgeY - 12} ${bStartX + bridgeSpan/2} ${bridgeY - 35} Q ${bStartX + 3*bridgeSpan/4} ${bridgeY - 12} ${bEndX} ${bridgeY - 35}" fill="none" stroke="#080419" stroke-width="0.8"/>`);
for (let c = 0; c < 6; c++) {
const cx = bStartX + Math.random() * bridgeSpan;
extras.push(`<circle cx="${cx}" cy="${bridgeY - 1}" r="0.8" fill="#FFE070" opacity="0.9"/>`);
extras.push(`<circle cx="${cx + 8}" cy="${bridgeY - 1}" r="0.7" fill="#FF4040" opacity="0.7"/>`);
}
}

function buildUptown(startX, parts, windows, signs, extras) {
const h = NEAR_H, endX = startX + DISTRICT_W;
const fwX = startX + 20, fwR = 32, fwCY = h - 50;
parts.push(`<polygon points="${fwX - 10},${h} ${fwX},${fwCY} ${fwX + 10},${h}" fill="#080419"/>`);
parts.push(`<polygon points="${fwX + 2*fwR - 10},${h} ${fwX + 2*fwR},${fwCY} ${fwX + 2*fwR + 10},${h}" fill="#080419"/>`);
parts.push(`<line x1="${fwX}" y1="${fwCY}" x2="${fwX + 2*fwR}" y2="${fwCY}" stroke="#080419" stroke-width="2"/>`);
extras.push(`<circle cx="${fwX + fwR}" cy="${fwCY}" r="${fwR}" fill="none" stroke="#080419" stroke-width="0.8"/>`);
extras.push(`<circle cx="${fwX + fwR}" cy="${fwCY}" r="${fwR - 2}" fill="none" stroke="#080419" stroke-width="0.5"/>`);
extras.push(`<circle cx="${fwX + fwR}" cy="${fwCY}" r="3" fill="#080419"/>`);
const fwColors = ['#FFD580', '#FF6B9D', '#9FE1FF', '#A8FFB0', '#FFE890'];
for (let s = 0; s < 12; s++) {
const ang = (s / 12) * Math.PI * 2;
const x2 = fwX + fwR + Math.cos(ang) * fwR, y2 = fwCY + Math.sin(ang) * fwR;
extras.push(`<line x1="${fwX + fwR}" y1="${fwCY}" x2="${x2}" y2="${y2}" stroke="#080419" stroke-width="0.5" opacity="0.6"/>`);
const gX = fwX + fwR + Math.cos(ang) * (fwR - 1), gY = fwCY + Math.sin(ang) * (fwR - 1);
const col = fwColors[s % fwColors.length];
extras.push(`<rect x="${gX - 2}" y="${gY - 1.5}" width="4" height="3" rx="0.5" fill="#080419"/>`);
extras.push(`<rect x="${gX - 1.6}" y="${gY - 1.1}" width="3.2" height="2.2" rx="0.3" fill="${col}" opacity="0.9"/>`);
}
for (let l = 0; l < 24; l++) {
const ang = (l / 24) * Math.PI * 2;
const lx = fwX + fwR + Math.cos(ang) * (fwR + 1), ly = fwCY + Math.sin(ang) * (fwR + 1);
const col = fwColors[l % fwColors.length];
const delay = (l / 24) * 2;
extras.push(`<circle cx="${lx}" cy="${ly}" r="0.8" fill="${col}" style="animation: city-blink 2s infinite; animation-delay: ${delay.toFixed(1)}s;"/>`);
}
let x = fwX + 2 * fwR + 18;
const towerX = x + 30 + Math.random() * 40;
while (x < towerX - 6) {
const bw = 18 + Math.random() * 14, bh = 130 + Math.random() * 50;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
if (Math.random() > 0.5) {
parts.push(`<rect x="${x + bw/2 - 0.6}" y="${h - bh - 10}" width="1.2" height="10" fill="#080419"/>`);
parts.push(`<circle cx="${x + bw/2}" cy="${h - bh - 10}" r="0.9" fill="#FF3030" class="city-blink"/>`);
}
addWindows(windows, x, h - bh, bw, bh);
x += bw + 2;
}
const towerW = 14, towerH = 200;
parts.push(`<rect x="${towerX}" y="${h - towerH}" width="${towerW}" height="${towerH}" fill="#080419"/>`);
parts.push(`<rect x="${towerX - 6}" y="${h - towerH - 10}" width="${towerW + 12}" height="10" fill="#080419"/>`);
parts.push(`<rect x="${towerX - 8}" y="${h - towerH - 14}" width="${towerW + 16}" height="4" fill="#080419"/>`);
for (let r = 0; r < 7; r++) {
const lx = towerX - 7 + r * (towerW + 14) / 6;
extras.push(`<rect x="${lx}" y="${h - towerH - 9}" width="1.2" height="2" fill="#FFD580" opacity="${(0.7 + Math.random() * 0.3).toFixed(2)}"/>`);
}
parts.push(`<rect x="${towerX + towerW/2 - 0.6}" y="${h - towerH - 30}" width="1.2" height="16" fill="#080419"/>`);
parts.push(`<circle cx="${towerX + towerW/2}" cy="${h - towerH - 30}" r="1.3" fill="#FF2020" class="city-blink"/>`);
for (let r = 0; r < Math.floor(towerH / 10); r++) {
extras.push(`<rect x="${towerX + 2}" y="${h - towerH + 8 + r * 10}" width="${towerW - 4}" height="2" fill="#FFD580" opacity="${Math.random() > 0.4 ? 0.8 : 0.3}"/>`);
}
x = towerX + towerW + 4;
while (x < endX) {
const bw = 18 + Math.random() * 14, bh = 130 + Math.random() * 50;
parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#080419"/>`);
if (Math.random() > 0.5) {
parts.push(`<rect x="${x + bw/2 - 0.6}" y="${h - bh - 10}" width="1.2" height="10" fill="#080419"/>`);
parts.push(`<circle cx="${x + bw/2}" cy="${h - bh - 10}" r="0.9" fill="#FF3030" class="city-blink"/>`);
}
addWindows(windows, x, h - bh, bw, bh);
x += bw + 2;
}
}

function buildNearCity(layerEl) {
let svg = `<svg width="${TOTAL_W * 2}" height="${NEAR_H}" viewBox="0 0 ${TOTAL_W * 2} ${NEAR_H}" style="display:block;">`;
let all = '';
for (let loop = 0; loop < 2; loop++) {
for (let d = 0; d < NUM_DISTRICTS; d++) {
const parts = [], windows = [], signs = [], extras = [];
const sx = loop * TOTAL_W + d * DISTRICT_W;
if (d === 0) buildDowntown(sx, parts, windows, signs, extras);
else if (d === 1) buildHarbor(sx, parts, windows, signs, extras);
else if (d === 2) buildMidtown(sx, parts, windows, signs, extras);
else if (d === 3) buildBridgeDistrict(sx, parts, windows, signs, extras);
else if (d === 4) buildUptown(sx, parts, windows, signs, extras);
all += parts.join('') + windows.join('') + signs.join('') + extras.join('');
}
}
svg += all + '</svg>';
layerEl.innerHTML = svg;
layerEl.style.width = (TOTAL_W * 2) + 'px';
layerEl._totalW = TOTAL_W;
}

function buildMidCity(layerEl) {
const h = MID_H;
let svg = `<svg width="${TOTAL_W * 2}" height="${h}" viewBox="0 0 ${TOTAL_W * 2} ${h}" style="display:block;">`;
function sec(offsetX) {
let parts = [], x = offsetX;
const windows = [], features = [];
while (x < offsetX + TOTAL_W) {
const t = Math.random(); let bw, bh;
if (t < 0.1) { bw = 38; bh = 155; parts.push(`<path d="M ${x} ${h} L ${x} ${h - bh + 14} L ${x + 6} ${h - bh + 6} L ${x + bw/2 - 4} ${h - bh + 6} L ${x + bw/2 - 4} ${h - bh - 10} L ${x + bw/2 + 4} ${h - bh - 10} L ${x + bw/2 + 4} ${h - bh + 6} L ${x + bw - 6} ${h - bh + 6} L ${x + bw} ${h - bh + 14} L ${x + bw} ${h} Z" fill="#0F0828"/>`); features.push(`<circle cx="${x + bw/2}" cy="${h - bh - 14}" r="1.3" fill="#FF3030" class="city-blink"/>`); }
else if (t < 0.28) { bw = 32 + Math.random() * 18; bh = 110 + Math.random() * 40; parts.push(`<path d="M ${x} ${h} L ${x} ${h - bh + 6} L ${x + 3} ${h - bh} L ${x + bw - 3} ${h - bh} L ${x + bw} ${h - bh + 6} L ${x + bw} ${h} Z" fill="#0F0828"/>`); }
else if (t < 0.42) { bw = 14 + Math.random() * 8; bh = 130 + Math.random() * 30; parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#0F0828"/>`); }
else if (t < 0.6) { bw = 28 + Math.random() * 10; bh = 90 + Math.random() * 35; parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#0F0828"/>`); }
else { bw = 22 + Math.random() * 12; bh = 80 + Math.random() * 35; parts.push(`<rect x="${x}" y="${h - bh}" width="${bw}" height="${bh}" fill="#0F0828"/>`); }
const wRows = Math.floor((bh - 8) / 6), wCols = Math.max(2, Math.floor(bw / 5)), csp = bw / (wCols + 1);
for (let r = 0; r < wRows; r++) for (let c = 0; c < wCols; c++) {
if (Math.random() > 0.45) {
const wx = x + csp * (c + 1) - 1, wy = h - bh + 6 + r * 6;
if (wy < h - 4) {
const lit = Math.random(); let color = '#FFD580', op = 0.95;
if (lit < 0.1) color = '#9FE1FF'; else if (lit < 0.18) color = '#FFB070'; else if (lit > 0.7) { op = 0.4; color = '#5A4830'; }
windows.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="2" height="2.5" fill="${color}" opacity="${op}"/>`);
}
}
}
x += bw + 1;
}
return parts.join('') + windows.join('') + features.join('');
}
svg += sec(0) + sec(TOTAL_W) + '</svg>';
layerEl.innerHTML = svg; layerEl.style.width = (TOTAL_W * 2) + 'px'; layerEl._totalW = TOTAL_W;
}

function buildFarCity(layerEl) {
const h = FAR_H;
let svg = `<svg width="${TOTAL_W * 2}" height="${h}" viewBox="0 0 ${TOTAL_W * 2} ${h}" style="display:block;">`;
function sec(offsetX) {
let path = `M ${offsetX} ${h}`; let x = offsetX;
const windows = [], lights = [];
while (x < offsetX + TOTAL_W) {
const t = Math.random(); let bw, bh;
if (t < 0.18) { bw = 14; bh = 115; path += ` L ${x} ${h - bh + 10} L ${x + bw/2} ${h - bh - 6} L ${x + bw} ${h - bh + 10} L ${x + bw} ${h}`; if (Math.random() > 0.3) lights.push(`<circle cx="${x + bw/2}" cy="${h - bh - 4}" r="0.9" fill="#FF4444" class="city-blink"/>`); }
else if (t < 0.4) { bw = 22 + Math.random() * 12; bh = 65 + Math.random() * 40; path += ` L ${x} ${h - bh} L ${x + bw} ${h - bh} L ${x + bw} ${h}`; }
else if (t < 0.6) { bw = 28 + Math.random() * 15; bh = 75 + Math.random() * 35; path += ` L ${x} ${h - bh + 4} L ${x + 4} ${h - bh} L ${x + bw - 4} ${h - bh} L ${x + bw} ${h - bh + 4} L ${x + bw} ${h}`; }
else { bw = 18 + Math.random() * 10; bh = 55 + Math.random() * 30; path += ` L ${x} ${h - bh} L ${x + bw} ${h - bh} L ${x + bw} ${h}`; }
const wRows = Math.floor(bh / 7), wCols = Math.floor(bw / 5);
for (let r = 0; r < wRows; r++) for (let c = 0; c < wCols; c++) {
if (Math.random() > 0.55) {
const wx = x + 2 + c * 5, wy = h - bh + 4 + r * 7;
if (wy < h - 3) {
const op = Math.random() > 0.5 ? 0.95 : 0.5;
const yellow = Math.random() > 0.15;
windows.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="1.5" height="2" fill="${yellow ? '#FFD580' : '#FFA8A8'}" opacity="${op}"/>`);
}
}
}
x += bw;
}
path += ` L ${offsetX + TOTAL_W} ${h} Z`;
return `<path d="${path}" fill="#241845"/>` + windows.join('') + lights.join('');
}
svg += sec(0) + sec(TOTAL_W) + '</svg>';
layerEl.innerHTML = svg; layerEl.style.width = (TOTAL_W * 2) + 'px'; layerEl._totalW = TOTAL_W;
}

function buildMountains(layerEl) {
let svg = `<svg width="${TOTAL_W * 2}" height="50" viewBox="0 0 ${TOTAL_W * 2} 50" style="display:block;">`;
function sec(offsetX) {
let path = `M ${offsetX} 50`, x = offsetX;
while (x < offsetX + TOTAL_W) {
const pw = 60 + Math.random() * 90, ph = 22 + Math.random() * 22;
path += ` L ${x + pw * 0.3} ${50 - ph * 0.6} L ${x + pw * 0.5} ${50 - ph} L ${x + pw * 0.7} ${50 - ph * 0.7} L ${x + pw} ${50 - ph * 0.3}`;
x += pw;
}
path += ` L ${offsetX + TOTAL_W} 50 Z`;
return `<path d="${path}" fill="#3A2456" opacity="0.55"/>`;
}
svg += sec(0) + sec(TOTAL_W) + '</svg>';
layerEl.innerHTML = svg; layerEl.style.width = (TOTAL_W * 2) + 'px'; layerEl._totalW = TOTAL_W;
}

function buildRiver(layerEl) {
let html = '';
layerEl.style.width = (TOTAL_W * 2) + 'px';
layerEl._totalW = TOTAL_W;
for (let loop = 0; loop < 2; loop++) {
const hs = loop * TOTAL_W + 1 * DISTRICT_W;
html += `<div style="position:absolute; bottom:0; left:${hs}px; width:${DISTRICT_W}px; height:22px; background: linear-gradient(to bottom, #0a0418, #1a0e35);"></div>`;
for (let i = 0; i < 22; i++) {
const x = hs + Math.random() * DISTRICT_W;
const w = 4 + Math.random() * 12, top = 2 + Math.random() * 16;
const colors = ['rgba(255,213,128,0.4)', 'rgba(255,159,112,0.35)', 'rgba(159,225,255,0.3)'];
const c = colors[Math.floor(Math.random() * colors.length)];
html += `<div style="position:absolute; bottom:${top}px; left:${x}px; width:${w}px; height:0.8px; background:${c}; animation: city-shimmer 2.5s infinite ease-in-out; animation-delay:${(Math.random() * 3).toFixed(1)}s;"></div>`;
}
}
layerEl.innerHTML = html;
}

function buildClouds(layerEl) {
let svg = `<svg width="${TOTAL_W * 2}" height="200" viewBox="0 0 ${TOTAL_W * 2} 200" style="display:block;">`;
const n = 16;
for (let i = 0; i < n; i++) {
const x = (i / n) * TOTAL_W * 2 + Math.random() * 60;
const y = 30 + Math.random() * 110;
const sc = 0.6 + Math.random() * 0.7;
const op = 0.15 + Math.random() * 0.25;
svg += `<g transform="translate(${x},${y}) scale(${sc})" opacity="${op}"><ellipse cx="0" cy="0" rx="22" ry="6" fill="#fff"/><ellipse cx="-10" cy="-3" rx="10" ry="5" fill="#fff"/><ellipse cx="8" cy="-3" rx="12" ry="6" fill="#fff"/></g>`;
}
svg += '</svg>';
layerEl.innerHTML = svg; layerEl.style.width = (TOTAL_W * 2) + 'px'; layerEl._totalW = TOTAL_W;
}

function buildPowerLines(layerEl) {
let svg = `<svg width="${SCREEN_W}" height="50" viewBox="0 0 ${SCREEN_W} 50" style="display:block;">`;
svg += `<rect x="-2" y="0" width="3" height="50" fill="#0a0418"/>`;
svg += `<rect x="-6" y="6" width="11" height="1.5" fill="#0a0418"/>`;
svg += `<rect x="-6" y="14" width="11" height="1.5" fill="#0a0418"/>`;
svg += `<path d="M -5 7 Q ${SCREEN_W * 0.5} 18 ${SCREEN_W + 5} 11" stroke="#0a0418" stroke-width="0.8" fill="none" opacity="0.85"/>`;
svg += `<path d="M 4 7 Q ${SCREEN_W * 0.5} 20 ${SCREEN_W + 5} 13" stroke="#0a0418" stroke-width="0.8" fill="none" opacity="0.85"/>`;
svg += `<path d="M -5 15 Q ${SCREEN_W * 0.5} 27 ${SCREEN_W + 5} 19" stroke="#0a0418" stroke-width="0.8" fill="none" opacity="0.85"/>`;
svg += `<path d="M 4 15 Q ${SCREEN_W * 0.5} 29 ${SCREEN_W + 5} 21" stroke="#0a0418" stroke-width="0.8" fill="none" opacity="0.85"/>`;
svg += '</svg>';
layerEl.innerHTML = svg;
}

buildFarCity(layers.cityFar);
buildMidCity(layers.cityMid);
buildNearCity(layers.cityNear);
buildClouds(layers.clouds);
buildMountains(layers.mountains);
buildRiver(layers.river);
buildPowerLines(layers.powerlines);

// ––––– balloons –––––
const BALLOON_SVG_W = 68, BALLOON_SVG_H = 86;
const N_APPS = apps.length;
const BALLOON_ROWS = N_APPS <= 3 ? 1 : 2;
const BALLOON_COLS = Math.ceil(N_APPS / BALLOON_ROWS);
const CELL_W = SCREEN_W / BALLOON_COLS;
const FIT_SCALE = (CELL_W * 0.78) / BALLOON_SVG_W;
const BASE_SCALE = Math.max(1.1, Math.min(1.85, FIT_SCALE));
const SKY_TOP_PAD = Math.max(80, Math.floor(SCREEN_H * 0.12));
const SKY_BOT_PAD = NEAR_H + 30;
const SKY_H_AVAIL = Math.max(160, SCREEN_H - SKY_TOP_PAD - SKY_BOT_PAD);
const ROW_H = SKY_H_AVAIL / BALLOON_ROWS;

function blendToSky(hex, amount) {
const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
const sr = 184, sg = 85, sb = 117;
const nr = Math.round(r + (sr - r) * (1 - amount));
const ng = Math.round(g + (sg - g) * (1 - amount));
const nb = Math.round(b + (sb - b) * (1 - amount));
return `rgb(${nr},${ng},${nb})`;
}

function makeBalloon(app, idx, depth) {
const el = document.createElement('div');
const desat = depth < 0.85 ? 0.7 : 1;
const envColor = blendToSky(app.color || '#3B82F6', desat);
const envShade = blendToSky(app.shade || app.color || '#1E40AF', desat);

el.style.cssText = `position:absolute; cursor:pointer; transition:transform 0.18s cubic-bezier(.34,1.56,.64,1); will-change:transform; transform-origin: 34px 50px;`;

// Icon: image if provided, otherwise first letter of name
let iconContent;
if (app.iconUrl) {
  iconContent = `<foreignObject x="21" y="9" width="26" height="26"><div xmlns="http://www.w3.org/1999/xhtml" style="width:26px; height:26px; border-radius:50%; overflow:hidden; background:#fff;"><img src="${app.iconUrl}" alt="${app.name || ''}" style="width:100%; height:100%; object-fit:cover; display:block;" /></div></foreignObject>`;
} else {
  const letter = (app.name || '?').charAt(0).toUpperCase();
  iconContent = `<text x="34" y="27" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="14" font-weight="700" fill="${app.color || '#3B82F6'}">${letter}</text>`;
}

el.innerHTML = `
  <svg width="68" height="86" viewBox="0 0 68 86" style="overflow:visible;">
    <path d="M34 50 Q6 40 6 22 Q6 4 34 1 Q62 4 62 22 Q62 40 34 50 Z" fill="${envColor}"/>
    <path d="M22 4 Q17 12 17 22 Q17 35 22 46" fill="none" stroke="${envShade}" stroke-width="0.8" opacity="0.4"/>
    <path d="M46 4 Q51 12 51 22 Q51 35 46 46" fill="none" stroke="${envShade}" stroke-width="0.8" opacity="0.4"/>
    <path d="M14 8 Q9 14 9 22 Q9 32 14 42" fill="none" stroke="${envShade}" stroke-width="0.8" opacity="0.5"/>
    <path d="M54 8 Q59 14 59 22 Q59 32 54 42" fill="none" stroke="${envShade}" stroke-width="0.8" opacity="0.5"/>
    <circle cx="34" cy="22" r="13" fill="#fff"/>
    ${iconContent}
    <path d="M30 50 Q30 52 32 52 L36 52 Q38 52 38 50 Z" fill="${envShade}"/>
    <line x1="20" y1="51" x2="24" y2="64" stroke="#3a2818" stroke-width="0.8"/>
    <line x1="48" y1="51" x2="44" y2="64" stroke="#3a2818" stroke-width="0.8"/>
    <line x1="28" y1="52" x2="29" y2="64" stroke="#3a2818" stroke-width="0.8"/>
    <line x1="40" y1="52" x2="39" y2="64" stroke="#3a2818" stroke-width="0.8"/>
    <path d="M22 64 L46 64 L43 78 L25 78 Z" fill="#A0763E"/>
    <rect x="22" y="63" width="24" height="2.5" fill="#6B4A26" rx="0.5"/>
    <line x1="24" y1="67" x2="44" y2="67" stroke="#6B4A26" stroke-width="0.5" opacity="0.7"/>
    <line x1="25" y1="70" x2="43" y2="70" stroke="#6B4A26" stroke-width="0.5" opacity="0.7"/>
    <line x1="26" y1="73" x2="42" y2="73" stroke="#6B4A26" stroke-width="0.5" opacity="0.7"/>
    <line x1="28" y1="76" x2="40" y2="76" stroke="#6B4A26" stroke-width="0.5" opacity="0.7"/>
    <line x1="28" y1="64" x2="29" y2="78" stroke="#6B4A26" stroke-width="0.4" opacity="0.6"/>
    <line x1="34" y1="64" x2="34" y2="78" stroke="#6B4A26" stroke-width="0.4" opacity="0.6"/>
    <line x1="40" y1="64" x2="39" y2="78" stroke="#6B4A26" stroke-width="0.4" opacity="0.6"/>
  </svg>`;

el.addEventListener('click', (e) => {
  e.stopPropagation();
  const cur = el.style.transform;
  el.style.transform = cur.replace(/scale\([^)]+\)/, '') + ` scale(${depth * 1.18})`;
  setTimeout(() => { el.style.transform = el.style.transform.replace(/scale\([^)]+\)/, '') + ` scale(${depth})`; }, 220);
  setTimeout(() => onLaunch(app), 180);
});
return el;

}

const balloons = apps.map((app, i) => {
const row = Math.floor(i / BALLOON_COLS);
const col = i % BALLOON_COLS;
const stagger = (row % 2 === 1) ? CELL_W * 0.3 : 0;
let homeX = (col + 0.5) * CELL_W + stagger;
const homeY = SKY_TOP_PAD + (row + 0.5) * ROW_H;
const scale = BASE_SCALE * (0.94 + Math.random() * 0.12);
const b = makeBalloon(app, i, scale);
layers.balloons.appendChild(b);
// Drift amplitude: limited so balloons stay within their cell and never overlap
const halfCell = CELL_W / 2;
const halfBalloon = (BALLOON_SVG_W * scale) / 2;
const driftAmpX = Math.max(10, Math.min(50, halfCell - halfBalloon - 6));
const driftAmpY = Math.min(22, ROW_H * 0.18);
// Keep the balloon's full swept envelope (home + drift + sway + half-width)
// inside the viewport so it never clips out at the edges.
const swayMax = 10;
const edgePad = halfBalloon + driftAmpX + swayMax + 4;
homeX = Math.max(edgePad, Math.min(SCREEN_W - edgePad, homeX));
return {
el: b, scale, homeX, homeY, driftAmpX, driftAmpY,
x: homeX, y: homeY,
bobAmp: 4 + Math.random() * 3, bobPhase: Math.random() * Math.PI * 2, bobSpeed: 0.0009 + Math.random() * 0.0006,
swayAmp: 6 + Math.random() * 4, swayPhase: Math.random() * Math.PI * 2, swaySpeed: 0.00045 + Math.random() * 0.00025,
driftPhase: Math.random() * Math.PI * 2, driftSpeed: 0.00018 + Math.random() * 0.0001,
};
});

// ––––– ambient events –––––
let nearOffset = 0;
const active = {};
const currentDistrict = () => Math.floor((((-nearOffset + SCREEN_W / 2) % TOTAL_W) + TOTAL_W) % TOTAL_W / DISTRICT_W);

function plane() {
if (active.plane) return; active.plane = true;
const pl = document.createElement('div');
const dir = Math.random() > 0.5 ? 1 : -1;
const startX = dir > 0 ? -40 : SCREEN_W + 10;
const y = 120 + Math.random() * 60;
pl.style.cssText = `position:absolute; left:0; top:${y}px; transform:translateX(${startX}px) ${dir < 0 ? 'scaleX(-1)' : ''};`;
pl.innerHTML = `<svg width="36" height="12" viewBox="0 0 36 12"><path d="M2 6 L8 4 L26 4 L32 5 L34 6 L32 7 L26 8 L8 8 Z" fill="#1a0a2a" opacity="0.85"/><path d="M14 4 L18 0 L20 4 Z" fill="#1a0a2a" opacity="0.85"/><path d="M14 8 L18 12 L20 8 Z" fill="#1a0a2a" opacity="0.85"/><circle cx="6" cy="6" r="0.8" fill="#FF4040" class="city-blink"/><circle cx="30" cy="6" r="0.8" fill="#9FE1FF" class="city-blink"/></svg>`;
layers.skyEvents.appendChild(pl);
let px = startX;
(function tk() {
px += 0.4 * dir;
pl.style.transform = `translateX(${px}px) ${dir < 0 ? 'scaleX(-1)' : ''}`;
if ((dir > 0 && px > SCREEN_W + 40) || (dir < 0 && px < -40)) { pl.remove(); active.plane = false; return; }
requestAnimationFrame(tk);
})();
}

function shootingStar() {
if (active.star) return; active.star = true;
const startX = 40 + Math.random() * (SCREEN_W - 200);
const startY = 50 + Math.random() * 80;
const angle = 25 + Math.random() * 20;
const length = 80 + Math.random() * 60;
const endX = startX + length * Math.cos(angle * Math.PI / 180);
const endY = startY + length * Math.sin(angle * Math.PI / 180);
const star = document.createElement('div');
star.style.cssText = 'position:absolute; inset:0;';
star.innerHTML = `<svg width="${SCREEN_W}" height="${SCREEN_H}" viewBox="0 0 ${SCREEN_W} ${SCREEN_H}"><defs><linearGradient id="ct" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0.95"/></linearGradient></defs><line id="trk" x1="${startX}" y1="${startY}" x2="${startX}" y2="${startY}" stroke="url(#ct)" stroke-width="1.5" stroke-linecap="round"/><circle id="hd" cx="${startX}" cy="${startY}" r="1.5" fill="#fff"/></svg>`;
layers.skyEvents.appendChild(star);
let t = 0;
(function a() {
t += 0.04;
if (t > 1.3) { star.remove(); active.star = false; return; }
const p = Math.min(t, 1);
const cx = startX + (endX - startX) * p, cy = startY + (endY - startY) * p;
const ts = Math.max(0, p - 0.25);
const tx = startX + (endX - startX) * ts, ty = startY + (endY - startY) * ts;
const op = t > 1 ? Math.max(0, 1.3 - t) / 0.3 : 1;
const trk = star.querySelector('#trk'), hd = star.querySelector('#hd');
trk.setAttribute('x1', tx); trk.setAttribute('y1', ty); trk.setAttribute('x2', cx); trk.setAttribute('y2', cy); trk.setAttribute('opacity', op);
hd.setAttribute('cx', cx); hd.setAttribute('cy', cy); hd.setAttribute('opacity', op);
requestAnimationFrame(a);
})();
}

function owl() {
if (active.owl) return; active.owl = true;
const ow = document.createElement('div');
const dir = Math.random() > 0.5 ? 1 : -1;
const startX = dir > 0 ? -25 : SCREEN_W + 5;
const y = 280 + Math.random() * 50;
ow.style.cssText = `position:absolute; left:0; top:${y}px; transform:translateX(${startX}px) ${dir < 0 ? 'scaleX(-1)' : ''};`;
ow.innerHTML = `<svg width="22" height="10" viewBox="0 0 22 10"><ellipse cx="11" cy="6" rx="3" ry="2" fill="#0a0418"/><circle cx="14" cy="5" r="1.5" fill="#0a0418"/><polygon points="10,2 10.5,0.5 11.5,1.5" fill="#0a0418"/><polygon points="11.5,2 12,0.5 12.5,1.5" fill="#0a0418"/><path d="M2 4 Q5 1 8 4 Q9 5 8 6 Q5 5 2 6 Z" fill="#0a0418" id="ow-l"/><path d="M14 4 Q17 1 20 4 Q21 5 20 6 Q17 5 14 6 Z" fill="#0a0418" id="ow-r"/></svg>`;
layers.skyEvents.appendChild(ow);
let ox = startX, t = 0;
(function tk() {
ox += 0.5 * dir; t += 0.18;
const f = Math.sin(t) * 0.4;
ow.querySelector('#ow-l').setAttribute('transform', `translate(0, ${f})`);
ow.querySelector('#ow-r').setAttribute('transform', `translate(0, ${f})`);
ow.style.transform = `translateX(${ox}px) ${dir < 0 ? 'scaleX(-1)' : ''}`;
if ((dir > 0 && ox > SCREEN_W + 25) || (dir < 0 && ox < -25)) { ow.remove(); active.owl = false; return; }
requestAnimationFrame(tk);
})();
}

function satellite() {
if (active.sat) return; active.sat = true;
const s = document.createElement('div');
const y = 30 + Math.random() * 60;
const dir = Math.random() > 0.5 ? 1 : -1;
const sx0 = dir > 0 ? -10 : SCREEN_W + 10;
s.style.cssText = `position:absolute; left:0; top:${y}px; transform:translateX(${sx0}px);`;
s.innerHTML = `<div style="width:1.6px; height:1.6px; background:#fff; border-radius:50%; box-shadow:0 0 2px #fff; animation: city-blink 1.2s infinite;"></div>`;
layers.satellites.appendChild(s);
let sx = sx0;
(function tk() {
sx += 0.12 * dir;
s.style.transform = `translateX(${sx}px)`;
if ((dir > 0 && sx > SCREEN_W + 10) || (dir < 0 && sx < -10)) { s.remove(); active.sat = false; return; }
requestAnimationFrame(tk);
})();
}

function cat() {
if (active.cat) return; active.cat = true;
const c = document.createElement('div');
const cityX = 0 * DISTRICT_W + 30 + Math.random() * (DISTRICT_W - 60);
const rooftopY = 60 + Math.random() * 50;
const dir = Math.random() > 0.5 ? 1 : -1;
c.style.cssText = `position:absolute; left:${cityX}px; bottom:${rooftopY}px; transform:${dir < 0 ? 'scaleX(-1)' : ''};`;
c.innerHTML = `<svg width="14" height="8" viewBox="0 0 14 8"><ellipse cx="7" cy="5" rx="5" ry="2.2" fill="#0a0418"/><circle cx="11" cy="3.5" r="1.8" fill="#0a0418"/><polygon points="10,2 10.5,0.5 11.5,1.5" fill="#0a0418"/><polygon points="11.5,2 12,0.5 12.5,1.5" fill="#0a0418"/><path d="M2 5 Q-1 3 0 1" stroke="#0a0418" stroke-width="1.2" fill="none"/></svg>`;
layers.rooftopEvents.appendChild(c);
const t0 = performance.now(), dur = 4000, dist = 60 * dir;
(function tk(now) {
const p = (now - t0) / dur;
if (p > 1) { c.remove(); active.cat = false; return; }
c.style.left = (cityX + dist * p) + 'px';
requestAnimationFrame(tk);
})(performance.now());
}

function train() {
if (active.train) return; active.train = true;
const t = document.createElement('div');
const cityX = 2 * DISTRICT_W, dir = Math.random() > 0.5 ? 1 : -1;
const sx0 = dir > 0 ? cityX - 60 : cityX + DISTRICT_W + 60;
t.style.cssText = `position:absolute; left:${sx0}px; bottom:80px; transform:${dir < 0 ? 'scaleX(-1)' : ''};`;
t.innerHTML = `<svg width="56" height="10" viewBox="0 0 56 10"><rect x="0" y="2" width="14" height="6" rx="1" fill="#2a1545"/><rect x="15" y="2" width="12" height="6" rx="1" fill="#2a1545"/><rect x="28" y="2" width="12" height="6" rx="1" fill="#2a1545"/><rect x="41" y="2" width="12" height="6" rx="1" fill="#2a1545"/><rect x="2" y="3.5" width="3" height="2" fill="#FFD580"/><rect x="8" y="3.5" width="3" height="2" fill="#FFD580"/><rect x="17" y="3.5" width="2" height="2" fill="#FFD580"/><rect x="21" y="3.5" width="2" height="2" fill="#FFD580"/><rect x="30" y="3.5" width="2" height="2" fill="#FFD580"/><rect x="34" y="3.5" width="2" height="2" fill="#FFD580"/><rect x="43" y="3.5" width="2" height="2" fill="#FFD580"/><rect x="47" y="3.5" width="2" height="2" fill="#FFD580"/><circle cx="13" cy="5" r="1" fill="#FFE070"/></svg>`;
layers.rooftopEvents.appendChild(t);
let tx = sx0;
(function tk() {
tx += 1.2 * dir;
t.style.left = tx + 'px';
if ((dir > 0 && tx > cityX + DISTRICT_W + 60) || (dir < 0 && tx < cityX - 60)) { t.remove(); active.train = false; return; }
requestAnimationFrame(tk);
})();
}

function ferry() {
if (active.ferry) return; active.ferry = true;
const f = document.createElement('div');
const dir = Math.random() > 0.5 ? 1 : -1;
const cityX = 1 * DISTRICT_W;
const sx0 = dir > 0 ? cityX - 36 : cityX + DISTRICT_W + 10;
f.style.cssText = `position:absolute; left:${sx0}px; bottom:6px;`;
f.innerHTML = `<svg width="34" height="14" viewBox="0 0 34 14"><path d="M2 9 L32 9 L29 13 L5 13 Z" fill="#080419"/><rect x="6" y="3" width="22" height="6" fill="#080419"/><rect x="8" y="5" width="2" height="2" fill="#FFD580"/><rect x="12" y="5" width="2" height="2" fill="#FFD580"/><rect x="16" y="5" width="2" height="2" fill="#FFD580"/><rect x="20" y="5" width="2" height="2" fill="#FFD580"/><rect x="24" y="5" width="2" height="2" fill="#FFD580"/><rect x="14" y="0" width="2" height="3" fill="#080419"/><circle cx="15" cy="0.5" r="0.5" fill="#FF4040" class="city-blink"/></svg>`;
layers.waterEvents.appendChild(f);
let fx = sx0;
(function tk() {
fx += 0.18 * dir;
const wob = Math.sin(performance.now() * 0.003) * 0.6;
f.style.transform = `translateY(${wob}px) ${dir < 0 ? 'scaleX(-1)' : ''}`;
f.style.left = fx + 'px';
if ((dir > 0 && fx > cityX + DISTRICT_W + 36) || (dir < 0 && fx < cityX - 36)) { f.remove(); active.ferry = false; return; }
requestAnimationFrame(tk);
})();
}

function kite() {
if (active.kite) return; active.kite = true;
const cityX = 4 * DISTRICT_W + 100 + Math.random() * 200;
const baseY = 200 + Math.random() * 30;
const k = document.createElement('div');
k.style.cssText = `position:absolute; left:${cityX}px; bottom:${baseY}px;`;
k.innerHTML = `<svg width="20" height="80" viewBox="0 0 20 80" style="overflow:visible;"><line x1="10" y1="20" x2="10" y2="80" stroke="#0a0418" stroke-width="0.4" stroke-dasharray="2 1" opacity="0.5"/><polygon points="10,2 16,12 10,24 4,12" fill="#EF4444"/><polygon points="10,2 10,24 4,12" fill="#991B1B" opacity="0.4"/><line x1="10" y1="24" x2="8" y2="34" stroke="#FFD580" stroke-width="0.4"/><circle cx="8.5" cy="29" r="0.6" fill="#FFD580"/><circle cx="7.7" cy="33" r="0.6" fill="#FFD580"/><line x1="10" y1="24" x2="12" y2="36" stroke="#FFD580" stroke-width="0.4"/><circle cx="11" cy="31" r="0.6" fill="#FFD580"/></svg>`;
layers.rooftopEvents.appendChild(k);
let t = 0; const dur = 6;
(function tk() {
t += 0.016;
if (t > dur) { k.remove(); active.kite = false; return; }
const fade = t < 0.5 ? t / 0.5 : (t > dur - 0.5 ? (dur - t) / 0.5 : 1);
const dx = Math.sin(t * 1.5) * 8, dy = -Math.sin(t * 0.4) * 12;
k.style.opacity = fade;
k.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.sin(t * 1.5) * 8}deg)`;
requestAnimationFrame(tk);
})();
}

const eventCatalog = [
{ fn: shootingStar, districts: 'sky', weight: 2 },
{ fn: plane, districts: 'sky', weight: 3 },
{ fn: owl, districts: 'sky', weight: 1 },
{ fn: satellite, districts: 'sky', weight: 1 },
{ fn: cat, districts: [0], weight: 3 },
{ fn: ferry, districts: [1], weight: 4 },
{ fn: train, districts: [2], weight: 4 },
{ fn: kite, districts: [4], weight: 3 },
];

function scheduleEvent() {
const delay = 8000 + Math.random() * 12000;
setTimeout(() => {
const d = currentDistrict();
const pool = [];
eventCatalog.forEach(ev => {
if (ev.districts === 'sky' || ev.districts.includes(d)) {
for (let w = 0; w < ev.weight; w++) pool.push(ev.fn);
}
});
if (pool.length) pool[Math.floor(Math.random() * pool.length)]();
scheduleEvent();
}, delay);
}
setTimeout(scheduleEvent, 3000);
setTimeout(satellite, 4000);

// ––––– render loop –––––
let farOffset = 0, midOffset = 0, cloudOffset = 0, mountainOffset = 0;
let paused = false;
let lastT = performance.now();

function tick(now) {
const dt = Math.min(now - lastT, 50);
lastT = now;
if (!paused) {
farOffset -= dt * 0.012;
midOffset -= dt * 0.030;
nearOffset -= dt * 0.055;
cloudOffset -= dt * 0.012;
mountainOffset -= dt * 0.005;
if (farOffset <= -layers.cityFar._totalW) farOffset += layers.cityFar._totalW;
if (midOffset <= -layers.cityMid._totalW) midOffset += layers.cityMid._totalW;
if (nearOffset <= -layers.cityNear._totalW) nearOffset += layers.cityNear._totalW;
if (cloudOffset <= -layers.clouds._totalW) cloudOffset += layers.clouds._totalW;
if (mountainOffset <= -layers.mountains._totalW) mountainOffset += layers.mountains._totalW;
layers.cityFar.style.transform = `translateX(${farOffset.toFixed(1)}px)`;
layers.cityMid.style.transform = `translateX(${midOffset.toFixed(1)}px)`;
layers.cityNear.style.transform = `translateX(${nearOffset.toFixed(1)}px)`;
layers.clouds.style.transform = `translateX(${cloudOffset.toFixed(1)}px)`;
layers.mountains.style.transform = `translateX(${mountainOffset.toFixed(1)}px)`;
layers.river.style.transform = `translateX(${nearOffset.toFixed(1)}px)`;
layers.rooftopEvents.style.transform = `translateX(${nearOffset.toFixed(1)}px)`;
layers.waterEvents.style.transform = `translateX(${nearOffset.toFixed(1)}px)`;
balloons.forEach(b => {
const dx = Math.sin(now * b.driftSpeed + b.driftPhase) * b.driftAmpX;
const dy = Math.cos(now * b.driftSpeed + b.driftPhase) * b.driftAmpY;
const sway = Math.sin(now * b.swaySpeed + b.swayPhase) * b.swayAmp;
const bob = Math.sin(now * b.bobSpeed + b.bobPhase) * b.bobAmp;
// Translate such that the SVG's transform-origin (34, 50) — envelope bottom center —
// lands at the balloon's home + drift position.
const tx = (b.homeX + dx + sway) - 34;
const ty = (b.homeY + dy + bob) - 50;
b.el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${b.scale})`;
});
}
requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Pause when tab is hidden to save battery
document.addEventListener('visibilitychange', () => { paused = document.hidden; });

return {
pause: () => { paused = true; },
resume: () => { paused = false; },
destroy: () => { root.remove(); },
};
}