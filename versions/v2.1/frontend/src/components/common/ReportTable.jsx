import React, { useMemo, useRef } from 'react';
import '../../styles/ReportTable.css';

/**
 * ReportTable - Reusable multi-level header table component
 * 
 * Matches the style of CustomPayrollTable (dark navy headers, zebra rows, sticky cols).
 * Configured via a columnDefs array with multi-level header support.
 * 
 * USAGE:
 * ```jsx
 * const columns = [
 *   { field: 'no', headers: ['IDENTITAS', null, 'NO'], w: 50, className: 'text-center' },
 *   { field: 'nama', headers: ['IDENTITAS', null, 'NAMA'], w: 200, className: 'text-left', sticky: true, left: 50 },
 *   { field: 'amount', headers: ['PENGGAJIAN', 'TUNJANGAN', 'JUMLAH'], w: 130, className: 'text-right', format: 'currency' },
 * ];
 * 
 * <ReportTable
 *   columns={columns}
 *   data={rowData}
 *   footerData={{ amount: 12345678 }}
 *   footerLabel="TOTAL"
 *   footerLabelColSpan={3}
 * />
 * ```
 * 
 * Column definition:
 * - field: string — key to access from row data (supports nested like 'details.variables.X')
 * - headers: string[] — multi-level header labels (null = merge with level above)
 * - w: number — width in px
 * - className: string — 'text-right', 'text-center', 'text-left', 'font-bold'
 * - sticky: boolean — make column sticky
 * - left: number — sticky left offset
 * - format: 'currency' | 'decimal' | 'number' — auto-format
 * - render: (row, rowIndex) => React.Node — custom render function
 * - valueGetter: (row) => any — compute value from row
 */

const formatCurrency = (val) => new Intl.NumberFormat('id-ID').format(val || 0);

const getNestedValue = (obj, path) => {
    if (!path || !obj) return undefined;
    return path.split('.').reduce((o, key) => (o && o[key] !== undefined) ? o[key] : undefined, obj);
};

// Render header label with \n converted to <br/>
const renderLabel = (label) => {
    if (!label) return '';
    const parts = String(label).split('\n');
    if (parts.length === 1) return label;
    return parts.map((part, i) => (
        <React.Fragment key={i}>{part}{i < parts.length - 1 && <br />}</React.Fragment>
    ));
};

function buildHeaderRows(columns) {
    // Determine max header depth
    const maxDepth = Math.max(...columns.map(c => (c.headers || []).length));

    // Normalize all headers to maxDepth
    const normalizedCols = columns.map(col => {
        const headers = col.headers || [''];
        while (headers.length < maxDepth) {
            headers.push(null);
        }
        return { ...col, headers };
    });

    // Build header rows with rowspan/colspan
    const headerRows = [];

    for (let level = 0; level < maxDepth; level++) {
        const cells = [];
        let i = 0;

        while (i < normalizedCols.length) {
            const col = normalizedCols[i];
            const label = col.headers[level];

            // Skip if this cell is already covered by a rowspan from above
            if (label === null) {
                // Check if a parent level handles this via rowspan
                let handledByParent = false;
                for (let pl = level - 1; pl >= 0; pl--) {
                    const parentLabel = col.headers[pl];
                    if (parentLabel !== null) {
                        // Check if parent's rowspan would cover this level
                        let parentEnd = level;
                        for (let fl = pl + 1; fl < maxDepth; fl++) {
                            if (col.headers[fl] === null) parentEnd = fl;
                            else break;
                        }
                        if (parentEnd >= level) {
                            handledByParent = true;
                        }
                        break;
                    }
                }
                if (handledByParent) {
                    i++;
                    continue;
                }
            }

            // Calculate colspan: how many adjacent columns share same label at this level
            let colspan = 1;
            if (label !== null) {
                for (let j = i + 1; j < normalizedCols.length; j++) {
                    if (normalizedCols[j].headers[level] === label) {
                        // Also verify parent levels match
                        let parentsMatch = true;
                        for (let pl = 0; pl < level; pl++) {
                            if (normalizedCols[j].headers[pl] !== normalizedCols[i].headers[pl]) {
                                parentsMatch = false;
                                break;
                            }
                        }
                        if (parentsMatch) colspan++;
                        else break;
                    } else {
                        break;
                    }
                }
            }

            // Calculate rowspan: how many levels below are null
            let rowspan = 1;
            if (label !== null) {
                for (let rl = level + 1; rl < maxDepth; rl++) {
                    if (col.headers[rl] === null) rowspan++;
                    else break;
                }
            }

            const isSticky = col.sticky;
            const stickyClass = isSticky ? ' sticky-col' : '';

            cells.push({
                label: label || '',
                colspan,
                rowspan,
                className: stickyClass,
                style: isSticky ? { left: col.left || 0 } : {}
            });

            i += colspan;
        }

        headerRows.push(cells);
    }

    return headerRows;
}

export default function ReportTable({
    columns = [],
    data = [],
    footerData = null,
    footerLabel = 'TOTAL',
    footerLabelColSpan = 1,
    onRowClick = null,
    statusBar = null,
    className = '',
    fontSize = 12,
}) {
    const tableRef = useRef(null);

    const headerRows = useMemo(() => buildHeaderRows(columns), [columns]);

    const getCellValue = (row, col) => {
        if (col.valueGetter) return col.valueGetter(row);
        return getNestedValue(row, col.field);
    };

    const formatValue = (val, col) => {
        if (val === null || val === undefined) return '-';
        if (col.format === 'currency') return formatCurrency(val);
        if (col.format === 'number') return new Intl.NumberFormat('id-ID').format(val);
        if (col.format === 'decimal') return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2 }).format(val);
        return val;
    };

    return (
        <div className={`report-table-wrapper ${className}`}>
            <div className="report-table-container" ref={tableRef}>
                <table className="report-table" style={{ fontSize: `${fontSize}px` }}>
                    <thead>
                        {headerRows.map((row, ri) => (
                            <tr key={ri}>
                                {row.map((cell, ci) => (
                                    <th
                                        key={ci}
                                        colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                                        rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                                        className={cell.className}
                                        style={cell.style}
                                    >
                                        {renderLabel(cell.label)}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {data.map((row, rowIndex) => {
                            // Group Header Row
                            if (row._type === 'group_header') {
                                return (
                                    <tr key={row._id || `gh-${rowIndex}`} className="group-header-row">
                                        <td colSpan={columns.length}>{row._label || ''}</td>
                                    </tr>
                                );
                            }
                            // Group Total Row
                            if (row._type === 'group_total') {
                                return (
                                    <tr key={row._id || `gt-${rowIndex}`} className="group-total-row">
                                        {columns.map((col, ci) => {
                                            const val = getCellValue(row, col);
                                            const stickyClass = col.sticky ? ' sticky-col' : '';
                                            const stickyStyle = col.sticky ? { left: col.left || 0 } : {};
                                            return (
                                                <td
                                                    key={ci}
                                                    className={`${col.className || ''}${stickyClass}`}
                                                    style={{ width: col.w, minWidth: col.w, maxWidth: col.w, ...stickyStyle }}
                                                >
                                                    {col.render ? col.render(row, rowIndex) : formatValue(val, col)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            }

                            // Normal Row
                            const rowClass = rowIndex % 2 === 0 ? 'row-even' : 'row-odd';
                            return (
                                <tr
                                    key={row._id || `r-${rowIndex}`}
                                    className={rowClass}
                                    onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
                                    style={onRowClick ? { cursor: 'pointer' } : undefined}
                                >
                                    {columns.map((col, ci) => {
                                        const val = getCellValue(row, col);
                                        const stickyClass = col.sticky ? ' sticky-col' : '';
                                        const stickyStyle = col.sticky ? { left: col.left || 0 } : {};
                                        return (
                                            <td
                                                key={ci}
                                                className={`${col.className || ''}${stickyClass}`}
                                                style={{ width: col.w, minWidth: col.w, maxWidth: col.w, ...stickyStyle }}
                                            >
                                                {col.render ? col.render(row, rowIndex) : formatValue(val, col)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                    {footerData && (
                        <tfoot>
                            <tr>
                                {columns.map((col, ci) => {
                                    // First N columns merged into label
                                    if (ci === 0) {
                                        const stickyClass = col.sticky ? ' sticky-col' : '';
                                        const stickyStyle = col.sticky ? { left: col.left || 0 } : {};
                                        return (
                                            <td
                                                key={ci}
                                                colSpan={footerLabelColSpan}
                                                className={`text-right font-bold${stickyClass}`}
                                                style={stickyStyle}
                                            >
                                                {footerLabel}
                                            </td>
                                        );
                                    }
                                    if (ci < footerLabelColSpan) return null;

                                    const val = getCellValue(footerData, col);
                                    const stickyClass = col.sticky ? ' sticky-col' : '';
                                    const stickyStyle = col.sticky ? { left: col.left || 0 } : {};
                                    return (
                                        <td
                                            key={ci}
                                            className={`${col.className || ''}${stickyClass} font-bold`}
                                            style={stickyStyle}
                                        >
                                            {val !== undefined && val !== null ? formatValue(val, col) : ''}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
            {statusBar && (
                <div className="report-table-status-bar">
                    {statusBar}
                </div>
            )}
        </div>
    );
}
