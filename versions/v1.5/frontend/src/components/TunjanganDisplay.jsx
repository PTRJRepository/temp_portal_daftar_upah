import React from 'react';
import './TunjanganDisplay.css';

/**
 * TunjanganDisplay Component
 *
 * Displays allowance information with proper error handling and messaging
 * for three types of allowances:
 * - Tunjangan Jabatan (Position Allowance)
 * - Tunjangan Masa Kerja (Service Allowance)
 * - Tunjangan Lembur (Overtime Allowance)
 */
const TunjanganDisplay = ({
  jabatanAmount,
  masaKerjaAmount,
  masaKerjaYears,
  lemburAmount,
  lemburHours,
  totalTunjangan,
  employeeCode,
  isLoading = false
}) => {

  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return 'Rp 0';
    }
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getAllowanceStatus = (amount, type) => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return { status: 'error', message: `${type} tidak dapat dihitung`, class: 'error' };
    }
    if (amount === 0) {
      return {
        status: 'warning',
        message: `Tidak ada ${type.toLowerCase()} untuk periode ini`,
        class: 'zero'
      };
    }
    return { status: 'success', message: '', class: 'success' };
  };

  const jabatanStatus = getAllowanceStatus(jabatanAmount, 'Tunjangan Jabatan');
  const masaKerjaStatus = getAllowanceStatus(masaKerjaAmount, 'Tunjangan Masa Kerja');
  const lemburStatus = getAllowanceStatus(lemburAmount, 'Tunjangan Lembur');

  const handleRefresh = async () => {
    // Trigger refresh of payroll data
    if (window.refreshPayrollData) {
      try {
        await window.refreshPayrollData(employeeCode);
      } catch (error) {
        console.error('Error refreshing payroll data:', error);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="tunjangan-display loading">
        <div className="loading-spinner"></div>
        <p>Memuat data tunjangan...</p>
      </div>
    );
  }

  return (
    <div className="tunjangan-display">
      <div className="tunjangan-header">
        <h3>Detail Tunjangan</h3>
        {employeeCode && (
          <span className="employee-code">Employee: {employeeCode}</span>
        )}
      </div>

      <div className="tunjangan-grid">
        {/* Tunjangan Jabatan */}
        <div className={`tunjangan-item ${jabatanStatus.class}`}>
          <div className="tunjangan-label">
            <span>Tunjangan Jabatan</span>
            {jabatanStatus.status === 'warning' && (
              <span className="warning-icon" title={jabatanStatus.message}>⚠️</span>
            )}
            {jabatanStatus.status === 'error' && (
              <span className="error-icon" title={jabatanStatus.message}>❌</span>
            )}
          </div>
          <div className="tunjangan-amount">
            {formatCurrency(jabatanAmount)}
          </div>
          {jabatanStatus.status !== 'success' && (
            <div className="tunjangan-message">
              {jabatanStatus.message}
            </div>
          )}
        </div>

        {/* Tunjangan Masa Kerja */}
        <div className={`tunjangan-item ${masaKerjaStatus.class}`}>
          <div className="tunjangan-label">
            <span>Tunjangan Masa Kerja</span>
            {masaKerjaYears && (
              <span className="service-years">({masaKerjaYears} tahun)</span>
            )}
            {masaKerjaStatus.status === 'warning' && (
              <span className="warning-icon" title={masaKerjaStatus.message}>⚠️</span>
            )}
            {masaKerjaStatus.status === 'error' && (
              <span className="error-icon" title={masaKerjaStatus.message}>❌</span>
            )}
          </div>
          <div className="tunjangan-amount">
            {formatCurrency(masaKerjaAmount)}
          </div>
          {masaKerjaStatus.status !== 'success' && (
            <div className="tunjangan-message">
              {masaKerjaStatus.message}
            </div>
          )}
        </div>

        {/* Tunjangan Lembur */}
        <div className={`tunjangan-item ${lemburStatus.class}`}>
          <div className="tunjangan-label">
            <span>Tunjangan Lembur</span>
            {lemburHours > 0 && (
              <span className="overtime-hours">({lemburHours} jam)</span>
            )}
            {lemburStatus.status === 'warning' && (
              <span className="warning-icon" title={lemburStatus.message}>⚠️</span>
            )}
            {lemburStatus.status === 'error' && (
              <span className="error-icon" title={lemburStatus.message}>❌</span>
            )}
          </div>
          <div className="tunjangan-amount">
            {formatCurrency(lemburAmount)}
          </div>
          {lemburStatus.status !== 'success' && (
            <div className="tunjangan-message">
              {lemburStatus.message}
            </div>
          )}
        </div>
      </div>

      {/* Total Tunjangan */}
      <div className="tunjangan-total">
        <div className="total-label">Total Tunjangan</div>
        <div className="total-amount">
          {formatCurrency(totalTunjangan)}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="tunjangan-actions">
        <button
          className="refresh-button"
          onClick={handleRefresh}
          title="Refresh data tunjangan"
        >
          🔄 Refresh Data
        </button>

        {(jabatanStatus.status === 'warning' ||
          masaKerjaStatus.status === 'warning' ||
          lemburStatus.status === 'warning') && (
          <button
            className="report-button"
            onClick={() => alert('Silakan hubungi HR/Finance untuk memverifikasi data tunjangan Anda.')}
            title="Laporkan masalah tunjangan"
          >
            📊 Laporkan Masalah
          </button>
        )}
      </div>

      {/* Information Panel */}
      <div className="tunjangan-info">
        <h4>Informasi Tunjangan</h4>
        <ul>
          <li><strong>Tunjangan Jabatan:</strong> Berdasarkan posisi dan tanggung jawab kerja</li>
          <li><strong>Tunjangan Masa Kerja:</strong> Berdasarkan lamanya masa kerja karyawan</li>
          <li><strong>Tunjangan Lembur:</strong> Berdasarkan jam kerja di luar jam normal</li>
        </ul>
        <p className="info-note">
          <small>
            Jika ada tunjangan yang bernilai 0, silakan periksa periode penggajian
            atau hubungi departemen HR/Finance untuk konfirmasi lebih lanjut.
          </small>
        </p>
      </div>
    </div>
  );
};

export default TunjanganDisplay;