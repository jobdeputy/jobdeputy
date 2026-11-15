import { useEffect, useRef } from 'react';
import { copy, fill } from '@/copy/index.ts';

/**
 * Where a signed-in person lands until the app's own screens arrive (#14 slice 2): who they are
 * signed in as (Sign out is in the signed-in layout's header). Its title takes focus, so the change of page is announced.
 */
export function SignedIn({ email }: { email: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  // Once, on arrival: the change of page is announced, and focus is not pulled back later.
  useEffect(() => {
    title.current?.focus();
  }, []);
  const { signedIn: text } = copy;
  return (
    <div className="grid place-items-center">
      <section aria-labelledby="signed-in-title" className="grid max-w-[480px] gap-3">
        <p className="m-0 flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
          {text.kicker}
        </p>
        <h1
          id="signed-in-title"
          tabIndex={-1}
          ref={title}
          className="m-0 font-display text-[clamp(2.5rem,9vw,3.25rem)] leading-none font-medium tracking-[-0.05em] outline-none"
        >
          {text.title}
        </h1>
        <p className="m-0 text-[0.9375rem] text-muted-foreground">{fill(text.body, { email })}</p>
      </section>
    </div>
  );
}
