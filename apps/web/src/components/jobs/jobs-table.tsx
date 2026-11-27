import { type ReactNode, useState } from 'react';
import { copy, fill } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.jobsTable;

/**
 * One column of a JobsTable. `cell` draws it; `sortValue` makes it sortable (in the browser, so
 * only for a table that holds every row: a sort of one page would be wrong). A missing value
 * sorts last whichever way.
 */
export interface JobsColumn<Row> {
  key: string;
  label: string;
  cell: (row: Row) => ReactNode;
  sortValue?: (row: Row) => string | number | undefined;
  /** The way a first press sorts it: highest first suits fits, dates and counts. */
  sortFirst?: SortDirection;
  /** Numbers: tabular, and at the cell's end (at its start once rows stack). */
  numeric?: boolean;
  /** The row's name (its first cell): on a stacked row it leads, with no label beside it. */
  title?: boolean;
}

export type SortDirection = 'ascending' | 'descending';

export interface JobsSort {
  key: string;
  direction: SortDirection;
}

/** The skeleton a JobsTable's first load shows (QueryRegion), the same on every tab. */
export const JOBS_TABLE_SKELETON = { kind: 'rows', rows: 4 } as const;

/**
 * The jobs area's one table (#52, the round 7 prototype's `.data-table`): Search's runs, Matches
 * and Applications all show their rows in it, so columns, row height, sorting and empty states
 * look and work the same in all three.
 *
 * A real table: sortable headers are buttons, and their `th` carries `aria-sort`. The wrap is a
 * size container: narrower than 695px the rows stack, each cell after the title labelled from its
 * column (`data-label`), so a phone reads a row top to bottom; the header row stays for screen
 * readers.
 * With no rows, `empty` fills one full-width cell. `openKey` marks the row whose job is open
 * beside the table (a green edge); a cell can stretch its button over the row (`ROW_BUTTON_CLASS`).
 */
export function JobsTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  empty,
  sort: initialSort,
  openKey,
}: {
  /** The table's name (its caption, read out; not shown). */
  label: string;
  columns: JobsColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty: ReactNode;
  /** The order it opens in; without one, the rows' own (the server's). */
  sort?: JobsSort;
  /** The row open beside the table, by its `rowKey`. */
  openKey?: string | undefined;
}) {
  const [sort, setSort] = useState<JobsSort | undefined>(initialSort);
  const sortBy = sort && columns.find((column) => column.key === sort.key);
  const shown = sort && sortBy?.sortValue ? sortRows(rows, sortBy.sortValue, sort.direction) : rows;
  function press(column: JobsColumn<Row>) {
    const first = column.sortFirst ?? 'ascending';
    setSort((was) => ({
      key: column.key,
      direction:
        was?.key === column.key
          ? was.direction === 'ascending'
            ? 'descending'
            : 'ascending'
          : first,
    }));
  }
  return (
    // The size container for the stacked rows. Rows stack before columns could run out of room,
    // so it never scrolls sideways (a scrolling one would need to be focusable).
    <div className="relative max-w-full min-w-0 overflow-hidden rounded-[22px] border border-line bg-paper @container">
      <table className="w-full border-separate border-spacing-0 text-start text-sm/[1.4] text-ink @max-[694px]:block">
        <caption className="sr-only">{label}</caption>
        <thead className="@max-[694px]:sr-only">
          <tr>
            {columns.map((column) => {
              const sorted = sort?.key === column.key ? sort.direction : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={column.sortValue ? (sorted ?? 'none') : undefined}
                  className={cn(
                    HEAD_CLASS,
                    column.sortValue ? 'p-0' : 'p-[13px]',
                    column.numeric && 'text-end',
                  )}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => press(column)}
                      className={cn(
                        'flex min-h-11 w-full cursor-pointer items-center gap-1.5 bg-transparent px-[13px] text-[length:inherit] font-[inherit] tracking-[inherit] whitespace-nowrap uppercase transition-colors duration-180 outline-none hover:bg-surface-strong focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-green focus-visible:outline-solid',
                        column.numeric && 'justify-end',
                      )}
                    >
                      {column.label}
                      <span aria-hidden="true" className="tracking-normal">
                        {sorted === 'ascending' ? '↑' : sorted === 'descending' ? '↓' : '↑↓'}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="@max-[694px]:block">
          {shown.length === 0 ? (
            <tr className="@max-[694px]:block">
              <td
                colSpan={columns.length}
                className="border-t border-line px-[13px] py-[21px] text-center text-sm text-muted-foreground @max-[694px]:block @max-[694px]:border-t-0"
              >
                {empty}
              </td>
            </tr>
          ) : (
            shown.map((row) => (
              <tr
                key={rowKey(row)}
                data-open={openKey !== undefined && rowKey(row) === openKey ? '' : undefined}
                className={ROW_CLASS}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={column.title ? undefined : column.label}
                    className={cn(
                      CELL_CLASS,
                      column.title ? TITLE_CELL_CLASS : LABELLED_CELL_CLASS,
                      column.numeric && 'text-end tabular-nums @max-[694px]:text-start',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {/* A new order is said once (a header's own aria-sort is read only when it is reached). */}
      <p role="status" className="sr-only">
        {sort && sortBy ? fill(text.sorted[sort.direction], { column: sortBy.label }) : ''}
      </p>
    </div>
  );
}

/** Rows ordered by `value`, a missing value last either way; ties keep their order. */
export function sortRows<Row>(
  rows: Row[],
  value: (row: Row) => string | number | undefined,
  direction: SortDirection,
): Row[] {
  const sign = direction === 'ascending' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => {
      if (a.value === undefined || b.value === undefined) {
        return a.value === b.value ? a.index - b.index : a.value === undefined ? 1 : -1;
      }
      const order =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), copy.locale, { sensitivity: 'base' });
      return order === 0 ? a.index - b.index : order * sign;
    })
    .map((each) => each.row);
}

const HEAD_CLASS =
  'bg-paper-deep text-start align-middle text-xs/[1.3] font-[750] tracking-[0.12em] text-ink-soft uppercase first:rounded-ss-[21px] last:rounded-se-[21px]';

/**
 * A row: a lift on hover; the open one washed green, with a green edge at its start (an outline
 * in forced colours); stacked, a grid with a line between rows. Relative, for a stretched button.
 */
const ROW_CLASS =
  'group/row relative [&[data-open]_.text-muted-foreground]:text-ink-soft data-open:forced-colors:outline-2 data-open:forced-colors:-outline-offset-2 data-open:forced-colors:outline-solid @max-[694px]:grid @max-[694px]:gap-y-1 @max-[694px]:p-[13px] @max-[694px]:not-first:border-t @max-[694px]:not-first:border-line @max-[694px]:hover:bg-surface-strong @max-[694px]:data-open:bg-green-wash @max-[694px]:data-open:shadow-[inset_3px_0_0_var(--color-green)]';

const CELL_CLASS =
  'h-[52px] border-t border-line p-[13px] align-middle transition-colors duration-180 group-hover/row:bg-surface-strong group-data-open/row:bg-green-wash group-data-open/row:first:shadow-[inset_3px_0_0_var(--color-green)] @max-[694px]:h-auto @max-[694px]:border-t-0 @max-[694px]:px-0 @max-[694px]:py-1 @max-[694px]:group-hover/row:bg-transparent @max-[694px]:group-data-open/row:bg-transparent @max-[694px]:group-data-open/row:first:shadow-none';

/**
 * A button in a cell that the whole row presses (its `::after` covers the row, which is
 * relative): the row is one target, and its one tab stop.
 */
export const ROW_BUTTON_CLASS =
  'cursor-pointer border-0 bg-transparent p-0 text-start font-[inherit] text-[length:inherit] text-ink underline-offset-4 outline-none after:absolute after:inset-0 after:content-[""] hover:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid';

const TITLE_CELL_CLASS = 'font-[680] @max-[694px]:block';

/**
 * Stacked, its column's name sits beside it, as the prototype's `td::before` (with empty alt
 * text: the header already names the cell, so it isn't read twice).
 */
const LABELLED_CELL_CLASS =
  '@max-[694px]:grid @max-[694px]:grid-cols-[minmax(89px,34%)_minmax(0,1fr)] @max-[694px]:justify-items-start @max-[694px]:gap-[13px] @max-[694px]:before:text-xs/[1.4] @max-[694px]:before:font-[650] @max-[694px]:before:text-muted-foreground @max-[694px]:before:content-[attr(data-label)_/_""]';

/** A JobsTable's `empty`: what would be here, and where to go for it; the same on every tab. */
export function TableEmpty({
  title,
  line,
  action,
}: {
  title: string;
  line: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-1 py-[13px]">
      <p className="m-0 font-[700] text-ink">{title}</p>
      <p className="m-0">{line}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
