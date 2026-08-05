import React, { createContext, useState, useContext, useEffect, useMemo } from 'react';
import { useCurrentPeriod } from '../hooks/useCurrentPeriod';
import { fetchGangs, fetchDivisions } from '../services/gangService';
import { getLockedGangs } from '../services/lockedDivisionService';
import { useAuth } from './AuthContext';
import { isProdMode, getUserDivision } from '../utils/prodModeUtils';

const ReportContext = createContext();

const STORAGE_KEYS = {
    DIVISION: 'tax_report_division',
    GANG: 'tax_report_gang',
    GANG_PREFIX: 'tax_report_gang_prefix'
};

const loadFromStorage = (key, defaultValue) => {
    try {
        const stored = localStorage.getItem(key);
        return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
        return defaultValue;
    }
};

const saveToStorage = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('Failed to save to localStorage:', e);
    }
};

export const useReport = () => useContext(ReportContext);

export const ReportProvider = ({ children }) => {
    const { user, token, lockedDivision } = useAuth();
    const { month, setMonth, year, setYear, data: currentPeriodData, loading: currentPeriodLoading } = useCurrentPeriod();

    // State for filters - Initialize from localStorage
    const [division, setDivision] = useState(() => loadFromStorage(STORAGE_KEYS.DIVISION, ''));
    const [gang, setGang] = useState(() => loadFromStorage(STORAGE_KEYS.GANG, ''));
    const [gangPrefix, setGangPrefix] = useState(() => loadFromStorage(STORAGE_KEYS.GANG_PREFIX, ''));
    const [gangs, setGangs] = useState([]);
    const [allDivisions, setAllDivisions] = useState([]);

    // Loading states
    const [gangLoading, setGangLoading] = useState(false);
    const [divisionsLoading, setDivisionsLoading] = useState(false);

    // Determine if we're in locked mode (Admin is never locked)
    const inProdMode = isProdMode();
    const prodDivision = inProdMode ? getUserDivision() : null;
    const isVisitorUser = user?.isVisitor || (user?.role && user.role.toUpperCase() === 'VISITOR');
    const isAdminUser = user?.isAdmin === true ||
        (user?.role && user.role.toUpperCase() === 'ADMIN') ||
        (user?.divisi && user.divisi.toUpperCase() === 'ALL' && !isVisitorUser);

    const isKeraniUser = (user?.role || '').toLowerCase() === 'kerani';
    const externalLockedDiv = isAdminUser || isVisitorUser ? null : (lockedDivision || null);
    const isLockedMode = !isAdminUser && !isVisitorUser && (!!(externalLockedDiv || prodDivision) || isKeraniUser);

    // Load Divisions
    useEffect(() => {
        async function loadDivisions() {
            if (!token) return;
            setDivisionsLoading(true);
            try {
                const divisions = await fetchDivisions(token);
                setAllDivisions(divisions || []);
                console.log('[ReportContext] Loaded divisions:', divisions);
            } catch (e) {
                console.error('[ReportContext] Failed to load divisions:', e);
                setAllDivisions([]);
            } finally {
                setDivisionsLoading(false);
            }
        }
        loadDivisions();
    }, [token]);

    // Persist filters to localStorage
    useEffect(() => {
        if (division) saveToStorage(STORAGE_KEYS.DIVISION, division);
    }, [division]);

    useEffect(() => {
        if (gang) saveToStorage(STORAGE_KEYS.GANG, gang);
    }, [gang]);

    useEffect(() => {
        if (gangPrefix !== undefined) saveToStorage(STORAGE_KEYS.GANG_PREFIX, gangPrefix);
    }, [gangPrefix]);

    // Initial Division Selection Logic
    useEffect(() => {
        let targetDivision = '';

        // Priority 1: External locked division
        if (externalLockedDiv) {
            targetDivision = externalLockedDiv;
        }
        // Priority 2: PRODUCTION MODE - Division is LOCKED
        else if (inProdMode && prodDivision) {
            targetDivision = prodDivision;
        }
        // Priority 3: Kerani specific division from user token/info
        else if (isKeraniUser && (user?.divisions?.length > 0 || user?.divisi)) {
            targetDivision = user?.divisions?.[0] || user?.divisi;
        }
        // Priority 4: Non-Admin User - Auto-select from Token (General)
        else if (!isAdminUser && (user?.divisions?.length > 0 || user?.divisi)) {
            targetDivision = user?.divisions?.[0] || user?.divisi;
        }

        // Enforcement & Initialization
        if (isLockedMode && targetDivision && division !== targetDivision) {
            // FORCE locked division if it doesn't match current state
            console.log('[ReportContext] Enforcing locked division:', targetDivision);
            setDivision(targetDivision);
        }
        else if (!division && targetDivision) {
            // Initialize if empty and we have a target
            setDivision(targetDivision);
        }
        else if (!division && allDivisions.length > 0) {
            // Final fallback: First from API
            console.log('[ReportContext] Setting fallback division:', allDivisions[0]);
            setDivision(allDivisions[0]);
        }
    }, [user, inProdMode, prodDivision, externalLockedDiv, allDivisions, isAdminUser, isLockedMode, isKeraniUser]);

    // Track latest gang value to avoid stale closures in async calls
    const gangRef = React.useRef(gang);
    useEffect(() => {
        gangRef.current = gang;
    }, [gang]);

    // Load Gangs when Division changes
    useEffect(() => {
        async function load() {
            console.log('[ReportContext] loadGangs effect triggered', { division, hasToken: !!token, isLockedMode });

            if (!division || !token) {
                setGangs([]);
                setGang('');
                return;
            }

            // If the user already selected a gang, we don't want to wipe it out while loading
            // But we do want to disable the selector potentially? 
            // For now, let's just fetch.
            setGangLoading(true);
            try {
                let list;
                if (isLockedMode) {
                    list = await getLockedGangs(token, division);
                } else {
                    list = await fetchGangs(token, division, null, true);
                }

                if (list && list.length > 0) {
                    setGangs(list);

                    // Check against the LATEST gang value (from ref)
                    const currentGang = gangRef.current;
                    const currentExists = list.some(g => g.gang_code === currentGang);

                    console.log('[ReportContext] Gangs loaded', {
                        count: list.length,
                        currentGang,
                        currentExists
                    });

                    // Only auto-select if:
                    // 1. No gang is currently selected
                    // 2. OR the currently selected gang is NOT in the new list (invalid)
                    if (!currentGang || !currentExists) {
                        if (list[0]?.gang_code) {
                            console.log('[ReportContext] Auto-selecting first gang:', list[0].gang_code);
                            setGang(list[0].gang_code);
                        }
                    }
                } else {
                    setGangs([]);
                    setGang('');
                }
            } catch (e) {
                console.error('Failed to load gangs:', e);
                if (e.response?.status !== 401) {
                    setGangs([]);
                    setGang('');
                }
            } finally {
                setGangLoading(false);
            }
        }
        load();
    }, [division, token, isLockedMode]);

    const value = useMemo(() => ({
        month, setMonth,
        year, setYear,
        division, setDivision,
        gang, setGang,
        gangPrefix, setGangPrefix,
        gangs,
        allDivisions,
        gangLoading,
        divisionsLoading,
        currentPeriodLoading,
        isLockedMode,
        isAdminUser,
        currentPeriod: currentPeriodData
    }), [
        month, year, division, gang, gangPrefix, gangs, 
        allDivisions, gangLoading, divisionsLoading, currentPeriodLoading,
        isLockedMode, isAdminUser, currentPeriodData
    ]);

    return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
};
