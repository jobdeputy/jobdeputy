import { copy } from '@/copy/index.ts';
import { AuthButton, type AuthControl } from './auth-drawer.tsx';

/**
 * The sticky top bar: the brand on the left, sign-in and sign-up on the right. Phones keep only
 * "Sign in" here; the hero right below offers "Get started free". At least --header-height tall,
 * it grows and wraps to a second row when enlarged text no longer fits on one.
 */
export function SiteHeader({ auth }: { auth: AuthControl }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-(--header-height) flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5 border-b border-line-soft bg-header-surface px-[17px] backdrop-blur-[20px] backdrop-saturate-180 sm:px-[clamp(21px,4vw,55px)]">
      <a
        href="/"
        className="group inline-flex min-h-11 min-w-0 items-center gap-2 rounded-[15px] py-0.5 pe-2.5 transition-colors duration-180 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <img
          src="/jobdeputy-mark.svg"
          alt=""
          width="62"
          height="45"
          className="block w-[62px] shrink-0 transition-transform duration-180 group-hover:-translate-y-px group-active:scale-98 motion-reduce:transition-none"
        />
        <span className="grid min-w-0 gap-[3px] leading-none">
          <span className="text-[19px] tracking-[-0.05em]">
            <span className="font-[620]">{copy.shell.wordmark[0]}</span>
            <span className="font-[720]">{copy.shell.wordmark[1]}</span>
          </span>
          <span className="hidden text-[8.5px] font-[680] tracking-[0.075em] text-muted-foreground uppercase md:block">
            {copy.shell.tagline}
          </span>
        </span>
      </a>
      <div className="flex items-center gap-2 md:gap-3.5">
        <AuthButton control={auth} mode="sign-in" variant="outline">
          {copy.landing.signIn}
        </AuthButton>
        <AuthButton control={auth} mode="sign-up" className="hidden md:inline-flex">
          {copy.landing.getStarted}
        </AuthButton>
      </div>
    </header>
  );
}
