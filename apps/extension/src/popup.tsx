import { copy, fill } from './copy.ts';

/**
 * The toolbar popup (#54). The shell says what the extension is for; sign-in (PR B) and the
 * fill status of the open application (PR C) come here next.
 */
export function Popup({ version }: { version: string }) {
  const text = copy.popup;
  return (
    <main className="grid w-[340px] gap-2 p-[21px]">
      <h1 className="m-0 font-display text-[1.75rem] leading-none font-medium tracking-[-0.04em]">
        {text.title}
      </h1>
      <p className="m-0 text-sm leading-normal text-muted-foreground">{text.line}</p>
      <p className="m-0 text-sm font-[650]">{text.soon}</p>
      <p className="m-0 text-xs text-quiet">{fill(text.version, { version })}</p>
    </main>
  );
}
