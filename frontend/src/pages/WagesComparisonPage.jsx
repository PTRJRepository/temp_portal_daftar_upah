/**
 * WagesComparisonPage - Page for viewing wages comparison
 * 
 * Route: /wages-comparison
 * Accessible from main navigation or Report page
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PayrollHistoryComparison from '../components/PayrollHistoryComparison';
import { MetricInfo } from '../components/report/reportTheme';

export default function WagesComparisonPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    
    // Get initial values from URL params
    const initialMonth = searchParams.get('month') ? parseInt(searchParams.get('month')) : undefined;
    const initialYear = searchParams.get('year') ? parseInt(searchParams.get('year')) : undefined;
    const initialDivision = searchParams.get('division') || undefined;
    
    const handleBack = () => {
        navigate(-1); // Go back to previous page
    };
    
    return (
        <div className="wages-comparison-page">
            <div className="no-print" style={{ padding: '12px 20px', background: '#EDF3EC', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #DFE8E0' }}>
                <span style={{ fontWeight: 800, color: '#14532D', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Perbandingan Upah <MetricInfo metricKey="upah_bersih" /></span>
                <button onClick={() => navigate(`/cost-per-ton-story?month=${initialMonth || ''}&year=${initialYear || ''}`)} style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1E7A45', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cost/Ton Story →</button>
            </div>
            <PayrollHistoryComparison
                initialMonth={initialMonth}
                initialYear={initialYear}
                initialDivision={initialDivision}
                onBack={handleBack}
            />
        </div>
    );
}
