import { copy } from '@/copy/index.ts';

/** The empty app shell: the brand mark and name until the first screens are built. */
export function App() {
  return (
    <main className="grid min-h-dvh place-content-center justify-items-center gap-2 p-4 text-center">
      <img src="/jobdeputy-mark.svg" alt="" width="120" height="87" />
      <h1 className="mt-2 font-display text-[clamp(40px,8vw,72px)] leading-none tracking-[-0.02em]">
        {copy.shell.productName}
      </h1>
      <p className="text-lg text-muted-foreground">{copy.shell.tagline}</p>
    </main>
  );
}
