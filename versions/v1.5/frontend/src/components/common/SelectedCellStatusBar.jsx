import React, { useState, useEffect } from 'react';
import { getCellAddress } from '../../utils/FormulaRegistry';

export default function SelectedCellStatusBar(props) {
  const [address, setAddress] = useState('Siap');
  const [selectionCount, setSelectionCount] = useState(0);

  useEffect(() => {
    const api = props.api;
    if (!api) return;

    const updateAddress = (colId, rowIndex) => {
        if (colId && rowIndex !== null && rowIndex !== undefined) {
            setAddress(getCellAddress(colId, rowIndex));
        } else {
            setAddress('Siap');
        }
    };

    const updateSelectionCount = () => {
        const ranges = api.getCellRanges();
        let count = 0;
        if (ranges && ranges.length > 0) {
            ranges.forEach(range => {
                const rows = Math.abs(range.endRow.rowIndex - range.startRow.rowIndex) + 1;
                const cols = range.columns.length;
                count += rows * cols;
            });
        }
        setSelectionCount(count);
    };

    const onCellClicked = (event) => {
        if (event.colDef) {
            updateAddress(event.colDef.field, event.rowIndex);
        }
    };
    
    const onCellFocused = (event) => {
         if (event.column) {
             updateAddress(event.column.getColId(), event.rowIndex);
         }
    };

    const onRangeSelectionChanged = () => {
        updateSelectionCount();
    };

    api.addEventListener('cellClicked', onCellClicked);
    api.addEventListener('cellFocused', onCellFocused);
    api.addEventListener('rangeSelectionChanged', onRangeSelectionChanged);

    return () => {
      api.removeEventListener('cellClicked', onCellClicked);
      api.removeEventListener('cellFocused', onCellFocused);
      api.removeEventListener('rangeSelectionChanged', onRangeSelectionChanged);
    };
  }, [props.api]);

  return (
    <div className="ag-status-name-value" style={{ margin: '0 10px', display: 'flex', alignItems: 'center', fontSize: '13px' }}>
      <span className="component-status-label" style={{ marginRight: '5px', color: '#555' }}>Posisi: </span>
      <span className="component-status-value" style={{ fontWeight: 'bold', color: '#333', fontFamily: 'monospace', marginRight: '15px' }}>{address}</span>
      
      <span className="component-status-label" style={{ marginRight: '5px', color: '#555' }}>Sel: </span>
      <span className="component-status-value" style={{ fontWeight: 'bold', color: '#333' }}>{selectionCount}</span>
    </div>
  );
}
