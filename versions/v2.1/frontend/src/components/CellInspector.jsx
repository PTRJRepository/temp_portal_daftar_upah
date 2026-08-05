import React, { useMemo, useState, useEffect } from 'react';
import { FormulaRegistry, getCellAddress } from '../utils/FormulaRegistry';
import ComponentMetadataViewer from './common/ComponentMetadataViewer';

export default function CellInspector({ cell, onClose }) {
  if (!cell) return null;

  const { data, colId, rowIndex, value } = cell;
  const registryEntry = FormulaRegistry[colId];
  
  const address = getCellAddress(colId, rowIndex);
  const storageKey = `cell_note_${data.id || data.nik}_${colId}`;

  const [note, setNote] = useState('');

  useEffect(() => {
      const saved = localStorage.getItem(storageKey);
      setNote(saved || '');
  }, [storageKey]);

  const handleSaveNote = () => {
      localStorage.setItem(storageKey, note);
      alert('Note saved locally!');
  };
  
  // Determine inputs and their values
  const inputs = useMemo(() => {
      if (!registryEntry || !registryEntry.inputs) return [];
      
      return registryEntry.inputs.flatMap(key => {
          if (key.endsWith('*')) {
              // Wildcard expansion
              const prefix = key.replace('*', '');
              return Object.keys(data)
                  .filter(k => k.startsWith(prefix))
                  .map(k => ({ key: k, value: data[k] }));
          }
          return [{ key, value: data[key] }];
      });
  }, [data, registryEntry]);

  // Verify Calculation
  const verification = useMemo(() => {
      if (!registryEntry || !registryEntry.calculate) return null;
      const calculated = registryEntry.calculate(data);
      const rendered = Number(value) || 0;
      const diff = Math.abs(calculated - rendered);
      
      return {
          calculated,
          match: diff < 0.01, // Float tolerance
          diff
      };
  }, [data, value, registryEntry]);

  const formatVal = (v) => {
      if (typeof v === 'number') return v.toLocaleString('id-ID');
      return v;
  };

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl border-l border-gray-200 p-4 overflow-y-auto z-50">
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <h2 className="text-lg font-bold text-gray-800">Cell Inspector</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-red-500 font-bold">✕</button>
      </div>

      {/* Identity */}
      <div className="mb-6">
        <div className="text-sm text-gray-500 mb-1">Address</div>
        <div className="text-2xl font-mono font-bold text-blue-600">{address}</div>
        <div className="text-xs text-gray-400 mt-1">Column: {colId} | Row: {rowIndex + 1}</div>
      </div>

      {/* Current Value */}
      <div className="mb-6 bg-gray-50 p-3 rounded">
        <div className="text-sm text-gray-500 mb-1">Rendered Value</div>
        <div className="text-xl font-bold">{formatVal(value)}</div>
      </div>

      {/* Logic / Formula */}
      {registryEntry ? (
          <div className="mb-6">
            <h3 className="font-bold text-gray-700 mb-2">Calculation Logic</h3>
            <div className="text-sm bg-blue-50 p-2 rounded text-blue-800 mb-2 border border-blue-100">
                {registryEntry.description}
            </div>
            <div className="font-mono text-xs bg-gray-800 text-green-400 p-2 rounded">
                {registryEntry.formula}
            </div>
            
            {/* Verification Status */}
            {verification && (
                <div className={`mt-3 p-2 rounded text-sm font-bold ${verification.match ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {verification.match ? '✅ Calculation Verified' : `❌ Mismatch (Diff: ${verification.diff})`}
                    {!verification.match && (
                        <div className="font-normal text-xs mt-1">
                            Expected: {formatVal(verification.calculated)}
                        </div>
                    )}
                </div>
            )}
          </div>
      ) : (
          <div className="mb-6 text-gray-500 italic">
              No formula definition found for this field. (Raw Data)
          </div>
      )}

      {/* Inputs Trace */}
      {inputs.length > 0 && (
          <div className="mb-6">
              <h3 className="font-bold text-gray-700 mb-2">Input Values</h3>
              <div className="border rounded text-sm">
                  <table className="w-full">
                      <thead className="bg-gray-100">
                          <tr>
                              <th className="text-left p-2">Field</th>
                              <th className="text-right p-2">Value</th>
                          </tr>
                      </thead>
                      <tbody>
                          {inputs.map((input, i) => (
                              <tr key={i} className="border-t hover:bg-gray-50">
                                  <td className="p-2 font-mono text-xs">{input.key}</td>
                                  <td className="p-2 text-right">{formatVal(input.value)}</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>
      )}

      {/* Comments / Issues Log */}
      <div className="mb-6">
          <h3 className="font-bold text-gray-700 mb-2">Notes / Issues</h3>
          <textarea
            className="w-full border rounded p-2 text-sm h-24"
            placeholder="Log issues or comments for this cell..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          ></textarea>
          <button
            onClick={handleSaveNote}
            className="mt-2 bg-blue-600 text-white px-3 py-1 rounded text-sm w-full hover:bg-blue-700"
          >
              Save Note
          </button>
      </div>

      {/* Component Metadata (New Unified Architecture) */}
      {data.components && Object.keys(data.components).length > 0 && (
        <div className="mb-6 border-t pt-4">
          <h3 className="font-bold text-gray-700 mb-2">📊 Component Metadata</h3>
          <p className="text-xs text-gray-500 mb-2">PayrollComponent structure with metadata from unified architecture</p>
          {Object.entries(data.components).map(([compName, compData]) => (
            <div key={compName} className="mb-2">
              <ComponentMetadataViewer
                component={compData}
                componentName={compName}
                expanded={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
