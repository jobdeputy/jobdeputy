import type { ReactNode } from 'react';
import type { PandaPose } from '@/components/deputy/panda.tsx';
import { copy } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

/** A soft card shadow in the ink colour (the prototype's 0 12px 25px at 8%). */
const CARD_SHADOW = 'shadow-[0_12px_25px_color-mix(in_oklab,var(--color-ink)_8%,transparent)]';

/**
 * The props beside the deputy, one set per step of the story (the prototype's
 * `.capability-objects`): the setup card, the search map, the application on its way. Only the
 * current step's set shows; it rises in as the step comes on (260ms fade, 618ms settle) and its
 * flourish plays once each time. Decorative: the stage is hidden from screen readers.
 */
export function StoryProps({ scene }: { scene: PandaPose }) {
  return (
    <>
      <Rig
        shown={scene === 'setup'}
        className="top-[15%] left-[7%] h-[182px] w-[186px] lg:left-[3%]"
      >
        <SetupCard ticking={scene === 'setup'} />
      </Rig>
      <Rig shown={scene === 'search'} className="top-[26%] left-[9%] h-[145px] w-[215px]">
        <SearchMap sweeping={scene === 'search'} />
      </Rig>
      <Rig
        shown={scene === 'apply'}
        className="top-[22%] left-[7%] h-[170px] w-[255px] lg:left-[1%]"
      >
        <ApplyRig sending={scene === 'apply'} />
      </Rig>
    </>
  );
}

function Rig({
  shown,
  className,
  children,
}: {
  shown: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      data-shown={shown || undefined}
      className={cn(
        'absolute transition-[opacity,transform] duration-[260ms,618ms] ease-settle motion-reduce:transition-none',
        shown ? 'opacity-100' : 'translate-y-[13px] scale-[0.88] opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Set it up: what you set up (roles, résumé, rules), each row ticked in turn as the pencil writes. */
function SetupCard({ ticking }: { ticking: boolean }) {
  const { stage } = copy.landing;
  // Each row's tick follows the last (the prototype's 640, 900 and 1160ms).
  const delays = ['[animation-delay:640ms]', '[animation-delay:900ms]', '[animation-delay:1160ms]'];
  return (
    <div
      className={cn(
        'grid size-full -rotate-4 content-start gap-3 rounded-[15px] border border-line bg-surface-strong px-[17px] pt-[17px] pb-[13px]',
        'shadow-[0_14px_28px_color-mix(in_oklab,var(--color-ink)_10%,transparent)]',
      )}
    >
      <strong className="mb-0.5 block text-[0.625rem] tracking-[0.08em] uppercase">
        {stage.setupCardTitle}
      </strong>
      {stage.setupRows.map((row, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length list; rows may repeat in a translation.
          key={index}
          className="flex items-center gap-2.5 text-sm leading-tight font-[650]"
        >
          <span
            className={cn(
              'relative block size-[22px] shrink-0 rounded-full border-2 border-green bg-green-soft after:absolute after:top-[3px] after:left-[6px] after:h-[9px] after:w-[5px] after:rotate-45 after:border-r-[2.5px] after:border-b-[2.5px] after:border-green-ink',
              ticking && 'animate-setup-tick motion-reduce:animate-none',
              ticking && delays[index],
            )}
          />
          {row}
        </span>
      ))}
    </div>
  );
}

/** A source the deputy searches: a small page card, tinted per source. */
function SourceNode({ className }: { className: string }) {
  return (
    <span
      className={cn(
        'absolute grid size-[46px] place-items-center rounded-[15px] border border-ink/10 bg-white/90',
        CARD_SHADOW,
        className,
      )}
    >
      <svg
        viewBox="0 0 25 18"
        className="h-[18px] w-[25px] opacity-72"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          x="1"
          y="1"
          width="23"
          height="16"
          rx="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M5 7h14M5 12h9" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}

/** It finds: three sources you chose, a route between them, and a pulse sweeping across. */
function SearchMap({ sweeping }: { sweeping: boolean }) {
  return (
    <>
      <SourceNode className="top-1 left-2 text-muted-foreground" />
      <SourceNode className="top-[82px] left-[42px] text-blue" />
      <SourceNode className="top-[26px] left-[126px] text-orange" />
      <span className="absolute top-[63px] left-[31px] h-[52px] w-[127px] -rotate-8 rounded-[50%] border-t-2 border-dashed border-blue/38" />
      <span
        className={cn(
          // Its rest is set as `transform` (not Tailwind's translate), which the sweep animates.
          'absolute top-9 left-[82px] size-[60px] [transform:translate(24px,-13px)] rounded-full border-2 border-orange/52',
          sweeping && 'animate-search-sweep motion-reduce:animate-none',
        )}
      />
    </>
  );
}

/** It applies: the approved application on its way along a route into the portal (the ✓). */
function ApplyRig({ sending }: { sending: boolean }) {
  return (
    <>
      <span
        className={cn(
          'absolute top-12 left-2 grid h-[60px] w-[82px] place-items-center rounded-[12px] border-2 border-green/55 bg-white/92',
          CARD_SHADOW,
          // At rest it has gone into the portal (unseen); the flight animates `transform` from the
          // start of the route. Under reduced motion it waits, seen, at the start.
          'opacity-0 [transform:translateX(144px)_rotate(4deg)_scale(0.65)]',
          sending &&
            'animate-send-application motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:[transform:rotate(-3deg)]',
        )}
      >
        {/* An envelope with a green tick on its corner. */}
        <svg viewBox="0 0 42 28" className="h-7 w-[42px]" aria-hidden="true" focusable="false">
          <rect
            x="1"
            y="1"
            width="40"
            height="26"
            rx="4"
            className="fill-none stroke-green"
            strokeWidth="2"
          />
          <path d="M2 3l19 13 19-13" className="fill-none stroke-green" strokeWidth="2" />
        </svg>
        <span className="absolute -top-2.5 -right-2.5 grid size-6 place-items-center rounded-full border-[3px] border-white bg-green text-xs leading-none font-extrabold text-white">
          ✓
        </span>
      </span>
      <span className="absolute top-[67px] left-[91px] w-[83px] border-t-[3px] border-dashed border-blue/38" />
      <span
        className={cn(
          'absolute top-[17px] right-0 grid h-[118px] w-[76px] place-items-center rounded-[17px] border border-ink/12 bg-white/90',
          CARD_SHADOW,
        )}
      >
        <span className="grid size-[41px] place-items-center rounded-full bg-green text-[1.1875rem] leading-none font-[780] text-white">
          ✓
        </span>
      </span>
    </>
  );
}
