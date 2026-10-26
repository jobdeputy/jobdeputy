// AI Boost (round 9): the Dashboard's detailed panda deputy, in a floating corner bubble.
//
// The owner asked on October 25, 2026 for "a realistic panda as AI Boost on the right side of the
// Dashboard, not in one small section" (round 8: a large right-hand panel). On October 26, 2026
// the owner asked for it back as a small floating bubble, bottom-right, like a typical "talk to
// us" chat widget — this round. The same detailed SVG (natural proportions, soft fur shading,
// tufted fur edges, built here so it needs no image file) now draws into that bubble; only
// ai-boost.css's layout changed; the state machine below is unchanged from round 8:
//
// - deputy.js stays the only source of state. Every pose the bubble shows arrives here as the
//   jobdeputy:deputy event (page states, moments, reactions, and the tour), so it never invents
//   work: it thinks only while work is pending, munches only while a run is live, and celebrates
//   only when deputy.js reacts to a finished action.
// - The bubble is on screen for the page's whole life, so the dock steps out for good
//   (JobDeputyDeputy.lend), keeping one panda per viewport; during a tour the bubble steps out
//   too, because the tour card has the panda.
// - Motion: named states on [data-boost-state] (idle, curious, thinking, processing, success,
//   celebrate, done, error, hello, away) and one-time motion on [data-boost-play]. Blinks and one
//   small idle gesture run from timers that stop while paused (html[data-motion="paused"]), under
//   reduced motion, in a hidden tab, and while the bubble is out of view.
// - The panda is a button that opens the dock's Activity; hover, keyboard focus, and a tap show
//   the curious pose, and reveal its words as a tooltip (CSS, not a live region: the page
//   announces its own events).
//
// Without this script (or if it fails), the dock keeps its panda and the bubble shows no art.

(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BLINK_MS = 180;
  const BLINK_MIN = 5236;
  const BLINK_MAX = 8472;
  const GESTURE_MIN = 13000;
  const GESTURE_MAX = 21000;
  const TAP_CURIOUS_MS = 1618;
  const GESTURES = { tilt: 1618, ear: 987, look: 1618, nibble: 1618 };

  // ------------------------------------------------------------------ drawing

  // A seeded generator keeps every tuft in the same place on every load.
  const seeded = (seed) => {
    let value = seed % 2147483647 || 1;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  };

  const round = (n) => Math.round(n * 10) / 10;

  // A closed Catmull-Rom curve through `points`, sampled `count` times.
  const sampleClosed = (points, count) => {
    const out = [];
    const n = points.length;
    for (let index = 0; index < count; index += 1) {
      const t = (index / count) * n;
      const i = Math.floor(t);
      const u = t - i;
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i % n];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      const u2 = u * u;
      const u3 = u2 * u;
      const at = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push([at(p0[0], p1[0], p2[0], p3[0]), at(p0[1], p1[1], p2[1], p3[1])]);
    }
    return out;
  };

  // A soft-edged fur outline: the smooth shape through `points`, with a small tuft between every
  // two samples, pushed outward along the curve's normal. amp 0 gives a smooth path.
  const furPath = (points, { tufts = 48, amp = 3, seed = 1 } = {}) => {
    const random = seeded(seed);
    const base = sampleClosed(points, tufts);
    const fine = sampleClosed(points, tufts * 2);
    let cx = 0;
    let cy = 0;
    for (const [x, y] of base) {
      cx += x;
      cy += y;
    }
    cx /= base.length;
    cy /= base.length;
    const parts = [`M${round(base[0][0])} ${round(base[0][1])}`];
    for (let index = 0; index < base.length; index += 1) {
      const next = base[(index + 1) % base.length];
      const mid = fine[(index * 2 + 1) % fine.length];
      const dx = mid[0] - cx;
      const dy = mid[1] - cy;
      const length = Math.hypot(dx, dy) || 1;
      const push = amp * (0.55 + random() * 0.9);
      const skew = (random() - 0.5) * amp * 0.9;
      const tipX = mid[0] + (dx / length) * push - (dy / length) * skew;
      const tipY = mid[1] + (dy / length) * push + (dx / length) * skew;
      parts.push(`Q${round(tipX)} ${round(tipY)} ${round(next[0])} ${round(next[1])}`);
    }
    return `${parts.join('')}Z`;
  };

  // Points on an ellipse, optionally rotated (degrees) and squashed per side for organic shapes.
  const ellipse = (cx, cy, rx, ry, { steps = 12, rotate = 0, shape = () => 1 } = {}) => {
    const r = (rotate * Math.PI) / 180;
    const points = [];
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2;
      const k = shape(a);
      const x = Math.cos(a) * rx * k;
      const y = Math.sin(a) * ry * k;
      points.push([cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]);
    }
    return points;
  };

  const fur = (points, fill, options = {}) =>
    `<path d="${furPath(points, options)}" fill="${fill}"${options.extra ?? ''}/>`;

  // Colours belong to the drawing (like deputy.css's art), from the page's palette: ink black,
  // paper whites, bamboo green, and a warm shadow.
  const defs = `
    <defs>
      <radialGradient id="boost-fur-white" cx="0.42" cy="0.32" r="0.78">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.55" stop-color="#f7f4ed"/>
        <stop offset="1" stop-color="#ddd6c7"/>
      </radialGradient>
      <radialGradient id="boost-fur-face" cx="0.46" cy="0.4" r="0.7">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="0.6" stop-color="#f6f2ea"/>
        <stop offset="1" stop-color="#e2dbcd"/>
      </radialGradient>
      <radialGradient id="boost-fur-black" cx="0.38" cy="0.28" r="0.85">
        <stop offset="0" stop-color="#3b3834"/>
        <stop offset="0.55" stop-color="#211f1c"/>
        <stop offset="1" stop-color="#121110"/>
      </radialGradient>
      <radialGradient id="boost-patch" cx="0.45" cy="0.35" r="0.75">
        <stop offset="0" stop-color="#2c2926"/>
        <stop offset="1" stop-color="#141311"/>
      </radialGradient>
      <radialGradient id="boost-muzzle" cx="0.5" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#fffdf8"/>
        <stop offset="1" stop-color="#e9e2d3"/>
      </radialGradient>
      <radialGradient id="boost-eye" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#4a3a2c"/>
        <stop offset="1" stop-color="#0d0b0a"/>
      </radialGradient>
      <radialGradient id="boost-nose" cx="0.4" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#55504b"/>
        <stop offset="1" stop-color="#141312"/>
      </radialGradient>
      <radialGradient id="boost-pad" cx="0.45" cy="0.35" r="0.75">
        <stop offset="0" stop-color="#6e655d"/>
        <stop offset="1" stop-color="#3a3430"/>
      </radialGradient>
      <radialGradient id="boost-shadow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#372f24" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#372f24" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="boost-bamboo" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#23795b"/>
        <stop offset="0.45" stop-color="#3fb487"/>
        <stop offset="1" stop-color="#23795b"/>
      </linearGradient>
      <linearGradient id="boost-leaf" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#5cc79a"/>
        <stop offset="1" stop-color="#23795b"/>
      </linearGradient>
      <radialGradient id="boost-sheen" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.65"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="boost-ao" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#1c1712" stop-opacity="0.32"/>
        <stop offset="1" stop-color="#1c1712" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="boost-gloss" cx="0.32" cy="0.26" r="0.6">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>`;

  // A few hair strokes give the white fur its direction.
  const strokes = (lines, colour, width = 1.1, opacity = 0.5) =>
    `<g fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}">${lines
      .map((d) => `<path d="${d}"/>`)
      .join('')}</g>`;

  const leaf = (x, y, angle, length = 22, width = 7) =>
    `<path transform="translate(${x} ${y}) rotate(${angle})" d="M0 0 Q${length * 0.45} ${-width} ${length} 0 Q${length * 0.45} ${width} 0 0Z" fill="url(#boost-leaf)"/>`;

  const bambooStalk = () => {
    // A stalk from the left foot up past the shoulder, with nodes and a leafy top.
    const nodes = [
      [70, 302],
      [62, 254],
      [53, 206],
      [44, 158],
      [36, 112],
    ];
    const segments = [];
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const [x1, y1] = nodes[index];
      const [x2, y2] = nodes[index + 1];
      segments.push(
        `<path d="M${x1 - 5.5} ${y1} L${x2 - 5} ${y2 + 2} L${x2 + 5} ${y2 + 2} L${x1 + 5.5} ${y1}Z" fill="url(#boost-bamboo)"/>`,
        `<rect x="${x2 - 6.5}" y="${y2 - 1}" width="13" height="4.5" rx="2.2" fill="#1f6b50" transform="rotate(9 ${x2} ${y2})"/>`,
      );
    }
    return `<g class="boost-bamboo">
      ${segments.join('')}
      ${leaf(36, 114, -104, 32, 8)}
      ${leaf(36, 114, -62, 28, 7)}
      ${leaf(36, 116, -148, 26, 6)}
      ${leaf(45, 160, -168, 24, 6)}
      ${leaf(52, 206, -14, 22, 6)}
    </g>`;
  };

  const toes = (cx, cy, flip = 1) =>
    [
      [-15, -14, 5.4],
      [-5, -19, 5.6],
      [6, -19, 5.6],
      [16, -14, 5.4],
    ]
      .map(([dx, dy, r]) => `<ellipse cx="${cx + dx * flip}" cy="${cy + dy}" rx="${r}" ry="${r * 0.9}" fill="url(#boost-pad)"/>`)
      .join('');

  const pandaSvg = () => {
    const head = ellipse(150, 118, 84, 72, {
      steps: 16,
      // Fuller cheeks, a slightly flatter crown.
      shape: (a) => 1 + 0.07 * Math.sin(a) ** 2 * (Math.sin(a) > 0 ? 1 : -0.6),
    });
    const torso = ellipse(150, 238, 80, 76, { steps: 14, shape: (a) => 1 + 0.05 * Math.sin(a) });
    const shoulders = [
      [70, 214],
      [84, 186],
      [118, 172],
      [150, 170],
      [182, 172],
      [216, 186],
      [230, 214],
      [208, 222],
      [150, 210],
      [92, 222],
    ];
    const armLeft = [
      [70, 196],
      [96, 190],
      [114, 222],
      [120, 252],
      [104, 266],
      [86, 258],
      [74, 228],
    ];
    const armRight = [
      [204, 190],
      [230, 196],
      [226, 228],
      [214, 258],
      [196, 266],
      [180, 252],
      [186, 222],
    ];
    return `<svg class="boost-svg" viewBox="-14 -26 328 372" xmlns="${SVG_NS}" aria-hidden="true" focusable="false">
      ${defs}
      <ellipse class="boost-shadow" cx="150" cy="316" rx="104" ry="14" fill="url(#boost-shadow)"/>
      <g class="boost-sparkles" aria-hidden="true">
        <path class="boost-spark boost-spark-1" d="M42 74l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#2f9e77"/>
        <path class="boost-spark boost-spark-2" d="M262 92l2.4 6.4 6.4 2.4-6.4 2.4-2.4 6.4-2.4-6.4-6.4-2.4 6.4-2.4z" fill="#f36b3f"/>
        <path class="boost-spark boost-spark-3" d="M244 30l2 5.2 5.2 2-5.2 2-2 5.2-2-5.2-5.2-2 5.2-2z" fill="#2f9e77"/>
        <path class="boost-spark boost-spark-4" d="M58 26l1.8 4.6 4.6 1.8-4.6 1.8-1.8 4.6-1.8-4.6-4.6-1.8 4.6-1.8z" fill="#526fe5"/>
      </g>
      <g class="boost-panda">
        <g class="boost-body">
          ${fur(torso, 'url(#boost-fur-white)', { tufts: 54, amp: 2.6, seed: 11 })}
          <ellipse cx="150" cy="268" rx="52" ry="40" fill="url(#boost-ao)" opacity="0.4"/>
          ${strokes(
            [
              'M126 236q-4 10-2 22',
              'M150 244q0 10 1 20',
              'M174 236q4 10 2 22',
              'M138 274q2 6 6 10',
              'M162 274q-2 6-6 10',
              'M118 254q-3 9 0 18',
              'M182 254q3 9 0 18',
              'M132 290q4 6 10 8',
              'M168 290q-4 6-10 8',
            ],
            '#cfc6b4',
          )}
          <ellipse cx="120" cy="204" rx="40" ry="24" fill="url(#boost-sheen)" opacity="0.5"/>
          ${fur(shoulders, 'url(#boost-fur-black)', { tufts: 40, amp: 2.4, seed: 13 })}
          <ellipse cx="128" cy="188" rx="30" ry="12" fill="url(#boost-gloss)"/>
          <g class="boost-legs">
            <ellipse cx="150" cy="286" rx="34" ry="11" fill="url(#boost-ao)" opacity="0.5"/>
            ${fur(ellipse(98, 292, 46, 31, { steps: 12, rotate: -8 }), 'url(#boost-fur-black)', { tufts: 34, amp: 2.4, seed: 17 })}
            ${fur(ellipse(202, 292, 46, 31, { steps: 12, rotate: 8 }), 'url(#boost-fur-black)', { tufts: 34, amp: 2.4, seed: 19 })}
            <ellipse cx="88" cy="282" rx="18" ry="8" fill="url(#boost-gloss)" transform="rotate(-8 88 282)"/>
            <ellipse cx="212" cy="282" rx="18" ry="8" fill="url(#boost-gloss)" transform="rotate(8 212 282)"/>
            <ellipse cx="92" cy="300" rx="19" ry="14" fill="url(#boost-pad)" transform="rotate(-8 92 300)"/>
            ${toes(92, 300, 1)}
            <ellipse cx="208" cy="300" rx="19" ry="14" fill="url(#boost-pad)" transform="rotate(8 208 300)"/>
            ${toes(208, 300, -1)}
          </g>
        </g>
        <g class="boost-arm boost-arm-left">
          ${bambooStalk()}
          ${fur(armLeft, 'url(#boost-fur-black)', { tufts: 28, amp: 2.2, seed: 23 })}
          <ellipse cx="88" cy="214" rx="14" ry="9" fill="url(#boost-gloss)"/>
          <ellipse cx="102" cy="254" rx="12" ry="9" fill="#2a2724" opacity="0.6"/>
        </g>
        <g class="boost-head">
          <ellipse cx="150" cy="186" rx="44" ry="14" fill="url(#boost-ao)" opacity="0.38"/>
          <g class="boost-ear boost-ear-left">
            ${fur(ellipse(90, 60, 27, 25, { steps: 10 }), 'url(#boost-fur-black)', { tufts: 26, amp: 2, seed: 29 })}
            <ellipse cx="92" cy="63" rx="13" ry="11" fill="#34312d"/>
            <ellipse cx="82" cy="52" rx="10" ry="6" fill="url(#boost-gloss)"/>
          </g>
          <g class="boost-ear boost-ear-right">
            ${fur(ellipse(210, 60, 27, 25, { steps: 10 }), 'url(#boost-fur-black)', { tufts: 26, amp: 2, seed: 31 })}
            <ellipse cx="208" cy="63" rx="13" ry="11" fill="#34312d"/>
            <ellipse cx="200" cy="52" rx="9" ry="5" fill="url(#boost-gloss)"/>
          </g>
          <ellipse cx="96" cy="78" rx="18" ry="12" fill="url(#boost-ao)" opacity="0.3"/>
          <ellipse cx="204" cy="78" rx="18" ry="12" fill="url(#boost-ao)" opacity="0.3"/>
          ${fur(head, 'url(#boost-fur-face)', { tufts: 60, amp: 2.6, seed: 37 })}
          ${strokes(
            [
              'M128 58q6-6 12-8',
              'M150 52v-8',
              'M160 52q6-4 12-2',
              'M84 150q-6 6-8 14',
              'M216 150q6 6 8 14',
              'M96 96q-6 4-9 10',
              'M204 96q6 4 9 10',
              'M120 172q6 4 12 5',
              'M180 172q-6 4-12 5',
            ],
            '#d6cebe',
            1.1,
            0.6,
          )}
          <ellipse cx="120" cy="90" rx="34" ry="22" fill="url(#boost-sheen)" opacity="0.55"/>
          <g class="boost-patches">
            ${fur(ellipse(114, 120, 21, 30, { steps: 12, rotate: 32, shape: (a) => 1 + 0.18 * Math.max(0, Math.sin(a)) }), 'url(#boost-patch)', { tufts: 30, amp: 1.3, seed: 41 })}
            ${fur(ellipse(186, 120, 21, 30, { steps: 12, rotate: -32, shape: (a) => 1 + 0.18 * Math.max(0, Math.sin(a)) }), 'url(#boost-patch)', { tufts: 30, amp: 1.3, seed: 43 })}
            <ellipse cx="108" cy="110" rx="10" ry="8" fill="url(#boost-gloss)"/>
            <ellipse cx="192" cy="110" rx="10" ry="8" fill="url(#boost-gloss)"/>
          </g>
          <g class="boost-eye boost-eye-left">
            <g class="boost-eye-open">
              <ellipse cx="117" cy="114" rx="8.2" ry="8.8" fill="url(#boost-eye)"/>
              <g class="boost-pupil"><circle cx="114.6" cy="110.8" r="2.7" fill="#fff"/><circle cx="119.6" cy="117.6" r="1.1" fill="#fff" opacity="0.7"/></g>
            </g>
            <path class="boost-eye-happy" d="M108 116q9-11 18 0" fill="none" stroke="#f6f2ea" stroke-width="3.2" stroke-linecap="round"/>
            <path class="boost-eye-lid" d="M106 101H128V105.5Q117 106 106 114Z" fill="#161513"/>
          </g>
          <g class="boost-eye boost-eye-right">
            <g class="boost-eye-open">
              <ellipse cx="183" cy="114" rx="8.2" ry="8.8" fill="url(#boost-eye)"/>
              <g class="boost-pupil"><circle cx="180.6" cy="110.8" r="2.7" fill="#fff"/><circle cx="185.6" cy="117.6" r="1.1" fill="#fff" opacity="0.7"/></g>
            </g>
            <path class="boost-eye-happy" d="M174 116q9-11 18 0" fill="none" stroke="#f6f2ea" stroke-width="3.2" stroke-linecap="round"/>
            <path class="boost-eye-lid" d="M172 101H194V114Q183 106 172 105.5Z" fill="#161513"/>
          </g>
          ${fur(ellipse(150, 152, 33, 24, { steps: 12 }), 'url(#boost-muzzle)', { tufts: 34, amp: 1.2, seed: 47 })}
          <ellipse cx="150" cy="166" rx="24" ry="8" fill="url(#boost-ao)" opacity="0.22"/>
          <path class="boost-nose" d="M137 138q13-7 26 0q-1 10-13 14q-12-4-13-14z" fill="url(#boost-nose)"/>
          <ellipse cx="146" cy="139" rx="4" ry="1.8" fill="#fff" opacity="0.35"/>
          <ellipse cx="140" cy="146" rx="9" ry="5" fill="url(#boost-sheen)" opacity="0.4"/>
          <g class="boost-mouth">
            <path class="boost-mouth-rest" d="M150 152v5M140 158q5 6 10 0q5 6 10 0" fill="none" stroke="#1b1a18" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            <g class="boost-mouth-open">
              <path d="M150 152v4" stroke="#1b1a18" stroke-width="2.2" stroke-linecap="round"/>
              <path d="M140 157q10 3 20 0q-2 11-10 11q-8 0-10-11z" fill="#3a1f1a"/>
              <path d="M144 163q6 6 12 0q-2 5-6 5q-4 0-6-5z" fill="#e88a7c"/>
            </g>
            <g class="boost-leaf-bite">${leaf(152, 160, 18, 24, 6)}</g>
          </g>
          <ellipse class="boost-blush" cx="104" cy="150" rx="11" ry="6" fill="#f3a090" opacity="0.18"/>
          <ellipse class="boost-blush" cx="196" cy="150" rx="11" ry="6" fill="#f3a090" opacity="0.18"/>
        </g>
        <g class="boost-arm boost-arm-right">
          ${fur(armRight, 'url(#boost-fur-black)', { tufts: 28, amp: 2.2, seed: 53 })}
          <ellipse cx="212" cy="214" rx="14" ry="9" fill="url(#boost-gloss)"/>
          <ellipse cx="198" cy="254" rx="12" ry="9" fill="#2a2724" opacity="0.6"/>
        </g>
      </g>
      <g class="boost-thought" aria-hidden="true">
        <circle cx="232" cy="68" r="4" fill="#fff" stroke="#1b1a18" stroke-opacity="0.14"/>
        <circle cx="244" cy="50" r="6.5" fill="#fff" stroke="#1b1a18" stroke-opacity="0.14"/>
        <ellipse cx="268" cy="24" rx="26" ry="17" fill="#fff" stroke="#1b1a18" stroke-opacity="0.14"/>
        <circle class="boost-dot boost-dot-1" cx="257" cy="24" r="3" fill="#1b1a18"/>
        <circle class="boost-dot boost-dot-2" cx="268" cy="24" r="3" fill="#1b1a18"/>
        <circle class="boost-dot boost-dot-3" cx="279" cy="24" r="3" fill="#1b1a18"/>
      </g>
    </svg>`;
  };

  // ------------------------------------------------------------------ state

  // The dock's pose → the panel's named state. Work loops only while deputy.js says work runs.
  const MOMENTS = {
    arrive: 'hello',
    notice: 'curious',
    pending: 'thinking',
    started: 'thinking',
    success: 'success',
    found: 'success',
    approved: 'success',
    submitted: 'success',
    celebrate: 'celebrate',
    signed: 'celebrate',
    added: 'done',
    saved: 'done',
    sent: 'done',
    copied: 'done',
    archived: 'done',
    deleted: 'done',
    dismissed: 'done',
    error: 'error',
  };

  // A little more personality where the deputy says its default line; a page's own line (with
  // its facts) always shows as written. Each stays first person and at most six words.
  const LINES = {
    pending: 'On it. Thinking cap on.',
    search: 'Munching through your sources now.',
    success: 'All set. Bamboo break earned.',
  };

  const stateFor = (detail, live) => {
    if (!detail) {
      return 'idle';
    }
    if (detail.guided) {
      return 'away';
    }
    if (MOMENTS[detail.state]) {
      return MOMENTS[detail.state];
    }
    return detail.working || live ? 'processing' : 'idle';
  };

  // A search that is really running in the sample world (JobDeputyStore.activity().now). The
  // Dashboard's deputy rests in report while it runs; AI Boost shows the work itself.
  const liveRuns = () => {
    try {
      const now = window.JobDeputyStore?.activity?.()?.now;
      return Array.isArray(now) ? now.length : 0;
    } catch {
      return 0;
    }
  };

  const lineFor = (detail) => {
    const deputy = window.JobDeputyDeputy;
    const fallback = deputy?.defaults?.[detail.state]?.speech;
    const playful = LINES[detail.state];
    if (playful && (!detail.speech || detail.speech === fallback)) {
      return playful;
    }
    return detail.speech || fallback || '';
  };

  const pick = (min, max) => min + Math.random() * (max - min);

  const start = () => {
    const panel = document.querySelector('[data-boost]');
    const dock = document.querySelector('#deputy-dock');
    const deputy = window.JobDeputyDeputy;
    if (!panel || !deputy || typeof deputy.lend !== 'function') {
      return;
    }
    const art = panel.querySelector('[data-boost-art]');
    const stage = panel.querySelector('[data-boost-stage]');
    const speech = panel.querySelector('[data-boost-speech]');
    const duty = panel.querySelector('[data-boost-duty]');
    if (!art || !stage || !speech || !duty) {
      return;
    }

    const root = document.documentElement;
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timers = {};
    let base = 'idle';
    let shownKey = '';
    let hovered = false;
    let focused = false;
    let tapUntil = 0;
    let inView = true;

    const clear = (name) => {
      window.clearTimeout(timers[name]);
      delete timers[name];
    };
    const moving = () => root.dataset.motion !== 'paused' && !reducedQuery.matches && !document.hidden && inView;

    // One-time motion restarts with a style flush between removing and adding the attribute.
    const play = () => {
      panel.removeAttribute('data-boost-play');
      if (!moving()) {
        return;
      }
      void panel.getBoundingClientRect();
      panel.setAttribute('data-boost-play', '');
    };

    const curiousNow = () => base === 'idle' && (hovered || focused || Date.now() < tapUntil);

    const render = () => {
      const state = curiousNow() ? 'curious' : base;
      if (panel.dataset.boostState !== state) {
        panel.dataset.boostState = state;
        if (state !== 'curious' && state !== 'idle') {
          play();
        } else {
          panel.removeAttribute('data-boost-play');
        }
      }
      panel.toggleAttribute('data-boost-working', state === 'processing' || state === 'thinking');
      // Busy, it still notices you: the ears perk while the pointer or focus is on it.
      panel.toggleAttribute('data-boost-hover', hovered || focused || Date.now() < tapUntil);
    };

    // ---------------------------------------------------------------- blink and idle gesture

    const scheduleBlink = (wait = pick(BLINK_MIN, BLINK_MAX)) => {
      clear('blink');
      timers.blink = window.setTimeout(() => {
        if (moving() && !['celebrate', 'success', 'done', 'away'].includes(panel.dataset.boostState)) {
          panel.setAttribute('data-boost-blink', '');
          timers.blinkEnd = window.setTimeout(() => panel.removeAttribute('data-boost-blink'), BLINK_MS);
        }
        scheduleBlink();
      }, wait);
    };

    const scheduleGesture = (wait = pick(GESTURE_MIN, GESTURE_MAX)) => {
      clear('gesture');
      timers.gesture = window.setTimeout(() => {
        if (moving() && panel.dataset.boostState === 'idle') {
          const names = Object.keys(GESTURES);
          const name = names[Math.floor(Math.random() * names.length)];
          panel.dataset.boostGesture = name;
          timers.gestureEnd = window.setTimeout(() => panel.removeAttribute('data-boost-gesture'), GESTURES[name]);
        }
        scheduleGesture();
      }, wait);
    };

    const stopTimers = () => {
      for (const name of Object.keys(timers)) {
        clear(name);
      }
      panel.removeAttribute('data-boost-blink');
      panel.removeAttribute('data-boost-gesture');
    };

    const resume = () => {
      if (moving()) {
        if (timers.blink === undefined) {
          scheduleBlink(pick(1618, BLINK_MIN));
        }
        if (timers.gesture === undefined) {
          scheduleGesture(pick(GESTURE_MIN, 17000));
        }
      } else {
        stopTimers();
      }
      panel.toggleAttribute('data-boost-still', !moving());
    };

    // ---------------------------------------------------------------- following the deputy

    let lastDetail = null;
    let live = liveRuns();
    const follow = (detail) => {
      lastDetail = detail;
      const next = stateFor(detail, live);
      // Shown only because a search runs while the dock reports: its own words.
      const fromStore = next === 'processing' && !detail.working;
      // A repeat of the same pose (a copy rewrite) neither replays motion nor restarts timers;
      // a new pose does, so a celebration plays once per finished action.
      const key = `${detail?.state}|${detail?.working}|${detail?.guided}|${fromStore}`;
      base = next;
      if (key !== shownKey) {
        shownKey = key;
        panel.removeAttribute('data-boost-state');
      }
      if (fromStore) {
        speech.textContent = LINES.search;
      } else if (next !== 'away') {
        const said = lineFor(detail);
        if (speech.textContent !== said) {
          speech.textContent = said;
        }
      } else {
        speech.textContent = 'I’m in the tour card.';
      }
      const shownDuty = detail.guided ? 'Showing you around' : fromStore ? 'Searching' : detail.duty;
      if (duty.textContent !== shownDuty) {
        duty.textContent = shownDuty;
      }
      render();
    };

    document.addEventListener('jobdeputy:deputy', (event) => {
      if (dock && event.target !== dock) {
        return;
      }
      follow(event.detail);
    });

    // The dock has already started when this runs late: take its current pose.
    const current = dock ? deputy.get(dock) : null;
    if (current) {
      follow({
        state: current.state,
        working: current.working,
        guided: Boolean(deputy.guiding),
        duty: dock.querySelector('[data-deputy-duty]')?.textContent ?? '',
        speech: deputy.defaults?.[current.state]?.speech ?? '',
      });
    }

    // A search starting or finishing changes the panel at once; ticks of a running search do
    // not (they only move its counters).
    window.JobDeputyStore?.subscribe?.((_state, change) => {
      if (change?.progress) {
        return;
      }
      const next = liveRuns();
      if (next !== live) {
        live = next;
        if (lastDetail) {
          follow(lastDetail);
        }
      }
    });

    // ---------------------------------------------------------------- interaction

    stage.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') {
        hovered = true;
        render();
      }
    });
    stage.addEventListener('pointerleave', () => {
      hovered = false;
      render();
    });
    stage.addEventListener('focus', () => {
      focused = stage.matches(':focus-visible');
      render();
    });
    stage.addEventListener('blur', () => {
      focused = false;
      render();
    });
    stage.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'mouse') {
        tapUntil = Date.now() + TAP_CURIOUS_MS;
        render();
        clear('tap');
        timers.tap = window.setTimeout(render, TAP_CURIOUS_MS + 20);
      }
    });
    // The panda opens the dock's Activity: what your deputy is doing, what needs you, and what
    // it finished. Its summary takes focus, so Escape and Tab work from there. The dock's own
    // outside-click handler (document, deputy.js) would otherwise read this same click as
    // outside the panel (the button lives in the AI Boost panel, not the dock) and close what it
    // just opened, so the click stops here instead of reaching document.
    stage.addEventListener('click', (event) => {
      const activity = dock?.querySelector('details.deputy-activity');
      const summary = activity?.querySelector('summary');
      if (!activity || !summary) {
        return;
      }
      event.stopPropagation();
      if (!activity.open) {
        summary.click();
      }
      summary.focus({ preventScroll: true });
    });

    // ---------------------------------------------------------------- where it shows

    // The bubble is fixed to the corner at every width, so the dock lends its panda once, here,
    // for the page's whole life (never unlent, since the bubble never goes away).
    deputy.lend({ speech: 'I’m in AI Boost.' });
    reducedQuery.addEventListener('change', resume);
    document.addEventListener('visibilitychange', resume);
    new MutationObserver(resume).observe(root, { attributes: true, attributeFilter: ['data-motion'] });
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver((entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        resume();
      }).observe(panel);
    }
    resume();
    // The drawing goes in its own task after the first paint: its box is already sized (the
    // stage's aspect ratio), so nothing moves, and the page's boot task stays as it was.
    window.setTimeout(() => {
      try {
        art.innerHTML = pandaSvg();
        panel.setAttribute('data-boost-ready', '');
      } catch {
        deputy.unlend();
      }
    }, 0);
  };

  // For tests and the cast sheet: how a deputy event maps to the panel's state.
  window.JobDeputyBoost = Object.freeze({
    states: Object.freeze(['idle', 'curious', 'thinking', 'processing', 'success', 'celebrate', 'done', 'error', 'hello', 'away']),
    stateFor,
    lineFor,
  });

  try {
    start();
  } catch {
    // The dock keeps its panda when the panel cannot start.
    window.JobDeputyDeputy?.unlend?.();
  }
})();
