/**
 * ComponentMetadataViewer - Displays PayrollComponent metadata
 *
 * Renders metadata for PayrollComponent<T> items including:
 * - Source (DATABASE_PLANTWARE, CALCULATION, etc.)
 * - Calculation basis
 * - Dependencies
 * - Execution time
 * - Version info
 * - Confidence level
 */

import React, { useState } from 'react'
import './ComponentMetadataViewer.css'

// Source badge colors
const sourceConfig = {
  'DATABASE_PLANTWARE': { color: '#3b82f6', label: 'Database Plantware', icon: '🗄️' },
  'DATABASE_VENUS': { color: '#8b5cf6', label: 'Database Venus', icon: '🗄️' },
  'CALCULATION': { color: '#10b981', label: 'Kalkulasi', icon: '🧮' },
  'MANUAL': { color: '#f59e0b', label: 'Manual', icon: '✏️' },
  'DEFAULT': { color: '#6b7280', label: 'Default', icon: '📋' },
  'CACHE': { color: '#ec4899', label: 'Cache', icon: '⚡' },
}

// Confidence level colors
const confidenceConfig = {
  'high': { color: '#10b981', label: 'Tinggi' },
  'medium': { color: '#f59e0b', label: 'Sedang' },
  'low': { color: '#ef4444', label: 'Rendah' },
}

export default function ComponentMetadataViewer({ component, componentName, expanded = false }) {
  const [isExpanded, setIsExpanded] = useState(expanded)

  if (!component || !component.meta) {
    return <span className="no-metadata">Tidak ada metadata tersedia</span>
  }

  const meta = component.meta
  const sourceInfo = sourceConfig[meta.source] || { color: '#6b7280', label: meta.source, icon: '❓' }
  const confidenceInfo = confidenceConfig[meta.confidence_level] || null

  return (
    <div className="metadata-viewer">
      {/* Header - Click to expand/collapse */}
      <div
        className="metadata-header"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer' }}
      >
        <span className="component-name">{componentName || 'Component'}</span>
        <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="metadata-content">
          {/* Value display */}
          <div className="metadata-row">
            <span className="metadata-label">Nilai:</span>
            <span className="metadata-value primary">
              {typeof component.value === 'number'
                ? new Intl.NumberFormat('id-ID', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(component.value)
                : JSON.stringify(component.value)}
            </span>
          </div>

          {/* Source badge */}
          <div className="metadata-row">
            <span className="metadata-label">Sumber:</span>
            <span
              className="source-badge"
              style={{
                backgroundColor: sourceInfo.color,
                color: 'white',
              }}
            >
              {sourceInfo.icon} {sourceInfo.label}
            </span>
          </div>

          {/* Description */}
          {meta.description && (
            <div className="metadata-row">
              <span className="metadata-label">Deskripsi:</span>
              <span className="metadata-value">{meta.description}</span>
            </div>
          )}

          {/* Calculation basis */}
          {meta.calculation_basis && (
            <div className="metadata-row">
              <span className="metadata-label">Dasar Perhitungan:</span>
              <span className="metadata-value calculation">{meta.calculation_basis}</span>
            </div>
          )}

          {/* Dependencies */}
          {meta.dependencies && meta.dependencies.length > 0 && (
            <div className="metadata-row">
              <span className="metadata-label">Dependensi:</span>
              <div className="dependencies-list">
                {meta.dependencies.map((dep, idx) => (
                  <span key={idx} className="dependency-tag">
                    {dep}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Execution time */}
          {meta.execution_time_ms !== undefined && (
            <div className="metadata-row">
              <span className="metadata-label">Waktu Eksekusi:</span>
              <span className="metadata-value">{meta.execution_time_ms} ms</span>
            </div>
          )}

          {/* Version */}
          {meta.version !== undefined && (
            <div className="metadata-row">
              <span className="metadata-label">Versi:</span>
              <span className="metadata-value">v{meta.version}</span>
            </div>
          )}

          {/* Confidence level */}
          {confidenceInfo && (
            <div className="metadata-row">
              <span className="metadata-label">Tingkat Keyakinan:</span>
              <span
                className="confidence-badge"
                style={{
                  backgroundColor: confidenceInfo.color,
                  color: 'white',
                }}
              >
                {confidenceInfo.label}
              </span>
            </div>
          )}

          {/* Taxable */}
          {meta.taxable !== undefined && (
            <div className="metadata-row">
              <span className="metadata-label">Kena Pajak:</span>
              <span className="metadata-value">{meta.taxable ? 'Ya' : 'Tidak'}</span>
            </div>
          )}

          {/* Timestamps */}
          {meta.last_updated && (
            <div className="metadata-row">
              <span className="metadata-label">Terakhir Diupdate:</span>
              <span className="metadata-value">{new Date(meta.last_updated).toLocaleString('id-ID')}</span>
            </div>
          )}

          {meta.calculated_at && (
            <div className="metadata-row">
              <span className="metadata-label">Dihitung Pada:</span>
              <span className="metadata-value">{new Date(meta.calculated_at).toLocaleString('id-ID')}</span>
            </div>
          )}

          {/* Additional metadata */}
          {Object.entries(meta).filter(([key]) => ![
            'source', 'description', 'calculation_basis', 'dependencies',
            'execution_time_ms', 'version', 'confidence_level', 'taxable',
            'last_updated', 'calculated_at'
          ].includes(key)).length > 0 && (
              <div className="metadata-row">
                <span className="metadata-label">Metadata Lainnya:</span>
                <details className="additional-metadata">
                  <summary>Lihat detail</summary>
                  <pre>{JSON.stringify(meta, null, 2)}</pre>
                </details>
              </div>
            )}
        </div>
      )}
    </div>
  )
}

/**
 * ComponentMetadataTable - Displays multiple components in a table format
 */
export function ComponentMetadataTable({ components, title }) {
  if (!components || Object.keys(components).length === 0) {
    return <div className="no-components">Tidak ada komponen untuk ditampilkan</div>
  }

  return (
    <div className="metadata-table-container">
      {title && <h3 className="metadata-table-title">{title}</h3>}
      <table className="metadata-table">
        <thead>
          <tr>
            <th>Komponen</th>
            <th>Nilai</th>
            <th>Sumber</th>
            <th>Dasar Perhitungan</th>
            <th>Versi</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(components).map(([name, component]) => {
            const meta = component?.meta || {}
            const sourceInfo = sourceConfig[meta.source] || { label: meta.source || '-', icon: '' }

            return (
              <tr key={name}>
                <td className="component-name-cell">{name}</td>
                <td className="component-value-cell" title={`Formula: ${meta.calculation_basis || ''}\nDependencies: ${meta.dependencies ? meta.dependencies.join(', ') : ''}`}>
                  {typeof component?.value === 'number'
                    ? new Intl.NumberFormat('id-ID', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }).format(component.value)
                    : JSON.stringify(component?.value)}
                </td>
                <td className="component-source-cell">
                  <span className="mini-source-badge">{sourceInfo.icon} {sourceInfo.label}</span>
                </td>
                <td className="component-calculation-cell">
                  <span className="calculation-basis">{meta.calculation_basis || '-'}</span>
                </td>
                <td className="component-version-cell">{meta.version !== undefined ? `v${meta.version}` : '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
