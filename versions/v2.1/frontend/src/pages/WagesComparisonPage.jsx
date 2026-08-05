/**
 * WagesComparisonPage - Page for viewing wages comparison
 * 
 * Route: /wages-comparison
 * Accessible from main navigation or Report page
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PayrollHistoryComparison from '../components/PayrollHistoryComparison';

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
            <PayrollHistoryComparison
                initialMonth={initialMonth}
                initialYear={initialYear}
                initialDivision={initialDivision}
                onBack={handleBack}
            />
        </div>
    );
}
