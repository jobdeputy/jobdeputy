import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type JobsColumn,
  JobsTable,
  sortRows,
  TableEmpty,
} from '../src/components/jobs/jobs-table.tsx';

afterEach(cleanup);

interface Row {
  id: string;
  title: string;
  fit?: number;
}

const ROWS: Row[] = [
  { id: 'a', title: 'beta', fit: 50 },
  { id: 'b', title: 'Alpha' },
  { id: 'c', title: 'gamma', fit: 90 },
];

const COLUMNS: JobsColumn<Row>[] = [
  { key: 'title', label: 'Job', title: true, cell: (row) => row.title, sortValue: (r) => r.title },
  {
    key: 'fit',
    label: 'Fit',
    numeric: true,
    sortFirst: 'descending',
    cell: (row) => row.fit ?? '—',
    sortValue: (row) => row.fit,
  },
  { key: 'note', label: 'Note', cell: () => 'n' },
];

function renderTable(rows = ROWS) {
  render(
    <JobsTable
      label="Jobs"
      columns={COLUMNS}
      rows={rows}
      rowKey={(row) => row.id}
      empty={<TableEmpty title="Nothing yet" line="They land here." />}
    />,
  );
  return screen.getByRole('table', { name: 'Jobs' });
}

/** The table's body rows, by their first cell. */
const order = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });

describe('JobsTable (#52)', () => {
  it('shows the rows in their own order, each cell labelled by its column for stacked rows', () => {
    renderTable();
    expect(order()).toEqual(['beta', 'Alpha', 'gamma']);
    const cells = within(screen.getAllByRole('row')[1] as HTMLElement).getAllByRole('cell');
    // The title leads a stacked row unlabelled; the others carry their column's name.
    expect(cells.map((cell) => cell.getAttribute('data-label'))).toEqual([null, 'Fit', 'Note']);
    // Sortable columns say they aren't sorted; the others say nothing.
    expect(header('Job').getAttribute('aria-sort')).toBe('none');
    expect(header('Note').getAttribute('aria-sort')).toBeNull();
    expect(within(header('Note')).queryByRole('button')).toBeNull();
  });

  it('sorts by a column, its first way first, then back the other way, and says so', () => {
    renderTable();
    fireEvent.click(within(header('Fit')).getByRole('button'));
    // Highest first, a missing fit last.
    expect(order()).toEqual(['gamma', 'beta', 'Alpha']);
    expect(header('Fit').getAttribute('aria-sort')).toBe('descending');
    expect(header('Job').getAttribute('aria-sort')).toBe('none');
    expect(screen.getByRole('status').textContent).toBe('Sorted by Fit, descending.');
    fireEvent.click(within(header('Fit')).getByRole('button'));
    // Still last: a missing value is last whichever way.
    expect(order()).toEqual(['beta', 'gamma', 'Alpha']);
    expect(header('Fit').getAttribute('aria-sort')).toBe('ascending');
    // Another column starts at its own first way (A to Z, ignoring case).
    fireEvent.click(within(header('Job')).getByRole('button'));
    expect(order()).toEqual(['Alpha', 'beta', 'gamma']);
    expect(header('Job').getAttribute('aria-sort')).toBe('ascending');
    expect(header('Fit').getAttribute('aria-sort')).toBe('none');
  });

  it('fills one full-width cell with its empty state when there are no rows', () => {
    renderTable([]);
    const cell = screen.getByRole('cell');
    expect(cell.getAttribute('colspan')).toBe('3');
    expect(cell.textContent).toBe('Nothing yet' + 'They land here.');
    // The header row stays, so the table still says what it would hold.
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });
});

describe('sortRows', () => {
  it('keeps ties in their order, and missing values last both ways', () => {
    const rows = [
      { n: 2, id: 'x' },
      { n: undefined, id: 'u' },
      { n: 1, id: 'y' },
      { n: 2, id: 'z' },
    ];
    const ids = (direction: 'ascending' | 'descending') =>
      sortRows(rows, (row) => row.n, direction).map((row) => row.id);
    expect(ids('ascending')).toEqual(['y', 'x', 'z', 'u']);
    expect(ids('descending')).toEqual(['x', 'z', 'y', 'u']);
  });
});

describe('the open row (#52 PR C)', () => {
  it('marks only the row whose job is open', () => {
    render(
      <JobsTable
        label="Jobs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        openKey="c"
        empty="none"
      />,
    );
    const open = screen
      .getAllByRole('row')
      .filter((row) => row.hasAttribute('data-open'))
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
    expect(open).toEqual(['gamma']);
  });
});
