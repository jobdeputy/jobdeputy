import { useEffect, useRef } from 'react';

/**
 * A page's (or a set-up step's) heading: its eyebrow, its title (which takes focus when it comes
 * on, so the change is announced; `id` names its section) and its introduction.
 */
export function PageIntro({
  id,
  eyebrow,
  title,
  intro,
}: {
  id: string;
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
        id={id}
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
