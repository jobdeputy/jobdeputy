/**
 * The deputy: the brand panda from the round 7 prototype, in the "Set it up" pose (pencil in the
 * right paw). The story animation adds the other poses and props. Colours are brand tokens
 * (Tailwind fill-/stroke- classes), so nothing here is an off-brand hex.
 */
export function Panda({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 420 420" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="panda-eye-l">
          <ellipse cx="167" cy="162" rx="13.6" ry="14.4" />
        </clipPath>
        <clipPath id="panda-eye-r">
          <ellipse cx="253" cy="162" rx="13.6" ry="14.4" />
        </clipPath>
        <radialGradient id="panda-ear-felt" cx="0.38" cy="0.3" r="0.62">
          <stop offset="0" stopColor="var(--color-ink-soft)" stopOpacity="1" />
          <stop offset="0.55" stopColor="var(--color-ink-soft)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--color-ink-soft)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="fill-ink" cx="210" cy="386" rx="118" ry="14" opacity="0.12" />
      <g transform="translate(-69 0) rotate(13 117 386) translate(117 386) scale(0.72) translate(-117 -386)">
        <path
          className="stroke-green"
          d="M122 220L117 386"
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          className="stroke-green-ink"
          d="M113.73 262H127.73M112.47 304H126.47M111.14 348H125.14"
          fill="none"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          className="fill-green"
          d="M121.46 238C100.46 216 78.46 222 82.46 242C96.46 248 110.46 246 121.46 238Z"
        />
        <path
          className="fill-green-soft"
          d="M120.46 252C98.46 252 86.46 268 94.46 280C108.46 278 118.46 266 120.46 252Z"
        />
        <circle className="fill-green-soft" cx="122" cy="220" r="9" />
        <circle className="fill-green" cx="122" cy="220" r="3.6" />
      </g>
      <ellipse className="fill-ink-soft" cx="210" cy="304" rx="80" ry="84" />
      <ellipse className="fill-paper-deep" cx="210" cy="324" rx="70" ry="58" />
      <ellipse className="fill-paper" cx="210" cy="318" rx="67" ry="52" />
      <g transform="rotate(-12 150 368)">
        <ellipse className="fill-ink" cx="150" cy="368" rx="45" ry="25" />
      </g>
      <g transform="rotate(12 270 368)">
        <ellipse className="fill-ink" cx="270" cy="368" rx="45" ry="25" />
      </g>
      <circle className="fill-ink" cx="139" cy="96.5" r="33.22" />
      <circle className="fill-ink-soft" cx="136.23" cy="100.19" r="18.6" />
      <circle cx="139" cy="96.5" r="33.22" fill="url(#panda-ear-felt)" />
      <circle className="fill-ink" cx="281" cy="96.5" r="33.22" />
      <circle className="fill-ink-soft" cx="283.77" cy="100.19" r="18.6" />
      <circle cx="281" cy="96.5" r="33.22" fill="url(#panda-ear-felt)" />
      <path
        className="fill-paper stroke-line-strong"
        d="M210 72C266 72 310 103.16 310 154C310 208 267 244 210 244C153 244 110 208 110 154C110 103.16 154 72 210 72Z"
        strokeWidth="2"
      />
      <path
        className="fill-paper-deep"
        d="M118 183.7C128 222 165 244 210 244C255 244 292 222 302 183.7C288 216 265 232 210 232C155 232 132 216 118 183.7Z"
      />
      <ellipse
        className="fill-ink"
        cx="166"
        cy="163"
        rx="28"
        ry="33"
        transform="rotate(16 166 163)"
      />
      <ellipse
        className="fill-ink"
        cx="254"
        cy="163"
        rx="28"
        ry="33"
        transform="rotate(-16 254 163)"
      />
      <ellipse className="fill-orange-soft" cx="141.5" cy="199" rx="14.5" ry="8.6" />
      <ellipse className="fill-orange-soft" cx="278.5" cy="199" rx="14.5" ry="8.6" />
      <ellipse className="fill-paper" cx="167" cy="162" rx="13.6" ry="14.4" />
      <g clipPath="url(#panda-eye-l)">
        <ellipse className="fill-paper-deep" cx="167" cy="141.12" rx="21.76" ry="9.5" />
        <circle className="fill-ink" cx="167" cy="162" r="7.2" />
        <circle className="fill-paper" cx="164.3" cy="158.9" r="3.1" />
        <circle className="fill-paper" cx="170.4" cy="165.6" r="1.3" />
        <ellipse className="fill-ink" cx="167" cy="179.6" rx="17.5" ry="8.8" />
      </g>
      <ellipse className="fill-paper" cx="253" cy="162" rx="13.6" ry="14.4" />
      <g clipPath="url(#panda-eye-r)">
        <ellipse className="fill-paper-deep" cx="253" cy="141.12" rx="21.76" ry="9.5" />
        <circle className="fill-ink" cx="253" cy="162" r="7.2" />
        <circle className="fill-paper" cx="250.3" cy="158.9" r="3.1" />
        <circle className="fill-paper" cx="256.4" cy="165.6" r="1.3" />
        <ellipse className="fill-ink" cx="253" cy="179.6" rx="17.5" ry="8.8" />
      </g>
      <path
        className="fill-ink"
        d="M200 185.6Q210 179.65 220 185.6Q219 195.12 210 197.5Q201 195.12 200 185.6Z"
      />
      <ellipse className="fill-paper" cx="206.6" cy="185.6" rx="3.2" ry="1.87" opacity="0.5" />
      <path
        className="stroke-ink"
        d="M210 197.5V202.6"
        fill="none"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        className="fill-ink stroke-ink"
        d="M194 202.6Q210 207.6 226 202.6Q224.5 222 210 223.5Q195.5 222 194 202.6Z"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        className="fill-orange-soft"
        d="M200.5 216.8Q210 209.8 219.5 216.8Q215 222.4 210 222.6Q205 222.4 200.5 216.8Z"
      />
      <path
        className="stroke-ink"
        d="M190.6 199.6Q192.4 203.4 195.2 203.4M229.4 199.6Q227.6 203.4 224.8 203.4"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Arms in the "Set it up" pose: the left one relaxed, the right one raised with the pencil. */}
      <g transform="rotate(14 162.7 261.16)">
        <ellipse
          className="fill-ink"
          cx="153"
          cy="295"
          rx="28"
          ry="44"
          transform="rotate(16 153 295)"
        />
        <ellipse className="fill-ink" cx="141" cy="330" rx="25" ry="23" />
      </g>
      <g transform="rotate(-48.5 257.3 261.16)">
        <ellipse
          className="fill-ink"
          cx="267"
          cy="295"
          rx="28"
          ry="44"
          transform="rotate(-16 267 295)"
        />
        <ellipse className="fill-ink" cx="279" cy="330" rx="25" ry="23" />
        <g transform="rotate(6 281 326) translate(281 326)">
          <path
            className="stroke-orange"
            d="M-8 9L34 -33"
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            className="stroke-orange-soft"
            d="M-8 9L-12 13"
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            className="fill-paper-deep stroke-paper-deep"
            d="M30.5 -37.5L46 -45L38.5 -29.5Z"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            className="fill-ink stroke-ink"
            d="M42 -43L46 -45L44 -41Z"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
        </g>
        <ellipse className="fill-ink" cx="281" cy="326" rx="15" ry="12.88" />
      </g>
    </svg>
  );
}
