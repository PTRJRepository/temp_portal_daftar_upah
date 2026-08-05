import React from 'react';

export default function SelectionStats({ selection }) {
  if (!selection || selection.count === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      backgroundColor: '#f8f9fa',
      border: '1px solid #ddd',
      borderRadius: '4px',
      padding: '8px 16px',
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
      display: 'flex',
      gap: '16px',
      fontSize: '13px',
      color: '#333',
      zIndex: 9999,
      fontFamily: 'Arial, sans-serif'
    }}>
      {selection.average !== undefined && (
        <div>
          <span style={{ color: '#666', marginRight: '4px' }}>Average:</span>
          <strong>{new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(selection.average)}</strong>
        </div>
      )}
      <div>
        <span style={{ color: '#666', marginRight: '4px' }}>Count:</span>
        <strong>{selection.count}</strong>
      </div>
      {selection.sum !== undefined && (
        <div>
          <span style={{ color: '#666', marginRight: '4px' }}>Sum:</span>
          <strong>{new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(selection.sum)}</strong>
        </div>
      )}
    </div>
  );
}
