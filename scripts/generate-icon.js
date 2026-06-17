#!/usr/bin/env node
// Generate media/icon.png — a dark slate rounded square with a purple glow and
// the vLLM "V" monogram rendered in a purple gradient (matching the colorful
// sibling extensions). The monogram lives in media/vllm-logo.svg.
//
// Requires `rsvg-convert` (librsvg) and ImageMagick (`magick`) locally. The PNG
// is committed, so this only runs on a maintainer machine, not in CI.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const logo = path.join(root, 'media', 'vllm-logo.svg');
const out = path.join(root, 'media', 'icon.png');
const tmp = os.tmpdir();

// Pull both <path d="…"> segments from the logo (main V + the accent slash).
const ds = [...fs.readFileSync(logo, 'utf8').matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
const mainD = ds[0];
const accentD = ds[1] ?? '';

const gradSvg = path.join(tmp, 'vllm-grad.svg');
fs.writeFileSync(
  gradSvg,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="600" height="600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c4b1ff"/>
      <stop offset="50%" stop-color="#8b6cff"/>
      <stop offset="100%" stop-color="#6a45e6"/>
    </linearGradient>
  </defs>
  <path fill="url(#g)" d="${mainD}"/>
  ${accentD ? `<path fill="url(#g)" opacity="0.55" d="${accentD}"/>` : ''}
</svg>`,
);

const sh = (c) => execSync(c, { stdio: 'inherit' });
sh(`rsvg-convert -w 600 -h 600 "${gradSvg}" -o "${tmp}/vllm-grad.png"`);

// Dark rounded-square base with a purple radial glow behind the monogram.
sh(`magick -size 256x256 xc:none -fill '#191e29' -draw "roundrectangle 8,8,247,247,46,46" "${tmp}/base.png"`);
sh(`magick -size 256x256 radial-gradient:'#4733a6'-'#00000000' "${tmp}/glow.png"`);
sh(`magick "${tmp}/glow.png" "${tmp}/base.png" -compose DstIn -composite "${tmp}/glowc.png"`);

// Compose: base → purple glow → gradient monogram.
sh(
  `magick "${tmp}/base.png" ` +
    `"${tmp}/glowc.png" -compose over -composite ` +
    `\\( "${tmp}/vllm-grad.png" -resize 165x165 \\) -gravity center -compose over -composite ` +
    `"${out}"`,
);
console.log('wrote', out);
