/**
 * ComponentMetadataTestPage - Test and demonstration page for component metadata
 *
 * This page demonstrates the new unified payroll component architecture:
 * - Fetches payroll data with component metadata
 * - Displays component breakdown for selected employees
 * - Shows registry status
 * - Tests all component services
 */

import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchPayrollWithComponents, fetchEmployeeComponents, fetchComponentRegistry } from '../services/payrollService'
import ComponentMetadataViewer, { ComponentMetadataTable } from '../components/common/ComponentMetadataViewer'
import { fetchGangs } from '../services/gangService'
import './ComponentMetadataTestPage.css'

export default function ComponentMetadataTestPage() {
  const { token } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Filters
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [gangs, setGangs] = useState([])
  const [selectedGang, setSelectedGang] = useState('')
  const [division, setDivision] = useState('')

  // Data
  const [payrollWithComponents, setPayrollWithComponents] = useState(null)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [employeeComponents, setEmployeeComponents] = useState(null)
  const [registry, setRegistry] = useState(null)

  // Active tab
  const [activeTab, setActiveTab] = useState('payroll') // payroll, employee, registry

  // Load gangs
  useEffect(() => {
    async function loadGangs() {
      if (!token) return
      try {
        const gangsData = await fetchGangs(token)
        setGangs(gangsData || [])

        // Set division from first gang
        if (gangsData && gangsData.length > 0) {
          setDivision(gangsData[0].div_code || '')
          setSelectedGang(gangsData[0].gang_code || '')
        }
      } catch (e) {
        console.error('Failed to load gangs:', e)
      }
    }
    loadGangs()
  }, [token])

  // Fetch payroll with components
  const handleFetchPayrollWithComponents = async () => {
    if (!token || !division) {
      setError('Token atau divisi tidak tersedia')
      return
    }

    setLoading(true)
    setError('')
    setActiveTab('payroll')

    try {
      const data = await fetchPayrollWithComponents(token, {
        month,
        year,
        gang_code: selectedGang,
        division
      })
      console.log('[ComponentMetadataTest] Payroll with components:', data)
      setPayrollWithComponents(data)
      setSelectedEmployee(null)
      setEmployeeComponents(null)
    } catch (e) {
      console.error('Failed to fetch payroll with components:', e)
      setError('Gagal memuat data dengan komponen: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }

  // Fetch employee components
  const handleFetchEmployeeComponents = async (employee) => {
    if (!token) {
      setError('Token tidak tersedia')
      return
    }

    setLoading(true)
    setError('')
    setActiveTab('employee')

    try {
      const empCode = employee.nik || employee.NIK
      const data = await fetchEmployeeComponents(token, empCode, month, year, division)
      console.log('[ComponentMetadataTest] Employee components:', data)
      setSelectedEmployee(employee)
      setEmployeeComponents(data)
    } catch (e) {
      console.error('Failed to fetch employee components:', e)
      setError('Gagal memuat komponen karyawan: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }

  // Fetch registry
  const handleFetchRegistry = async () => {
    if (!token) {
      setError('Token tidak tersedia')
      return
    }

    setLoading(true)
    setError('')
    setActiveTab('registry')

    try {
      const data = await fetchComponentRegistry(token)
      console.log('[ComponentMetadataTest] Registry:', data)
      setRegistry(data)
    } catch (e) {
      console.error('Failed to fetch registry:', e)
      setError('Gagal memuat registry: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-'
    return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)
  }

  return (
    <div className="component-metadata-test-page">
      <div className="test-header">
        <h1>🧪 Component Metadata Test Page</h1>
        <p>Testing unified payroll component architecture with metadata</p>
      </div>

      {/* Filters */}
      <div className="test-filters">
        <div className="filter-group">
          <label>Month:</label>
          <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Year:</label>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
            {[2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Gang:</label>
          <select value={selectedGang} onChange={(e) => setSelectedGang(e.target.value)}>
            <option value="">All Gangs</option>
            {gangs.map(g => (
              <option key={g.gang_code} value={g.gang_code}>{g.gang_code} - {g.gang_name}</option>
            ))}
          </select>
        </div>

        <div className="filter-info">
          Division: <strong>{division || '-'}</strong>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="test-actions">
        <button
          onClick={handleFetchPayrollWithComponents}
          className="btn btn-primary"
          disabled={loading}
        >
          {loading && activeTab === 'payroll' ? 'Loading...' : '📊 Fetch Payroll with Components'}
        </button>
        <button
          onClick={handleFetchRegistry}
          className="btn btn-secondary"
          disabled={loading}
        >
          {loading && activeTab === 'registry' ? 'Loading...' : '📋 Fetch Registry'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          ❌ {error}
        </div>
      )}

      {/* Registry Tab */}
      {activeTab === 'registry' && registry && (
        <div className="test-section">
          <h2>📋 Component Registry Status</h2>
          <div className="registry-info">
            <div className="info-item">
              <span className="info-label">Total Components:</span>
              <span className="info-value">{registry.total_components || 0}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Status:</span>
              <span className={`info-value ${registry.status === 'healthy' ? 'healthy' : 'error'}`}>
                {registry.status || 'unknown'}
              </span>
            </div>
          </div>

          {registry.components && (
            <div className="components-list">
              <h3>Registered Components</h3>
              {Object.entries(registry.components).map(([name, info]) => (
                <div key={name} className="component-card">
                  <h4>{name}</h4>
                  <div className="component-details">
                    <span className="detail-item">Version: {info.version || '-'}</span>
                    <span className="detail-item">Status: {info.status || '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Payroll with Components Tab */}
      {activeTab === 'payroll' && payrollWithComponents && (
        <div className="test-section">
          <h2>📊 Payroll Data with Component Metadata</h2>

          {payrollWithComponents.summary && (
            <div className="payroll-summary">
              <div className="summary-item">
                <span className="summary-label">Total Employees:</span>
                <span className="summary-value">{payrollWithComponents.summary.total_employees || 0}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Execution Time:</span>
                <span className="summary-value">{payrollWithComponents.execution_time_ms || 0} ms</span>
              </div>
            </div>
          )}

          {payrollWithComponents.data && payrollWithComponents.data.length > 0 ? (
            <div className="employee-list">
              <h3>Employees (Click to view component breakdown)</h3>
              {payrollWithComponents.data.map((emp, idx) => (
                <div
                  key={idx}
                  className="employee-card"
                  onClick={() => handleFetchEmployeeComponents(emp)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="employee-header">
                    <strong>{emp.nama || emp.EmpName}</strong>
                    <span className="employee-nik">{emp.new_nik || emp.nik || emp.NIK}</span>
                  </div>
                  <div className="employee-preview">
                    <span>Upah Bersih: {formatCurrency(emp.upah_bersih)}</span>
                    <span className="click-hint">→ Click for details</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-data">No employee data found</div>
          )}
        </div>
      )}

      {/* Employee Components Tab */}
      {activeTab === 'employee' && selectedEmployee && employeeComponents && (
        <div className="test-section">
          <h2>👤 Component Breakdown: {selectedEmployee.nama || selectedEmployee.EmpName}</h2>
          <p className="employee-subtitle">NIK: {selectedEmployee.nik || selectedEmployee.NIK}</p>

          <button
            onClick={() => setActiveTab('payroll')}
            className="btn btn-back"
          >
            ← Back to Employee List
          </button>

          {/* Display all components with metadata */}
          {employeeComponents.gaji_pokok && (
            <div className="component-section">
              <h3>💵 Gaji Pokok (Basic Salary)</h3>
              <ComponentMetadataViewer
                component={employeeComponents.gaji_pokok}
                componentName="gaji_pokok"
                expanded={true}
              />
            </div>
          )}

          {employeeComponents.lembur && (
            <div className="component-section">
              <h3>⏰ Lembur (Overtime)</h3>
              <ComponentMetadataViewer
                component={employeeComponents.lembur}
                componentName="lembur"
                expanded={true}
              />
            </div>
          )}

          {employeeComponents.premi && (
            <div className="component-section">
              <h3>💰 Premi (Premium)</h3>
              <ComponentMetadataViewer
                component={employeeComponents.premi}
                componentName="premi"
                expanded={true}
              />
            </div>
          )}

          {employeeComponents.tunjangan && (
            <div className="component-section">
              <h3>🎁 Tunjangan (Allowances)</h3>
              <ComponentMetadataViewer
                component={employeeComponents.tunjangan}
                componentName="tunjangan"
                expanded={true}
              />
            </div>
          )}

          {employeeComponents.potongan && (
            <div className="component-section">
              <h3>✂️ Potongan (Deductions)</h3>
              <ComponentMetadataViewer
                component={employeeComponents.potongan}
                componentName="potongan"
                expanded={true}
              />
            </div>
          )}

          {employeeComponents.pph21_ter && (
            <div className="component-section">
              <h3>🧾 PPH21 TER (Tax)</h3>
              <ComponentMetadataViewer
                component={employeeComponents.pph21_ter}
                componentName="pph21_ter"
                expanded={true}
              />
            </div>
          )}

          {/* Component Table View */}
          <div className="component-section">
            <h3>📋 Component Summary Table</h3>
            <ComponentMetadataTable
              components={employeeComponents}
              title="All Components Summary"
            />
          </div>
        </div>
      )}
    </div>
  )
}
