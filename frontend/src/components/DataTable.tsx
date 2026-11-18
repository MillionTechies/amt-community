/**
 * DataTables.net, set up once for the whole app: sorting, search, paging and
 * responsive collapsing, styled in the house style (see `.amt-dt` in index.css).
 *
 * Columns give DataTables a plain value to sort and search on (`value`), and may
 * draw the cell with React (`cell`). Rows can be clicked to open them.
 */
import DtCore from 'datatables.net-dt'
import 'datatables.net-dt/css'
import DT from 'datatables.net-react'
import type { DataTableRef } from 'datatables.net-react'
import 'datatables.net-responsive-dt'
import 'datatables.net-responsive-dt/css'
import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

// Not a React hook: this registers the DataTables core library with the component.
// oxlint-disable-next-line react-hooks/rules-of-hooks
DT.use(DtCore)

export interface Col<T> {
  title: string
  /** What DataTables sorts and searches on. */
  value: (row: T) => string | number | null
  /** How the cell looks; defaults to the value. */
  cell?: (row: T) => ReactNode
  align?: 'right'
  sortable?: boolean
  /** Lower numbers stay visible longest on narrow screens. */
  priority?: number
  /** Hide from display but keep for search (e.g. an email). */
  hidden?: boolean
  width?: string
}

export function DataTable<T>({
  rows,
  columns,
  onOpen,
  pageLength = 25,
  order,
  empty = 'Nothing to show.',
  searchPlaceholder = 'Search',
  toolbar,
}: {
  rows: T[]
  columns: Col<T>[]
  /** Called with the row when it is clicked or opened with Enter. */
  onOpen?: (row: T) => void
  pageLength?: number
  /** Initial sort: column index and direction. */
  order?: [number, 'asc' | 'desc']
  empty?: string
  searchPlaceholder?: string
  /** Extra controls placed beside the search box. */
  toolbar?: ReactNode
}) {
  const table = useRef<DataTableRef>(null)
  // DataTables keeps the handlers it was created with; read the latest through a ref.
  const open = useRef(onOpen)
  open.current = onOpen

  const data = useMemo(
    () => rows.map((row) => ({ __row: row, ...Object.fromEntries(columns.map((c, i) => [`c${i}`, c.value(row) ?? ''])) })),
    [rows, columns],
  )

  const slots = useMemo(
    () =>
      Object.fromEntries(
        columns.flatMap((c, i) => (c.cell ? [[i, (_: unknown, row: { __row: T }) => <>{c.cell!(row.__row)}</>]] : [])),
      ),
    [columns],
  )

  const options = useMemo(
    () => ({
      pageLength,
      lengthMenu: [10, 25, 50, 100],
      order: order ? [order] : [],
      autoWidth: false,
      responsive: { details: { type: 'column' as const, target: 'tr' } },
      layout: {
        topStart: 'search' as const,
        topEnd: 'pageLength' as const,
        bottomStart: 'info' as const,
        bottomEnd: 'paging' as const,
      },
      language: {
        search: '',
        searchPlaceholder,
        lengthMenu: '_MENU_ per page',
        info: '_START_–_END_ of _TOTAL_',
        infoEmpty: '0 of 0',
        infoFiltered: '(filtered from _MAX_)',
        emptyTable: empty,
        zeroRecords: 'Nothing matches your search.',
        paginate: { first: '«', previous: '‹', next: '›', last: '»' },
      },
      columns: columns.map((c, i) => ({
        data: `c${i}`,
        title: c.title,
        orderable: c.sortable ?? true,
        visible: !c.hidden,
        className: c.align === 'right' ? 'dt-right' : 'dt-left',
        responsivePriority: c.priority,
        width: c.width,
      })),
      createdRow: (tr: HTMLElement, data: object) => {
        const row = data as { __row: T }
        if (!open.current) return
        tr.classList.add('is-clickable')
        tr.tabIndex = 0
        tr.addEventListener('click', (e) => {
          // Buttons and links inside a row do their own thing.
          if ((e.target as HTMLElement).closest('button, a, input, select')) return
          open.current?.(row.__row)
        })
        tr.addEventListener('keydown', (e) => e.key === 'Enter' && open.current?.(row.__row))
      },
    }),
    // Callers rebuild columns every render; their titles are what matter here.
    [columns.map((c) => c.title).join('|'), pageLength, empty, searchPlaceholder, order?.join()],
  )

  return (
    <div className="amt-dt">
      {toolbar && <div className="amt-dt__toolbar">{toolbar}</div>}
      <DT ref={table} data={data} options={options} slots={slots} className="display" />
    </div>
  )
}

/** Download rows as a CSV file. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const quote = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [header.map(quote).join(','), ...rows.map((r) => r.map(quote).join(','))]
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
