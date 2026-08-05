import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import HrInfoPage from '../components/employee/HrInfoPage'
import LoadingScreen from '../components/common/LoadingScreen'

export default function HrInfoRoute() {
    const { token, loading: authLoading } = useAuth()
    const [params, setParams] = useState(null)
    const [loadingParams, setLoadingParams] = useState(true)

    useEffect(() => {
        const fetchParams = async () => {
            const urlParams = new URLSearchParams(window.location.search)
            const rawNik = urlParams.get('nik')
            const nik = rawNik ? rawNik.trim() : null
            let month = parseInt(urlParams.get('month') || '0', 10)
            let year = parseInt(urlParams.get('year') || '0', 10)
            const rawDivision = urlParams.get('division')
            const division = (rawDivision && rawDivision !== 'undefined' && rawDivision !== 'null') ? rawDivision : null

            const isValidNik = nik && nik !== 'undefined' && nik !== 'null'

            if (isValidNik) {
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
                                console.log(`[HrInfoRoute] Defaulting to active period: ${month}/${year}`);
                            }
                        }
                    } catch (e) {
                        console.error("[HrInfoRoute] Failed to load current period:", e);
                    }
                }

                if (month && year) {
                    setParams({ nik, month, year, division });
                }
            }
            setLoadingParams(false);
        };

        if (token && !authLoading) {
            fetchParams();
        }
    }, [token, authLoading])

    if (authLoading || loadingParams) {
        return <LoadingScreen isLoading={true} message="Authenticating HR Profile..." />
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
                <p>Harap akses halaman ini melalui Direktori Karyawan.</p>
            </div>
        )
    }

    return (
        <HrInfoPage
            employeeData={{ nik: params.nik }}
            month={params.month}
            year={params.year}
            division={params.division}
            onBack={() => window.close()}
        />
    )
}
