import React from 'react';

const PrintSignature = () => {
    return (
        <div className="wsp-signature-section" style={{
            marginTop: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            pageBreakInside: 'avoid',
            breakInside: 'avoid'
        }}>
            <div className="wsp-signature-block" style={{ width: '25%', textAlign: 'center' }}>
                <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>Dibuat Oleh:</p>
                <div className="signature-space" style={{ height: '75px' }}></div>
                <div style={{ margin: '0 auto', width: '170px' }}>
                    <div style={{ height: '2px', backgroundColor: 'black', width: '100%', marginBottom: '5px' }}></div>
                    <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>Admin Payroll</p>
                    <p style={{ fontSize: '0.75rem', fontStyle: 'italic', margin: '0', color: '#334155' }}>Staff Payroll</p>
                </div>
            </div>

            <div className="wsp-signature-block" style={{ width: '25%', textAlign: 'center' }}>
                <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>Diperiksa Oleh:</p>
                <div className="signature-space" style={{ height: '75px' }}></div>
                <div style={{ margin: '0 auto', width: '170px' }}>
                    <div style={{ height: '2px', backgroundColor: 'black', width: '100%', marginBottom: '5px' }}></div>
                    <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>HR Manager</p>
                    <p style={{ fontSize: '0.75rem', fontStyle: 'italic', margin: '0', color: '#334155' }}>Manager</p>
                </div>
            </div>

            <div className="wsp-signature-block" style={{ width: '25%', textAlign: 'center' }}>
                <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>Diketahui Oleh:</p>
                <div className="signature-space" style={{ height: '75px' }}></div>
                <div style={{ margin: '0 auto', width: '170px' }}>
                    <div style={{ height: '2px', backgroundColor: 'black', width: '100%', marginBottom: '5px' }}></div>
                    <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>Senior Manager</p>
                    <p style={{ fontSize: '0.75rem', fontStyle: 'italic', margin: '0', color: '#334155' }}>Senior Manager</p>
                </div>
            </div>

            <div className="wsp-signature-block" style={{ width: '25%', textAlign: 'center' }}>
                <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>Disetujui Oleh:</p>
                <div className="signature-space" style={{ height: '75px' }}></div>
                <div style={{ margin: '0 auto', width: '170px' }}>
                    <div style={{ height: '2px', backgroundColor: 'black', width: '100%', marginBottom: '5px' }}></div>
                    <p style={{ fontWeight: 'bold', margin: '0', fontSize: '0.8rem' }}>General Manager</p>
                    <p style={{ fontSize: '0.75rem', fontStyle: 'italic', margin: '0', color: '#334155' }}>GM / Direksi</p>
                </div>
            </div>
        </div>
    );
};

export default PrintSignature;
