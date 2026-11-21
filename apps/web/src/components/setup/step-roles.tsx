import { createRoleInput, MAX_ROLES } from '@jobdeputy/shared/profile';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Field } from '@/components/auth/fields.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import { type Role, rolesQuery, useRoles } from '@/lib/api/roles.ts';
import { LIVE_REGION_BEAT_MS } from '@/lib/live-region.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';
import { refusalText, StepIntro } from './parts.tsx';

/** How long words stay in the status line after being said (they are read when they arrive). */
const SPOKEN_FOR_MS = 5000;

/** A role's title as the API checks it (trimmed, 1 to 120 characters). */
const TITLE = createRoleInput.shape.title;

const MAX = String(MAX_ROLES);

/**
 * Set it up, step 2 (#33): the job titles the deputy searches for, up to the API's 10. A title is
 * typed (with suggestions) and added, or picked from the prototype's chips; each chosen title is a
 * checked chip. Continue saves the list as target roles (`/me/roles`): the roles dropped are
 * removed, then the new ones added. Only titles here; the rest of a role is the Profile page's.
 */
export function StepRoles({ onSaved, onBack }: { onSaved: () => void; onBack: () => void }) {
  const text = copy.setUp.roles;
  const roles = useRoles();
  return (
    <>
      <StepIntro eyebrow={text.eyebrow} title={text.title} intro={fill(text.intro, { max: MAX })} />
      <QueryRegion
        query={roles}
        skeleton={{ kind: 'block', rows: 3 }}
        label={text.loading}
        error={<RolesFailed error={roles.error} onRetry={() => roles.refetch()} />}
      >
        {(saved) => <RolesForm saved={saved} onSaved={onSaved} onBack={onBack} />}
      </QueryRegion>
    </>
  );
}

/**
 * The roles could not be read: say why, and offer to try again where that can help (not once the
 * session has ended or the account is closed; Sign out is in the header).
 */
function RolesFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const text = copy.setUp.roles;
  const kind = error instanceof ApiError ? error.kind : 'server';
  const final = kind === 'signed-out' || kind === 'forbidden';
  return (
    <div className="grid justify-items-start gap-3">
      <p role="alert" className="m-0 text-sm font-[650] text-danger-ink">
        {final ? refusalText(error) : text.loadFailed}
      </p>
      {!final && (
        <Button variant="outline" onClick={onRetry}>
          {text.retry}
        </Button>
      )}
    </div>
  );
}

function RolesForm({
  saved,
  onSaved,
  onBack,
}: {
  /** The roles saved now (kept up to date as this step saves them). */
  saved: Role[];
  onSaved: () => void;
  onBack: () => void;
}) {
  const text = copy.setUp.roles;
  const api = useApi();
  const queries = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  // The saved titles this step started from: what the person changes here is told apart from what
  // changed somewhere else by comparing with them.
  const before = useRef(titlesOf(saved));
  // Every chip: titles of the person's own first (saved or typed), then the picks.
  const [chips, setChips] = useState(() => withChips(text.picks, before.current));
  const [chosen, setChosen] = useState(before.current);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  // What is wrong with the list itself (more chosen than fit), shown under it.
  const [listError, setListError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [spoken, setSpoken] = useState('');
  const [pending, setPending] = useState(false);
  const waiting = useDelayedPending(pending);
  const listId = useId();
  const refusalId = useId();
  const listErrorId = useId();
  // Titles whose save or removal lost its answer: either way is this step's doing, not a change
  // made elsewhere.
  const unsure = useRef<string[]>([]);
  // A save that ends after the person has left (signed out, say) must not touch anything.
  const here = useRef(true);
  useEffect(() => {
    // Set on every mount: React's development check mounts, unmounts and mounts again.
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

  /**
   * Says `words` in the status line a beat after clearing it, so the same words said again are
   * read again; then clears it, so reading through the form doesn't meet them twice.
   */
  const saying = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function say(words: string) {
    clearTimeout(saying.current);
    setSpoken('');
    saying.current = setTimeout(() => {
      if (!here.current) return;
      setSpoken(words);
      saying.current = setTimeout(() => {
        if (here.current) setSpoken('');
      }, SPOKEN_FOR_MS);
    }, LIVE_REGION_BEAT_MS);
  }
  useEffect(() => () => clearTimeout(saying.current), []);

  function titleInput() {
    return form.current?.querySelector<HTMLInputElement>('[name="title"]') ?? null;
  }

  /**
   * Shows what is wrong beside the title field. Focus moving there reads it; where focus stays
   * (Enter in the field, or a chip), it is said in the status line instead.
   */
  function fail(reason: string, moveFocus: boolean) {
    flushSync(() => setError(reason));
    const input = titleInput();
    if (moveFocus && input && input !== document.activeElement) input.focus();
    else say(reason);
  }

  /** Shows what is wrong with the list under it; focus stays where it is, so it is said too. */
  function failList(reason: string) {
    setListError(reason);
    say(reason);
  }

  /**
   * Adds the typed title (a chip of its own at the front, or its chip checked), and returns the
   * chosen titles with it; null when it can't be added (the reason is shown).
   */
  function addDraft(moveFocus: boolean): string[] | null {
    const title = clean(draft);
    if (!title) {
      fail(text.empty, moveFocus);
      return null;
    }
    const chip = chips.find((chipTitle) => same(chipTitle, title)) ?? title;
    if (includes(chosen, chip)) {
      fail(fill(text.duplicate, { title: chip }), moveFocus);
      return null;
    }
    // Checked, a title takes every saved role it names (saved twice elsewhere, say).
    const next = [...chosen, chip];
    if (inUse(saved, next) > MAX_ROLES) {
      fail(fill(text.full, { max: MAX }), moveFocus);
      return null;
    }
    const checked = TITLE.safeParse(title);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      fail(
        issue?.code === 'too_big'
          ? fill(copy.setUp.errors.tooLong, { max: String(issue.maximum) })
          : text.invalid,
        moveFocus,
      );
      return null;
    }
    if (!includes(chips, chip)) setChips([chip, ...chips]);
    setChosen(next);
    setDraft('');
    setError(null);
    setListError(null);
    say(fill(text.added, { title: chip, count: String(inUse(saved, next)), max: MAX }));
    return next;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter adds what was typed; in an empty field it continues, as Enter does in a form.
    // Not the Enter that ends composing (Safari sends it with keyCode 229, not isComposing).
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!clean(draft)) return;
    event.preventDefault();
    if (!pending) addDraft(false);
  }

  function toggle(title: string, checked: boolean) {
    if (pending) return;
    const next = checked
      ? [...chosen, title]
      : chosen.filter((chosenTitle) => !same(chosenTitle, title));
    if (checked && inUse(saved, next) > MAX_ROLES) {
      failList(fill(text.full, { max: MAX }));
      return;
    }
    setError(null);
    setListError(null);
    setChosen(next);
  }

  /**
   * Reads what is saved now, before anything is sent: a save whose answer was lost, or that failed
   * on the server's side, may have gone through, and sent again it would be saved twice. A read
   * already on its way may be from before it, so it is cancelled; offline, this read fails at once
   * rather than waiting for the connection.
   */
  async function readSaved(): Promise<Role[]> {
    await queries.cancelQueries({ queryKey: ['roles'] });
    return queries.fetchQuery({ ...rolesQuery(api), staleTime: 0, networkMode: 'always' });
  }

  /**
   * One change saved: the roles are now `current`, and this step made them so (a later try does
   * not take its own earlier saves for changes made elsewhere).
   */
  function saveDone(current: Role[]) {
    // A read already on its way answers from before this change: it must not undo it.
    void queries.cancelQueries({ queryKey: ['roles'] });
    queries.setQueryData(['roles'], current);
    before.current = titlesOf(current);
  }

  /** Shows the list with what changed elsewhere taken in, and says so. */
  function takeIn(titles: string[], fresh: string[]) {
    setChips((current) => withChips(current, titles));
    setChosen(titles);
    before.current = fresh;
    setRefusal(text.changedElsewhere);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    // Cleared in a render of its own, so the same refusal again is announced again.
    flushSync(() => {
      setRefusal(null);
      setListError(null);
    });
    // A title typed but not added yet is meant: it is added first (one already chosen just is).
    const typed = clean(draft);
    let titles: string[] | null = chosen;
    if (typed && includes(chosen, typed)) {
      setDraft('');
      setError(null);
    } else if (typed) titles = addDraft(true);
    if (!titles) return;
    if (titles.length === 0) {
      fail(text.none, true);
      return;
    }
    // Nothing to save, and no earlier save left in doubt: nothing to read either (offline, say).
    const toSave = plan(saved, titles);
    if (unsure.current.length === 0 && toSave.add.length === 0 && toSave.remove.length === 0) {
      onSaved();
      return;
    }
    setPending(true);
    // The change on its way, if its answer is lost or refused.
    let doing: { title: string; post: boolean } | null = null;
    try {
      let current = await readSaved();
      if (!here.current) return;
      // Roles saved elsewhere since this step opened are shown first, never removed unseen.
      if (settle(titles, current)) return;
      const changes = plan(current, titles);
      // The API counts roles, not titles (two saved may share one): more than fit (roles taken
      // in from elsewhere on top of these, say) means some must go first.
      if (current.length - changes.remove.length + changes.add.length > MAX_ROLES) {
        failList(fill(text.full, { max: MAX }));
        return;
      }
      // Removed first, so the new ones fit under the limit.
      for (const role of changes.remove) {
        doing = { title: role.title, post: false };
        try {
          await api.request('DELETE', `/me/roles/${encodeURIComponent(role.roleId)}`);
        } catch (error) {
          // Already gone is what was wanted.
          if (!(error instanceof ApiError && error.kind === 'not-found')) throw error;
        }
        if (!here.current) return;
        current = current.filter((kept) => kept.roleId !== role.roleId);
        saveDone(current);
      }
      for (const title of changes.add) {
        doing = { title, post: true };
        const role = await api.request<Role>('POST', '/me/roles', { title });
        if (!here.current) return;
        current = [...current, role];
        saveDone(current);
      }
      onSaved();
    } catch (error) {
      if (!here.current) return;
      // Its answer lost, or failed on the server's side, this change may or may not be saved: the
      // next read doesn't take either for a change made elsewhere.
      if (
        doing &&
        error instanceof ApiError &&
        (error.kind === 'unsure' || error.kind === 'server')
      )
        unsure.current.push(doing.title);
      // The limit, reached by roles added elsewhere since the read: they are shown at once.
      if (isFull(error)) {
        try {
          const fresh = await readSaved();
          if (!here.current) return;
          if (settle(titles, fresh)) return;
        } catch {
          // Unread, the limit is still the reason.
        }
      }
      setRefusal(refusalFor(error, doing));
    } finally {
      if (here.current) setPending(false);
    }
  }

  /**
   * What is saved (`fresh`) checked against what this step knows: changed elsewhere, the change is
   * taken in and shown (true); otherwise it is this step's own doing, and the next save starts
   * from it.
   */
  function settle(titles: string[], fresh: Role[]): boolean {
    const merged = reconcile(before.current, titles, titlesOf(fresh), unsure.current);
    unsure.current = [];
    if (merged.changed) {
      takeIn(merged.titles, titlesOf(fresh));
      // Taken in, there may be more than fit: said now, not on the next try.
      if (inUse(fresh, merged.titles) > MAX_ROLES) setListError(fill(text.full, { max: MAX }));
      return true;
    }
    before.current = titlesOf(fresh);
    return false;
  }

  /**
   * Why saving stopped, and what to do. Whatever was done before it is kept; the next try reads
   * what is saved first, so it saves only what is left.
   */
  function refusalFor(error: unknown, doing: { title: string; post: boolean } | null): string {
    if (error instanceof ApiError) {
      // Its answer lost, or failed on the server's side: it may have saved.
      if (error.kind === 'unsure') return copy.setUp.errors.unknownOutcome;
      if (doing && error.kind === 'server') return copy.setUp.errors.unknownOutcomeLater;
      // The limit, reached by roles added elsewhere since the read.
      if (isFull(error)) return fill(text.full, { max: MAX });
      // The API refused this title (its rules, newer than this page's): only changing it helps.
      if (error.status === 400 && doing?.post) return fill(text.refused, { title: doing.title });
    }
    return refusalText(error);
  }

  const count = fill(text.count, { count: String(inUse(saved, chosen)), max: MAX });
  return (
    <form
      ref={form}
      noValidate
      onSubmit={submit}
      aria-labelledby="set-up-title"
      aria-describedby={refusal ? refusalId : undefined}
      className="grid gap-5"
    >
      <Field
        name="title"
        label={text.jobTitle}
        hint={text.hint}
        error={error}
        value={draft}
        list={listId}
        placeholder={text.placeholder}
        autoComplete="off"
        autoCapitalize="sentences"
        enterKeyHint="done"
        // Locked while saving, like the chips; the input dims at once, so the lock shows.
        readOnly={pending}
        className={pending ? '[&_input]:opacity-60' : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          // A reason shown, about to be said or just said, no longer applies.
          if (error) {
            clearTimeout(saying.current);
            setSpoken('');
          }
          setError(null);
        }}
        onKeyDown={onKeyDown}
        action={
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-13"
            disabled={pending}
            onClick={() => {
              addDraft(true);
              titleInput()?.focus();
            }}
          >
            {text.add}
          </Button>
        }
      />
      <datalist id={listId}>
        {text.suggestions.map((title) => (
          <option key={title} value={title} />
        ))}
      </datalist>
      <fieldset
        aria-describedby={listError ? listErrorId : undefined}
        className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
      >
        <legend className="mb-2 p-0 text-[0.8125rem] font-[680] tracking-[0.01em]">
          {text.chosen}{' '}
          {/* Beside the list, not in the field's hint: an error there would hide it. */}
          <span className="font-[500] text-muted-foreground">· {count}</span>
        </legend>
        {chips.map((title) => (
          <Chip
            key={title}
            title={title}
            checked={includes(chosen, title)}
            locked={pending}
            onChange={(checked) => toggle(title, checked)}
          />
        ))}
      </fieldset>
      <p
        id={listErrorId}
        className={cn(
          'm-0 -mt-2 text-[0.8125rem] font-[650] text-danger-ink',
          !listError && 'hidden',
        )}
      >
        {listError}
      </p>
      <p role="status" className="sr-only">
        {pending && waiting ? copy.setUp.saving : spoken}
      </p>
      <p
        id={refusalId}
        role="alert"
        className={cn('m-0 text-sm font-[650] text-danger-ink', !refusal && 'sr-only')}
      >
        {refusal}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" pending={pending} pendingLabel={copy.setUp.saving}>
          {copy.setUp.continue}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={pending}>
          {copy.setUp.back}
        </Button>
      </div>
    </form>
  );
}

/**
 * A title to choose (the prototype's `.choice-chip`): a pill holding a checkbox, green with a check
 * when chosen. The check stays out of its name; the checkbox already says it is chosen.
 */
function Chip({
  title,
  checked,
  locked,
  onChange,
}: {
  title: string;
  checked: boolean;
  /** Saving: it can't change, and dims. */
  locked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        'relative inline-flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-[13px] py-2 text-sm font-[650] wrap-anywhere text-muted-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring has-focus-visible:outline-solid',
        checked
          ? 'border-2 border-green bg-green-soft px-3 font-[700] text-ink'
          : 'hover:border-line-strong hover:bg-white hover:text-ink',
        locked && 'cursor-default opacity-60',
      )}
    >
      <input
        type="checkbox"
        name="role"
        value={title}
        checked={checked}
        aria-readonly={locked || undefined}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      {checked && (
        <span aria-hidden="true" className="font-[800] text-green-ink">
          ✓
        </span>
      )}
      {title}
    </label>
  );
}

/** A title as it is kept: one space between words, none around. */
function clean(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/** Whether two titles are the same role (case aside). */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function includes(titles: readonly string[], title: string): boolean {
  return titles.some((each) => same(each, title));
}

function titlesOf(roles: readonly Role[]): string[] {
  const titles: string[] = [];
  for (const role of roles) if (!includes(titles, role.title)) titles.push(role.title);
  return titles;
}

/** The chips with any of these titles not among them yet put in front. */
function withChips(chips: readonly string[], titles: readonly string[]): string[] {
  return [...titles.filter((title) => !includes(chips, title)), ...chips];
}

/**
 * What saving `chosen` takes, from what is saved: the roles whose title is no longer chosen, and the
 * chosen titles no role has yet.
 */
export function plan(saved: readonly Role[], chosen: readonly string[]) {
  return {
    remove: saved.filter((role) => !includes(chosen, role.title)),
    add: chosen.filter((title) => !saved.some((role) => same(role.title, title))),
  };
}

/**
 * The person's changes here (from `before` to `chosen`) on top of what is saved now. `changed`:
 * what is saved differs from `before` in a way this step didn't make (a role added or removed
 * somewhere else); `titles` then keeps the person's choices, drops a chosen role removed elsewhere,
 * and adds the ones added elsewhere at the end.
 */
export function reconcile(
  before: readonly string[],
  chosen: readonly string[],
  saved: readonly string[],
  /** Titles this step changed whose answer was lost: saved or not, neither is a change elsewhere. */
  unsure: readonly string[] = [],
): { titles: string[]; changed: boolean } {
  const addedElsewhere = saved.filter(
    (title) => !includes(before, title) && !includes(chosen, title) && !includes(unsure, title),
  );
  const removedElsewhere = before.filter(
    (title) => includes(chosen, title) && !includes(saved, title) && !includes(unsure, title),
  );
  return {
    titles: [...chosen.filter((title) => !includes(removedElsewhere, title)), ...addedElsewhere],
    changed: addedElsewhere.length > 0 || removedElsewhere.length > 0,
  };
}

/**
 * How many roles these titles take: one each, plus any further saved roles sharing a chosen title
 * (saved elsewhere; shown as one chip, but the API counts each against its limit).
 */
function inUse(saved: readonly Role[], titles: readonly string[]): number {
  const firsts: string[] = [];
  let repeats = 0;
  for (const role of saved) {
    if (!includes(titles, role.title)) continue;
    if (includes(firsts, role.title)) repeats += 1;
    else firsts.push(role.title);
  }
  return titles.length + repeats;
}

/** The API's answer when the roles are at its limit. */
function isFull(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422;
}
