/**
 * SummarySelectionStatusBar - Status bar untuk SummaryReportPage
 * Menampilkan:
 * - Jumlah cell yang dipilih
 * - SUM dari nilai-nilai cell yang dipilih (mirip Excel)
 * - Nilai MIN dan MAX dari selection
 */

import React, { useState, useEffect } from 'react';

export default function SummarySelectionStatusBar({ gridApi }) {
    const [selectionStats, setSelectionStats] = useState({
        count: 0,
        sum: 0,
        min: null,
        max: null,
        avg: 0
    });

    useEffect(() => {
        if (!gridApi) {
            console.log('SummarySelectionStatusBar: gridApi not available yet');
            return;
        }

        console.log('SummarySelectionStatusBar: gridApi connected!');

        const calculateSelectionStats = () => {
            const ranges = gridApi.getCellRanges();

            console.log('calculateSelectionStats called, ranges:', ranges);

            if (!ranges || ranges.length === 0) {
                setSelectionStats({ count: 0, sum: 0, min: null, max: null, avg: 0 });
                return;
            }

            let count = 0;
            let sum = 0;
            let min = null;
            let max = null;
            const numericValues = [];

            ranges.forEach(range => {
                const startRowIdx = Math.min(range.startRow.rowIndex, range.endRow.rowIndex);
                const endRowIdx = Math.max(range.startRow.rowIndex, range.endRow.rowIndex);

                for (let rowIdx = startRowIdx; rowIdx <= endRowIdx; rowIdx++) {
                    const rowNode = gridApi.getDisplayedRowAtIndex(rowIdx);
                    if (!rowNode || !rowNode.data) continue;

                    range.columns.forEach(column => {
                        const colId = column.getColId();
                        const cellValue = rowNode.data[colId];

                        count++;

                        // Try to parse as number
                        const numValue = parseFloat(cellValue);
                        if (!isNaN(numValue) && isFinite(numValue)) {
                            numericValues.push(numValue);
                            sum += numValue;

                            if (min === null || numValue < min) {
                                min = numValue;
                            }
                            if (max === null || numValue > max) {
                                max = numValue;
                            }
                        }
                    });
                }
            });

            const avg = numericValues.length > 0 ? sum / numericValues.length : 0;

            console.log('Selection stats calculated:', { count, sum, min, max, avg });

            setSelectionStats({
                count,
                sum,
                min,
                max,
                avg
            });
        };

        // Listen for range selection changes
        const onRangeSelectionChanged = (event) => {
            console.log('rangeSelectionChanged event fired:', event);
            calculateSelectionStats();
        };

        gridApi.addEventListener('rangeSelectionChanged', onRangeSelectionChanged);

        return () => {
            if (gridApi) {
                gridApi.removeEventListener('rangeSelectionChanged', onRangeSelectionChanged);
            }
        };
    }, [gridApi]);

    // Format number with Indonesian locale
    const formatNumber = (num) => {
        if (num === null || num === undefined) return '-';
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(num);
    };

    // Don't show anything if no selection
    if (selectionStats.count === 0) {
        return (
            <div className="summary-selection-status-bar">
                <div className="status-item">
                    <span className="status-label">Siap</span>
                </div>
            </div>
        );
    }

    return (
        <div className="summary-selection-status-bar">
            <div className="status-item">
                <span className="status-label">Sel:</span>
                <span className="status-value">{selectionStats.count}</span>
            </div>

            {selectionStats.sum !== 0 && (
                <div className="status-item">
                    <span className="status-label">Sum:</span>
                    <span className="status-value status-sum">{formatNumber(selectionStats.sum)}</span>
                </div>
            )}

            {selectionStats.min !== null && (
                <div className="status-item">
                    <span className="status-label">Min:</span>
                    <span className="status-value">{formatNumber(selectionStats.min)}</span>
                </div>
            )}

            {selectionStats.max !== null && (
                <div className="status-item">
                    <span className="status-label">Max:</span>
                    <span className="status-value">{formatNumber(selectionStats.max)}</span>
                </div>
            )}

            {selectionStats.avg !== 0 && (
                <div className="status-item">
                    <span className="status-label">Avg:</span>
                    <span className="status-value">{formatNumber(selectionStats.avg)}</span>
                </div>
            )}
        </div>
    );
}
