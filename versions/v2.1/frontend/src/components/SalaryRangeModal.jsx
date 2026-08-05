/**
 * SalaryRangeModal - Modal untuk input range gaji
 * Popup untuk memasukkan minimum gaji sebelum menampilkan report
 */

import React, { useState } from 'react';
import { buildAppPath } from '../utils/prodModeUtils';

export default function SalaryRangeModal({ isOpen, onClose }) {
    // Use window.location instead of useNavigate to avoid Router context issues

    // State untuk form
    const [month, setMonth] = useState(new Date().getMonth() + 1);
    const [year, setYear] = useState(new Date().getFullYear());
    const [minSalary, setMinSalary] = useState(6000000);

    const monthOptions = [
        { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' },
        { value: 3, label: 'Maret' }, { value: 4, label: 'April' },
        { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
        { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' },
        { value: 9, label: 'September' }, { value: 10, label: 'Oktober' },
        { value: 11, label: 'November' }, { value: 12, label: 'Desember' }
    ];

    const handleSubmit = (e) => {
        e.preventDefault();

        // Navigate ke halaman report dengan parameter menggunakan window.location
        const params = new URLSearchParams({
            month: String(month),
            year: String(year),
            min_salary: String(minSalary)
        });

        window.location.href = buildAppPath(`/report/salary-range-detail?${params.toString()}`);
    };

    if (!isOpen) return null;

    return (
        <div
            className="modal-overlay"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000
            }}
            onClick={onClose}
        >
            <div
                className="modal-content"
                style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    padding: '24px',
                    minWidth: '400px',
                    maxWidth: '500px',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header" style={{ marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
                        Detail Gaji Range
                    </h2>
                    <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: '14px' }}>
                        Lihat detail karyawan dengan gaji dalam range tertentu
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    {/* Periode Section */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                            Periode:
                        </label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <select
                                value={month}
                                onChange={(e) => setMonth(parseInt(e.target.value))}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '4px',
                                    fontSize: '14px'
                                }}
                                required
                            >
                                {monthOptions.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                            <select
                                value={year}
                                onChange={(e) => setYear(parseInt(e.target.value))}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '4px',
                                    fontSize: '14px'
                                }}
                                required
                            >
                                {[...Array(5)].map((_, i) => {
                                    const y = new Date().getFullYear() - i;
                                    return <option key={y} value={y}>{y}</option>;
                                })}
                            </select>
                        </div>
                    </div>

                    {/* Min Salary Section */}
                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                            Gaji Bersih Lebih Dari:
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#666' }}>Rp</span>
                            <input
                                type="number"
                                value={minSalary}
                                onChange={(e) => setMinSalary(parseInt(e.target.value) || 0)}
                                min={0}
                                step={100000}
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '4px',
                                    fontSize: '14px'
                                }}
                                required
                            />
                        </div>
                        <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#666' }}>
                            Menampilkan karyawan dengan upah bersih di atas Rp {new Intl.NumberFormat('id-ID').format(minSalary)}
                        </p>
                    </div>

                    {/* Preset Options */}
                    <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: '#666' }}>
                            Preset:
                        </label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {[5000000, 6000000, 7000000, 8000000, 10000000].map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setMinSalary(value)}
                                    style={{
                                        padding: '6px 12px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '4px',
                                        backgroundColor: minSalary === value ? '#3b82f6' : 'white',
                                        color: minSalary === value ? 'white' : '#374151',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {new Intl.NumberFormat('id-ID').format(value)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '10px 20px',
                                border: '1px solid #d1d5db',
                                borderRadius: '4px',
                                backgroundColor: 'white',
                                color: '#374151',
                                fontSize: '14px',
                                cursor: 'pointer'
                            }}
                        >
                            Batal
                        </button>
                        <button
                            type="submit"
                            style={{
                                padding: '10px 20px',
                                border: 'none',
                                borderRadius: '4px',
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                fontSize: '14px',
                                fontWeight: '500',
                                cursor: 'pointer'
                            }}
                        >
                            Tampilkan Report
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
