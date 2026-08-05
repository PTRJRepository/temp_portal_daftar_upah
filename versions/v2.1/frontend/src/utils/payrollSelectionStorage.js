const STORAGE_PREFIX = 'payroll-selection:v1'

const normalizeKeyPart = (value) => String(value || 'unknown')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '_')

const getUserId = (user) => user?.id || user?.username || user?.email || user?.name || user?.sub || 'anonymous'

export const LEGACY_MAINPAGE_KEYS = {
  DIVISION: 'payroll_mainpage_division',
  GANG: 'payroll_mainpage_gang',
  GANG_PREFIX: 'payroll_mainpage_gang_prefix'
}

export function buildPayrollSelectionStorageKey(user, context = {}) {
  const role = user?.role || (user?.isAdmin ? 'admin' : 'user')
  const divisionContext = context.lockedDivision || context.prodDivision || (context.isAdminUser ? 'ALL' : user?.divisi || user?.divisions?.[0] || 'none')

  return [
    STORAGE_PREFIX,
    normalizeKeyPart(getUserId(user)),
    normalizeKeyPart(role),
    normalizeKeyPart(divisionContext)
  ].join(':')
}

export function loadPayrollSelection(user, context = {}) {
  try {
    const raw = localStorage.getItem(buildPayrollSelectionStorageKey(user, context))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function savePayrollSelection(user, context = {}, selection = {}) {
  try {
    const key = buildPayrollSelectionStorageKey(user, context)
    const payload = {
      ...selection,
      userId: getUserId(user),
      role: user?.role || (user?.isAdmin ? 'admin' : 'user'),
      savedAt: new Date().toISOString()
    }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Ignore storage failures in private/incognito modes.
  }
}

export function loadLegacyPayrollSelection() {
  try {
    return {
      division: localStorage.getItem(LEGACY_MAINPAGE_KEYS.DIVISION) || '',
      gang: localStorage.getItem(LEGACY_MAINPAGE_KEYS.GANG) || '',
      gangPrefix: localStorage.getItem(LEGACY_MAINPAGE_KEYS.GANG_PREFIX) || ''
    }
  } catch {
    return null
  }
}

export function isValidPeriod(month, year) {
  const monthNumber = Number(month)
  const yearNumber = Number(year)
  const maxYear = new Date().getFullYear() + 1

  return Number.isInteger(monthNumber) &&
    Number.isInteger(yearNumber) &&
    monthNumber >= 1 &&
    monthNumber <= 12 &&
    yearNumber >= 2000 &&
    yearNumber <= maxYear
}

export function getAllowedDivisionsForUser(user, allDivisions = [], context = {}) {
  const { isAdminUser, externalLockedDiv, prodDivision } = context

  if (!isAdminUser && externalLockedDiv) {
    return [externalLockedDiv]
  }

  if (!isAdminUser && prodDivision) {
    return [prodDivision]
  }

  if (isAdminUser) {
    return allDivisions || []
  }

  const userDivisions = Array.isArray(user?.divisions) ? user.divisions : []
  const candidates = [...userDivisions, user?.divisi].filter(Boolean)

  if (candidates.length > 0) {
    return candidates
  }

  return allDivisions || []
}

export function isDivisionAllowed(division, allowedDivisions = [], isAdminUser = false) {
  if (!division) return false
  if (isAdminUser) return allowedDivisions.length === 0 || allowedDivisions.includes(division)
  return allowedDivisions.includes(division)
}
