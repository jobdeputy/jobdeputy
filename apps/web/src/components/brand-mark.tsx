import { copy } from '@/copy/index.ts';

/**
 * The logo mark and wordmark, with the tagline from `md` up: the left of the landing header and of
 * the set-up header. The caller wraps it (a link home, or plain).
 */
export function BrandMark() {
  return (
    <>
      <img
        src="/jobdeputy-mark.svg"
        alt=""
        width="62"
        height="45"
        className="block w-[62px] min-w-0 shrink transition-transform duration-180 group-hover:-translate-y-px group-active:scale-98 motion-reduce:transition-none"
      />
      <span className="grid min-w-0 gap-[3px] leading-none">
        <span className="text-[1.1875rem] tracking-[-0.05em]">
          <span className="font-[620]">{copy.shell.wordmark[0]}</span>
          <span className="font-[720]">{copy.shell.wordmark[1]}</span>
        </span>
        <span className="hidden text-[0.53125rem] font-[680] tracking-[0.075em] text-muted-foreground uppercase md:block">
          {copy.shell.tagline}
        </span>
      </span>
    </>
  );
}
