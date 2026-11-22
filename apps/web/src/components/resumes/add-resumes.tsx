import { MAX_DOCUMENTS } from '@jobdeputy/shared/documents';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AlertIcon, DocumentIcon, UploadIcon } from '@/components/icons.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { copy, fill } from '@/copy/index.ts';
import { ACCEPT, checkFile, type Document } from '@/lib/api/documents.ts';
import { useApi } from '@/lib/api/index.ts';
import { cn } from '@/lib/utils.ts';
import { stageLine } from './document-status.ts';
import { pickRefusal, sendResume, useDropOnlyOn, useFileDrop } from './send-resume.ts';

/** A file being added: on its way up, or not added, with why (and whether sending it again may help). */
interface Adding {
  id: number;
  file: File;
  name: string;
  progress: number;
  failed?: { reason: string; canRetry: boolean };
}

/**
 * The Library's way in (#33 piece 6b2, the round 7 prototype's documents-preview upload zone):
 * résumés dropped or chosen, several at once, each checked here and sent with its progress shown
 * in the list of files being added. Once a file is in, it joins the library (`onSent`), where the
 * server's check is followed; one not added stays in the list with why, to send again or dismiss.
 * The library keeps 10: files on their way count, and a full library takes no more.
 */
export function AddResumes({
  count,
  onSent,
  say,
  children,
}: {
  /** The library's list, under the files being added (one stack, as in the prototype). */
  children: ReactNode;
  /** How many the library holds now. */
  count: number;
  /** Puts a file that is in into the library; the file is counted here until it is there. */
  onSent: (document: Document) => Promise<void>;
  say: (words: string) => void;
}) {
  const text = copy.resumesPage.upload;
  const api = useApi();
  const [adding, setAdding] = useState<Adding[]>([]);
  const zone = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const lines = useRef(new Map<number, HTMLSpanElement>());
  const serial = useRef(0);
  // The uploads under way (Cancel stops one; leaving the page stops them all).
  const sending = useRef(new Map<number, AbortController>());
  const here = useRef(true);
  useEffect(() => {
    here.current = true;
    const under = sending.current;
    return () => {
      here.current = false;
      for (const controller of under.values()) controller.abort();
    };
  }, []);
  useDropOnlyOn(zone);
  const drop = useFileDrop(addAll);

  const full = count + adding.filter((each) => !each.failed).length >= MAX_DOCUMENTS;
  const fullLine = text.said.full;

  function update(id: number, change: (each: Adding) => Adding) {
    if (!here.current) return;
    setAdding((now) => now.map((each) => (each.id === id ? change(each) : each)));
  }

  function forget(id: number) {
    setAdding((now) => now.filter((each) => each.id !== id));
  }

  /** Focus that was on a row going away goes to Choose a file. */
  function focusChooseIfIn(id: number) {
    const row = lines.current.get(id)?.closest('li');
    if (row?.contains(globalThis.document.activeElement)) choose.current?.focus();
  }

  function addAll(files: readonly File[]) {
    if (files.length === 0) return;
    if (full) {
      say(fullLine);
      return;
    }
    // Newest on top, as the library lists them; what each one did is said at once (a line said
    // after another in the same moment would cut it off).
    say(files.map(add).join(' '));
  }

  /** Takes in one file: sent, or listed as not added. What happened, in words. */
  function add(file: File): string {
    serial.current += 1;
    const id = serial.current;
    const checked = checkFile(file);
    // The uploads under way count before the list on screen has caught up with them.
    const noRoom = count + sending.current.size >= MAX_DOCUMENTS;
    if (!checked.ok || noRoom) {
      const failed = !checked.ok
        ? { reason: pickRefusal(checked.reason, file.name), canRetry: false }
        : // Sent again once there is room.
          {
            reason: fill(text.noRoom, { name: file.name, max: String(MAX_DOCUMENTS) }),
            canRetry: true,
          };
      setAdding((now) => [{ id, file, name: file.name, progress: 0, failed }, ...now]);
      return failed.reason;
    }
    setAdding((now) => [{ id, file, name: checked.input.fileName, progress: 0 }, ...now]);
    void send(id, file, checked.input);
    return fill(copy.setUp.resume.said.uploading, { name: checked.input.fileName });
  }

  async function send(id: number, file: File, input: { fileName: string; contentType: string }) {
    const name = input.fileName;
    const controller = new AbortController();
    sending.current.set(id, controller);
    const sent = await sendResume(api, file, input, {
      signal: controller.signal,
      onProgress: (progress) => update(id, (each) => ({ ...each, progress })),
    });
    // Counted as under way until the library has it, so a full library never looks to have room.
    if (sent.kind === 'sent' && here.current) await onSent(sent.document);
    sending.current.delete(id);
    if (!here.current) return;
    if (sent.kind === 'failed') {
      const { reason, canRetry } = sent;
      update(id, (each) => ({ ...each, failed: { reason, canRetry } }));
      say(fill(text.said.failed, { name, reason }));
      return;
    }
    focusChooseIfIn(id);
    forget(id);
    say(
      fill(
        sent.kind === 'cancelled'
          ? copy.setUp.resume.said.cancelled
          : copy.setUp.resume.said.checking,
        {
          name,
        },
      ),
    );
  }

  function retry(entry: Adding) {
    if (full) {
      say(fullLine);
      return;
    }
    const checked = checkFile(entry.file);
    if (!checked.ok) return;
    flushSync(() =>
      update(entry.id, ({ failed: _, ...each }) => ({
        ...each,
        name: checked.input.fileName,
        progress: 0,
      })),
    );
    // Its Try again is gone: focus goes to the file's line, where Enter does nothing.
    lines.current.get(entry.id)?.focus();
    void send(entry.id, entry.file, checked.input);
    say(fill(copy.setUp.resume.said.uploading, { name: checked.input.fileName }));
  }

  function dismiss(entry: Adding) {
    focusChooseIfIn(entry.id);
    forget(entry.id);
    say(fill(text.said.dismissed, { name: entry.name }));
  }

  return (
    <div className="grid gap-6">
      <div className="@container">
        {/* The zone takes dropped files; its button (and the hidden picker) is the way in for
            everyone else, so the zone itself is not a control. */}
        <div
          ref={zone}
          data-dragging={(drop.dragging && !full) || undefined}
          {...drop.handlers}
          // With room, the parts go on one line (icon, words, button), so the zone is only as tall
          // as its words; narrower, a centred stack.
          className="group grid justify-items-center gap-2 rounded-[22px] border-[1.5px] border-dashed border-line-strong bg-surface p-[21px] text-center transition-colors duration-180 data-dragging:border-green-line data-dragging:bg-green-wash sm:p-[34px] @min-[640px]:grid-cols-[auto_minmax(0,1fr)_auto] @min-[640px]:gap-x-[21px] @min-[640px]:gap-y-1 @min-[640px]:justify-items-start @min-[640px]:text-start @min-[640px]:[grid-template-areas:'icon_title_action'_'icon_meta_action']"
        >
          <span
            aria-hidden="true"
            className="mb-1 grid size-[55px] place-items-center rounded-full bg-paper-deep text-ink-soft transition-colors duration-180 group-data-dragging:bg-green-soft group-data-dragging:text-green-ink @min-[640px]:mb-0 @min-[640px]:[grid-area:icon]"
          >
            <UploadIcon />
          </span>
          <p className="m-0 text-[0.9375rem] font-[700] @min-[640px]:self-end @min-[640px]:[grid-area:title]">
            {full ? text.fullTitle : text.dropTitle}
          </p>
          <p
            id="library-drop-meta"
            className="m-0 max-w-[440px] text-xs text-muted-foreground group-data-dragging:text-ink-soft @min-[640px]:self-start @min-[640px]:[grid-area:meta]"
          >
            {full ? fill(text.fullMeta, { max: String(MAX_DOCUMENTS) }) : text.dropMeta}
          </p>
          <Button
            ref={choose}
            className="mt-2 @min-[640px]:mt-0 @min-[640px]:[grid-area:action]"
            aria-describedby="library-drop-meta"
            // Full: presses are ignored, and the words it is described by say why (aria-disabled,
            // so focus stays on it).
            aria-disabled={full || undefined}
            onClick={() => picker.current?.click()}
          >
            {text.choose}
          </Button>
          <input
            ref={picker}
            type="file"
            accept={ACCEPT}
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              // Cleared, so choosing the same file again still counts.
              event.target.value = '';
              addAll(files);
            }}
          />
        </div>
      </div>
      <div className="grid gap-[13px]">
        {adding.length > 0 && (
          <ol aria-label={text.listName} className="@container m-0 grid list-none gap-2 p-0">
            {adding.map((entry) => (
              <li
                key={entry.id}
                data-state={entry.failed ? 'failed' : 'uploading'}
                className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-x-[13px] gap-y-2 rounded-[13px] border border-line bg-surface p-[13px] @md:grid-cols-[34px_minmax(0,1fr)_auto]"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-[34px] place-items-center rounded-[11px] bg-paper-deep text-ink-soft',
                    entry.failed && 'text-danger-ink',
                  )}
                >
                  {entry.failed ? <AlertIcon /> : <DocumentIcon />}
                </span>
                <span
                  ref={(node) => {
                    if (node) lines.current.set(entry.id, node);
                    else lines.current.delete(entry.id);
                  }}
                  tabIndex={-1}
                  className="grid min-w-0 gap-0.5 rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring focus-visible:outline-solid"
                >
                  <span className="text-[0.9375rem] font-[650] wrap-anywhere">{entry.name}</span>
                  <span className="text-[0.8125rem] text-muted-foreground">
                    {entry.failed ? text.notAdded : stageLine('uploading')}
                  </span>
                  {entry.failed && (
                    <span className="text-[0.8125rem] text-danger-ink">{entry.failed.reason}</span>
                  )}
                </span>
                <span className="col-start-2 flex flex-wrap items-center gap-2 @md:col-start-auto @md:justify-end">
                  {!entry.failed ? (
                    <Button
                      key="cancel"
                      variant="outline"
                      onClick={() => sending.current.get(entry.id)?.abort()}
                    >
                      {copy.setUp.resume.cancel}
                      <span className="sr-only"> {entry.name}</span>
                    </Button>
                  ) : (
                    <>
                      {entry.failed.canRetry && (
                        <Button key="retry" variant="outline" onClick={() => retry(entry)}>
                          {text.retry}
                          <span className="sr-only"> {entry.name}</span>
                        </Button>
                      )}
                      <Button key="dismiss" variant="outline" onClick={() => dismiss(entry)}>
                        {text.dismiss}
                        <span className="sr-only"> {entry.name}</span>
                      </Button>
                    </>
                  )}
                </span>
                {!entry.failed && (
                  <Progress
                    label={fill(text.uploading, { name: entry.name })}
                    value={entry.progress * 100}
                    className="col-span-full"
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        {children}
      </div>
    </div>
  );
}
