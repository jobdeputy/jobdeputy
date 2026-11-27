import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { EditIcon } from '@/components/icons.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { cn } from '@/lib/utils.ts';
import { type FormSpec, useProfileForm } from './profile-form.tsx';

// The Profile page's groups (#33), shared by its sections (#53: Application answers too).

export type FactRow = readonly [label: string, value: string | readonly string[] | undefined];

/** How a group's form ends: saved, or cancelled (not marked Saved). Both go back to what is saved. */
export type Done = { labelledBy: string; onSaved: () => void; onCancel: () => void };

/**
 * One group under its heading (the prototype's `.profile-group`), with Edit: the form replaces
 * what is saved and takes focus at its first field; Save or Cancel brings the facts back and
 * focus to Edit, and a save marks the group Saved (and says so) until it is edited again.
 */
export function Group({
  id,
  title,
  view,
  say,
  editor,
  editable = true,
}: {
  id: string;
  title: string;
  /** What is saved, shown while the form is closed. */
  view: ReactNode;
  say: (words: string) => void;
  editor: (done: Done) => ReactNode;
  /** Whether Edit is offered yet. */
  editable?: boolean;
}) {
  const text = copy.profilePage;
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  function close(didSave: boolean) {
    // Rendered first, so focus lands on the Edit button that comes back.
    flushSync(() => {
      setEditing(false);
      setSaved(didSave);
    });
    edit.current?.focus();
    if (didSave) say(fill(text.savedSaid, { group: title }));
  }
  return (
    <div className="mt-[34px] grid min-w-0 gap-[13px] border-t border-line pt-[34px]">
      {/* Saved and Edit stay together: where the row is too narrow for them beside the title,
          they move under it as one, so the title never breaks inside a word. */}
      <div className="flex min-h-11 flex-wrap items-center gap-x-[13px] gap-y-2">
        <h3
          id={`${id}-title`}
          className="m-0 min-w-0 flex-[1_1_8rem] text-base font-[700] text-pretty"
        >
          {title}
        </h3>
        {((saved && !editing) || (!editing && editable)) && (
          <div className="ms-auto flex shrink-0 items-center gap-[13px]">
            {saved && !editing && (
              <p className="m-0 flex shrink-0 items-center gap-1.5 text-xs font-[650] text-green-ink before:font-[800] before:content-['✓']">
                {text.saved}
              </p>
            )}
            {!editing && editable && (
              <Button
                ref={edit}
                variant="outline"
                onClick={() => {
                  setSaved(false);
                  setEditing(true);
                }}
              >
                <EditIcon />
                {text.edit}
                <span className="sr-only"> {title}</span>
              </Button>
            )}
          </div>
        )}
      </div>
      {editing
        ? editor({
            labelledBy: `${id}-title`,
            onSaved: () => close(true),
            onCancel: () => close(false),
          })
        : view}
    </div>
  );
}

/**
 * A group's form (the prototype's `.profile-editor`): its fields, two to a row where the section
 * is wide enough, then why a save failed, then Save and Cancel. It opens at its first field.
 */
export function GroupForm<N extends string>({
  spec,
  profile,
  labelledBy,
  onSaved,
  onCancel,
  children,
}: Done & {
  spec: FormSpec<N>;
  profile: Profile;
  children: (bind: ReturnType<typeof useProfileForm<N>>['bind']) => ReactNode;
}) {
  const text = copy.profilePage;
  const { bind, pending, form, messages } = useProfileForm({ spec, profile, onSaved });
  useOpenAtFirstField(form.ref);
  return (
    <form {...form} aria-labelledby={labelledBy} className={cn(EDITOR_BOX, form.className)}>
      <div className="grid min-w-0 items-start gap-[21px] @[640px]:grid-cols-2">
        {children(bind)}
      </div>
      {messages}
      <div className="flex flex-wrap items-center gap-x-[13px] gap-y-2">
        <Button type="submit" pending={pending} pendingLabel={copy.setUp.saving}>
          {text.save}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {text.cancel}
        </Button>
      </div>
    </form>
  );
}

/** A group's form opens at its first field (Edit is gone, so focus goes somewhere useful). */
export function useOpenAtFirstField(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
  }, [ref]);
}

/** A group's form box (the prototype's `.profile-editor`). */
export const EDITOR_BOX =
  'grid min-w-0 gap-[21px] rounded-[22px] border border-line bg-paper p-[21px]';

/** A group's saved facts (the prototype's `.profile-facts`): label, then value or Not added. */
export function Facts({
  facts,
  empty = copy.profilePage.notAdded,
}: {
  facts: readonly FactRow[];
  /** What a fact with nothing saved says (#53's questions: Not answered). */
  empty?: string;
}) {
  const text = copy.profilePage;
  return (
    <dl className="m-0 grid">
      {facts.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-x-[21px] gap-y-1 border-b border-line-soft py-[13px] last:border-b-0 @[560px]:grid-cols-[178px_minmax(0,1fr)] @[560px]:items-baseline"
        >
          <dt className="text-[0.8125rem] font-[650] text-muted-foreground">{label}</dt>
          <dd
            className={
              value?.length
                ? 'm-0 grid min-w-0 text-[0.9375rem] wrap-anywhere text-ink'
                : 'm-0 min-w-0 text-[0.9375rem] text-muted-foreground'
            }
          >
            {!value?.length
              ? empty
              : typeof value === 'string'
                ? value
                : value.map((line, at) => (
                    // The same address may be listed twice: placed by where it is.
                    // biome-ignore lint/suspicious/noArrayIndexKey: a read-only list
                    <span key={at}>{line}</span>
                  ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
