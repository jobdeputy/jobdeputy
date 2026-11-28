import { DEV_BUILD } from './build.ts';
import { copy } from './copy.ts';

/** "Dev", beside the title on a dev build (src/build.ts); nothing on the store's. */
export function DevTag() {
  if (!DEV_BUILD) return null;
  return (
    <span
      title={copy.popup.devLabel}
      className="inline-flex items-center rounded-full bg-orange-soft px-2 py-0.5 align-middle font-text text-[0.6875rem] font-bold tracking-[0.08em] text-danger-ink uppercase"
    >
      {copy.popup.dev}
      <span className="sr-only"> ({copy.popup.devLabel})</span>
    </span>
  );
}
