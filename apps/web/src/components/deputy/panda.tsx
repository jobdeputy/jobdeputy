import { type CSSProperties, type ReactNode, type SVGProps, useId } from 'react';
import { cn } from '@/lib/utils.ts';

/** The poses the deputy can hold: the landing story's three chapters, and pending work (#17). */
export type PandaPose = 'setup' | 'search' | 'apply' | 'pending';

type Prop = 'pencil' | 'magnifier' | 'approval' | 'hourglass';

/**
 * Each pose, from the prototype's `data-scene` / `data-deputy-state` rules (round 7): the head's
 * tilt (about 210,158), the right arm's turn (about the shoulder, 257.3,261.16), the prop in the
 * paw and how it is held (turn and size about the grip, 281,326), and where the eyes look.
 */
const POSES: Record<
  PandaPose,
  {
    head: string;
    arm: number;
    prop: Prop;
    propTurn: number;
    propScale: number;
    look: [number, number];
    /** The landing story's flourishes, each played once as the pose comes on. */
    armFlourish?: string;
    propFlourish?: string;
  }
> = {
  setup: {
    head: 'translate(-4px, 4px) rotate(-8deg)',
    arm: -48.5,
    prop: 'pencil',
    propTurn: 6,
    propScale: 1,
    look: [-5, 3],
    armFlourish: 'animate-tailor-paw',
    propFlourish: 'animate-tailor-pencil',
  },
  search: {
    head: 'translate(-5px, -1px) rotate(-7deg)',
    arm: -80.5,
    prop: 'magnifier',
    propTurn: 94.2,
    propScale: 1,
    look: [-5, -1],
    propFlourish: 'animate-magnifier-scan',
  },
  apply: {
    head: 'translate(2px, -2px) rotate(5deg)',
    arm: 22,
    prop: 'approval',
    propTurn: -26,
    propScale: 1.2,
    look: [4, -1],
  },
  pending: {
    head: 'translate(0px, -3px) rotate(1deg)',
    arm: -34,
    prop: 'hourglass',
    propTurn: 30,
    propScale: 1.15,
    look: [0, -3],
  },
};

/** Parts that move: they settle into each pose over the prototype's 618ms; at once under reduced motion. */
const MOVES =
  'transition-transform duration-[618ms] ease-settle [transform-box:view-box] motion-reduce:transition-none';

/**
 * The deputy: the brand panda from the round 7 prototype, in a pose:
 * - `setup`, `search`, `apply`: the landing story's chapters, with the pencil, the magnifier, and
 *   the approved page in the right paw.
 * - `pending` (#17): working on something that takes a while; the hourglass, eyes up.
 * A change of pose moves the head, the arm and the eyes there over 618ms, and the new prop fades
 * in as the arm arrives; the story's poses then play their flourish once (the pencil writes, the
 * magnifier scans). (The prototype also lifts the body 7px when pending; not drawn yet.)
 * Colours are brand tokens (Tailwind fill-/stroke- classes), so nothing here is an off-brand hex.
 */
export function Panda({ className, pose = 'setup' }: { className?: string; pose?: PandaPose }) {
  // Unique per instance: a second panda on the page must not borrow this one's clip paths.
  const id = useId();
  const eyeLeft = `${id}-eye-l`;
  const eyeRight = `${id}-eye-r`;
  const earFelt = `${id}-ear-felt`;
  const current = POSES[pose];
  const look: CSSProperties = {
    transform: `translate(${current.look[0]}px, ${current.look[1]}px)`,
  };
  return (
    <svg className={className} viewBox="0 0 420 420" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={eyeLeft}>
          <ellipse cx="167" cy="162" rx="13.6" ry="14.4" />
        </clipPath>
        <clipPath id={eyeRight}>
          <ellipse cx="253" cy="162" rx="13.6" ry="14.4" />
        </clipPath>
        <radialGradient id={earFelt} cx="0.38" cy="0.3" r="0.62">
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
      {/* The head: ears, face, eyes, nose, mouth. It tilts about 210,158. */}
      <g className={cn(MOVES, 'origin-[210px_158px]')} style={{ transform: current.head }}>
        <circle className="fill-ink" cx="139" cy="96.5" r="33.22" />
        <circle className="fill-ink-soft" cx="136.23" cy="100.19" r="18.6" />
        <circle cx="139" cy="96.5" r="33.22" fill={`url(#${earFelt})`} />
        <circle className="fill-ink" cx="281" cy="96.5" r="33.22" />
        <circle className="fill-ink-soft" cx="283.77" cy="100.19" r="18.6" />
        <circle cx="281" cy="96.5" r="33.22" fill={`url(#${earFelt})`} />
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
        <g clipPath={`url(#${eyeLeft})`}>
          <ellipse className="fill-paper-deep" cx="167" cy="141.12" rx="21.76" ry="9.5" />
          <g
            className="transition-transform duration-[380ms] ease-settle motion-reduce:transition-none"
            style={look}
          >
            <circle className="fill-ink" cx="167" cy="162" r="7.2" />
            <circle className="fill-paper" cx="164.3" cy="158.9" r="3.1" />
            <circle className="fill-paper" cx="170.4" cy="165.6" r="1.3" />
          </g>
          <ellipse className="fill-ink" cx="167" cy="179.6" rx="17.5" ry="8.8" />
        </g>
        <ellipse className="fill-paper" cx="253" cy="162" rx="13.6" ry="14.4" />
        <g clipPath={`url(#${eyeRight})`}>
          <ellipse className="fill-paper-deep" cx="253" cy="141.12" rx="21.76" ry="9.5" />
          <g
            className="transition-transform duration-[380ms] ease-settle motion-reduce:transition-none"
            style={look}
          >
            <circle className="fill-ink" cx="253" cy="162" r="7.2" />
            <circle className="fill-paper" cx="250.3" cy="158.9" r="3.1" />
            <circle className="fill-paper" cx="256.4" cy="165.6" r="1.3" />
          </g>
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
      </g>
      {/* The left arm rests in every pose; the right one holds the pose's prop. */}
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
      <g
        className={cn(
          MOVES,
          'origin-[257.3px_261.16px] motion-reduce:animate-none',
          current.armFlourish,
        )}
        style={{ transform: `rotate(${current.arm}deg)` }}
      >
        <ellipse
          className="fill-ink"
          cx="267"
          cy="295"
          rx="28"
          ry="44"
          transform="rotate(-16 267 295)"
        />
        <ellipse className="fill-ink" cx="279" cy="330" rx="25" ry="23" />
        {PROPS.map(({ name, Shape }) => (
          <PropInPaw key={name} active={name === current.prop} pose={current}>
            <Shape />
          </PropInPaw>
        ))}
        <ellipse className="fill-ink" cx="281" cy="326" rx="15" ry="12.88" />
      </g>
    </svg>
  );
}

/**
 * A prop in the right paw, drawn around the grip point (281,326). The pose's prop shows, turned
 * and sized as the pose holds it, fading in as the arm arrives (380ms into its 618ms); the others
 * wait unseen, small and upright, as in the prototype.
 */
function PropInPaw({
  active,
  pose,
  children,
}: {
  active: boolean;
  pose: (typeof POSES)[PandaPose];
  children: ReactNode;
}) {
  return (
    <g
      className={cn(
        // Opacity over 180ms, the hold over 618ms; a prop coming in waits 380ms to appear.
        'origin-[281px_326px] transition-[opacity,transform] duration-[180ms,618ms] ease-settle [transform-box:view-box] motion-reduce:transition-none',
        active
          ? cn(
              'opacity-100 [transition-delay:380ms,0ms] motion-reduce:animate-none',
              pose.propFlourish,
            )
          : 'opacity-0',
      )}
      style={{
        transform: active
          ? `rotate(${pose.propTurn}deg) scale(${pose.propScale})`
          : 'rotate(0deg) scale(0.6)',
      }}
    >
      <g transform="translate(281 326)">{children}</g>
    </g>
  );
}

/**
 * The deputy's pencil, drawn around its grip point (0, 0): the panda holds it in his paw, and the
 * step strip shows it as the "Set it up" tool. Position it with `transform`.
 */
export function PencilShape(props: SVGProps<SVGGElement>) {
  return (
    <g {...props}>
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
  );
}

/**
 * The deputy's hourglass, for the pending pose, drawn around its grip point (0, 0) like the pencil:
 * paper glass, orange sand running down, ink caps (the prototype's `deputy-hourglass`).
 */
export function HourglassShape(props: SVGProps<SVGGElement>) {
  return (
    <g {...props}>
      <path
        className="fill-paper stroke-line-strong"
        d="M2 -84H46Q46 -62 30 -47Q46 -32 46 -10H2Q2 -32 18 -47Q2 -62 2 -84Z"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path className="fill-orange-soft" d="M11 -76H37Q35 -64 24 -56Q13 -64 11 -76Z" />
      <path
        className="stroke-orange"
        d="M24 -55V-28"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path className="fill-orange" d="M7 -12Q10 -25 24 -28Q38 -25 41 -12Z" />
      <rect className="fill-ink-soft" x="-4" y="-94" width="56" height="10" rx="5" />
      <rect className="fill-ink-soft" x="-4" y="-10" width="56" height="10" rx="5" />
    </g>
  );
}

/** The deputy's magnifier, for "It finds", drawn around its grip point (0, 0) like the pencil. */
export function MagnifierShape(props: SVGProps<SVGGElement>) {
  return (
    <g {...props}>
      <path
        className="stroke-blue"
        d="M3 -4L20 -26"
        fill="none"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <circle
        className="fill-blue-soft stroke-blue"
        cx="34"
        cy="-43"
        r="22"
        fillOpacity="0.52"
        strokeWidth="8"
      />
      <path
        className="stroke-paper"
        d="M23 -48Q31 -57 41 -51"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.85"
      />
    </g>
  );
}

/**
 * The approved page, for "It applies", drawn around its grip point (0, 0) like the pencil: a page
 * with a green tick.
 */
export function ApprovalShape(props: SVGProps<SVGGElement>) {
  return (
    <g {...props}>
      <rect
        className="fill-paper stroke-line-strong"
        x="-12"
        y="-110"
        width="80"
        height="104"
        rx="13"
        strokeWidth="2.5"
      />
      <path
        className="stroke-ink-soft"
        d="M2 -92H36"
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        className="stroke-quiet"
        d="M2 -78H52M2 -66H34"
        fill="none"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeOpacity="0.7"
      />
      <circle className="fill-green-soft stroke-green" cx="28" cy="-34" r="17" strokeWidth="4" />
      <path
        className="stroke-green-ink"
        d="M19.5 -34.5L25.5 -28.5L37 -40"
        fill="none"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** Every prop the paw can hold, drawn once each; the pose picks which one shows. */
const PROPS: { name: Prop; Shape: (props: SVGProps<SVGGElement>) => ReactNode }[] = [
  { name: 'pencil', Shape: PencilShape },
  { name: 'magnifier', Shape: MagnifierShape },
  { name: 'approval', Shape: ApprovalShape },
  { name: 'hourglass', Shape: HourglassShape },
];
