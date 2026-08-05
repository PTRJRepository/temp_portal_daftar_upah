/**
 * LockedMainPage - Division-locked version of MainPage
 * Now simply wraps MainPage with a lockedDiv prop for consistency.
 * Division selector is disabled, only gang can be changed.
 * Uses external JWT token authentication with RS256 verification.
 */
import React from 'react'
import MainPage from './MainPage'

export default function LockedMainPage({ lockedDiv }) {
    // Simply render MainPage with the locked division prop
    // MainPage handles all the locked mode logic internally
    return <MainPage lockedDiv={lockedDiv} />
}
