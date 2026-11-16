import { useEffect, useRef } from 'react';

/**
 * A step's heading: its eyebrow, its title (which takes focus when the step comes on, so the
 * change is announced) and its introduction.
 */
export function StepIntro({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="grid gap-2">
      <p className="m-0 flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
        {eyebrow}
      </p>
      <h1
        id="set-up-title"
        tabIndex={-1}
        ref={heading}
        className="m-0 font-display text-[clamp(2.25rem,8vw,3rem)] leading-none font-medium tracking-[-0.05em] text-balance outline-none"
      >
        {title}
      </h1>
      <p className="m-0 text-[0.9375rem] text-muted-foreground">{intro}</p>
    </div>
  );
}

/** One fact about the account: what it is, its value, and a pill where it is fixed. */
export function Fact({ label, value, pill }: { label: string; value: string; pill?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[15px] border border-line-soft bg-surface px-4 py-3">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-xs font-[650] text-muted-foreground">{label}</span>
        <strong className="min-w-0 text-[0.9375rem] font-[650] wrap-anywhere">{value}</strong>
      </span>
      {pill && (
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-[650] text-muted-foreground">
          {pill}
        </span>
      )}
    </li>
  );
}
