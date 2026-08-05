import React, { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import EmployeeDetailPage from '../components/employee/EmployeeDetailPage'
import LoadingScreen from '../components/common/LoadingScreen'

export default function EmployeeDetailRoute() {
    const { token, loading: authLoading } = useAuth()
    const location = useLocation()
    const [params, setParams] = useState(null)
    const [loadingParams, setLoadingParams] = useState(true)

    useEffect(() => {
        let cancelled = false;

        const fetchParams = async () => {
            const urlParams = new URLSearchParams(location.search)
            // Prefer explicit Plantware EmpCode, but keep old nik param as fallback.
            const rawIdentifier = urlParams.get('emp_code') || urlParams.get('nik')
            const empIdentifier = rawIdentifier ? rawIdentifier.trim() : null
            let month = parseInt(urlParams.get('month') || '0', 10)
            let year = parseInt(urlParams.get('year') || '0', 10)
            const rawDivision = urlParams.get('division')
            const division = (rawDivision && rawDivision !== 'undefined' && rawDivision !== 'null') ? rawDivision : null
            const rawUseHistoryDb = urlParams.get('use_history')
            const useHistoryDb = rawUseHistoryDb === null
                ? null
                : rawUseHistoryDb.trim().toLowerCase() === 'true'
            const snapshotVersion = urlParams.get('snapshot_version')

            const isValid = empIdentifier && empIdentifier !== 'undefined' && empIdentifier !== 'null'

            if (isValid) {
                if (!month || !year) {
                    try {
                        const baseUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || '';
                        const periodRes = await fetch(`${baseUrl}/payroll/current-period`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (periodRes.ok) {
                            const periodData = await periodRes.json();
                            if (periodData.month && periodData.year) {
                                month = periodData.month;
                                year = periodData.year;
                                console.log(`[EmployeeDetailRoute] Defaulting to active period: ${month}/${year}`);
                            }
                        }
                    } catch (e) {
                        console.error("[EmployeeDetailRoute] Failed to load current period:", e);
                    }
                }

                if (month && year) {
                    if (!cancelled) {
                        setParams({ empIdentifier, month, year, division, useHistoryDb, snapshotVersion });
                    }
                }
            }
            if (!cancelled) {
                setLoadingParams(false);
            }
        };

        if (token && !authLoading) {
            fetchParams();
        } else {
            // If no token or still loading, still need to set loadingParams to false to avoid infinite loading
            setLoadingParams(false);
        }

        return () => {
            cancelled = true;
        };
    }, [token, authLoading, location.search])

    if (authLoading || loadingParams) {
        return <LoadingScreen isLoading={true} message="Authenticating..." />
    }

    if (!params) {
        return (
            <div style={{
                height: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                color: '#666'
            }}>
                <h3>Parameter tidak lengkap</h3>
                <p>Harap akses halaman ini melalui Laporan Upah.</p>
            </div>
        )
    }

    return (
        <EmployeeDetailPage
            employeeData={{ nik: params.empIdentifier, emp_code: params.empIdentifier }}
            month={params.month}
            year={params.year}
            division={params.division}
            useHistoryDb={params.useHistoryDb}
            snapshotVersion={params.snapshotVersion}
            onBack={() => window.close()}
        />
    )
}
