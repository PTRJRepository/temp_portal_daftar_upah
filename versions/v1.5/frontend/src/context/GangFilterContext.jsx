import React, { createContext, useContext, useReducer, useEffect } from 'react'
import GangFilterService from '../services/gangFilterService'

// Initial state
const initialState = {
  filters: {
    divisions: [],
    subDivisions: [],
    hasActiveFilter: false
  },
  availableData: {
    gangs: [],
    divisions: []
  },
  stats: {
    totalGangs: 0,
    filteredGangsCount: 0,
    totalInSelection: 0,
    availableSubDivisions: []
  },
  isLoading: false,
  error: null
}

// Action types
const GANG_FILTER_ACTIONS = {
  SET_LOADING: 'SET_LOADING',
  SET_ERROR: 'SET_ERROR',
  SET_AVAILABLE_DATA: 'SET_AVAILABLE_DATA',
  SET_FILTERS: 'SET_FILTERS',
  ADD_DIVISION_FILTER: 'ADD_DIVISION_FILTER',
  REMOVE_DIVISION_FILTER: 'REMOVE_DIVISION_FILTER',
  ADD_SUBDIVISION_FILTER: 'ADD_SUBDIVISION_FILTER',
  REMOVE_SUBDIVISION_FILTER: 'REMOVE_SUBDIVISION_FILTER',
  CLEAR_FILTERS: 'CLEAR_FILTERS',
  UPDATE_STATS: 'UPDATE_STATS',
  LOAD_SAVED_FILTERS: 'LOAD_SAVED_FILTERS'
}

// Reducer function
function gangFilterReducer(state, action) {
  switch (action.type) {
    case GANG_FILTER_ACTIONS.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload
      }

    case GANG_FILTER_ACTIONS.SET_ERROR:
      return {
        ...state,
        error: action.payload,
        isLoading: false
      }

    case GANG_FILTER_ACTIONS.SET_AVAILABLE_DATA:
      return {
        ...state,
        availableData: action.payload,
        isLoading: false,
        error: null
      }

    case GANG_FILTER_ACTIONS.SET_FILTERS:
      return {
        ...state,
        filters: action.payload,
        error: null
      }

    case GANG_FILTER_ACTIONS.ADD_DIVISION_FILTER:
      return {
        ...state,
        filters: {
          ...state.filters,
          divisions: [...state.filters.divisions, action.payload],
          hasActiveFilter: true
        }
      }

    case GANG_FILTER_ACTIONS.REMOVE_DIVISION_FILTER:
      const newDivisions = state.filters.divisions.filter(
        d => d !== action.payload
      )
      return {
        ...state,
        filters: {
          ...state.filters,
          divisions: newDivisions,
          hasActiveFilter: newDivisions.length > 0 || state.filters.subDivisions.length > 0
        }
      }

    case GANG_FILTER_ACTIONS.ADD_SUBDIVISION_FILTER:
      return {
        ...state,
        filters: {
          ...state.filters,
          subDivisions: [...state.filters.subDivisions, action.payload],
          hasActiveFilter: true
        }
      }

    case GANG_FILTER_ACTIONS.REMOVE_SUBDIVISION_FILTER:
      const newSubDivisions = state.filters.subDivisions.filter(
        s => s !== action.payload
      )
      return {
        ...state,
        filters: {
          ...state.filters,
          subDivisions: newSubDivisions,
          hasActiveFilter: state.filters.divisions.length > 0 || newSubDivisions.length > 0
        }
      }

    case GANG_FILTER_ACTIONS.CLEAR_FILTERS:
      return {
        ...state,
        filters: {
          divisions: [],
          subDivisions: [],
          hasActiveFilter: false
        }
      }

    case GANG_FILTER_ACTIONS.UPDATE_STATS:
      return {
        ...state,
        stats: action.payload
      }

    case GANG_FILTER_ACTIONS.LOAD_SAVED_FILTERS:
      return {
        ...state,
        filters: action.payload
      }

    default:
      return state
  }
}

// Create context
const GangFilterContext = createContext()

// Provider component
export function GangFilterProvider({ children }) {
  const [state, dispatch] = useReducer(gangFilterReducer, initialState)

  // Update stats whenever data or filters change
  useEffect(() => {
    const stats = GangFilterService.getFilterStats(
      state.availableData.gangs,
      state.filters
    )
    dispatch({
      type: GANG_FILTER_ACTIONS.UPDATE_STATS,
      payload: stats
    })
  }, [state.availableData, state.filters])

  // Load saved filters on mount
  useEffect(() => {
    const savedFilters = GangFilterService.loadFiltersFromStorage()
    if (Object.keys(savedFilters).length > 0) {
      dispatch({
        type: GANG_FILTER_ACTIONS.LOAD_SAVED_FILTERS,
        payload: savedFilters
      })
    }
  }, [])

  // Action creators
  const actions = {
    setLoading: (isLoading) => {
      dispatch({
        type: GANG_FILTER_ACTIONS.SET_LOADING,
        payload: isLoading
      })
    },

    setError: (error) => {
      dispatch({
        type: GANG_FILTER_ACTIONS.SET_ERROR,
        payload: error
      })
    },

    setAvailableData: (data) => {
      // Transform division objects to strings (extract .code)
      // API returns objects like {code, name, type, aliases, description}
      // but GangFilter component expects string codes
      const transformedData = {
        gangs: data.gangs || [],
        divisions: (data.divisions || []).map(d => typeof d === 'object' ? d.code : d)
      }
      dispatch({
        type: GANG_FILTER_ACTIONS.SET_AVAILABLE_DATA,
        payload: transformedData
      })
    },

    setFilters: (filters) => {
      dispatch({
        type: GANG_FILTER_ACTIONS.SET_FILTERS,
        payload: filters
      })
      // Save to localStorage
      GangFilterService.saveFiltersToStorage(filters)
    },

    addDivisionFilter: (division) => {
      dispatch({
        type: GANG_FILTER_ACTIONS.ADD_DIVISION_FILTER,
        payload: division
      })
    },

    removeDivisionFilter: (division) => {
      dispatch({
        type: GANG_FILTER_ACTIONS.REMOVE_DIVISION_FILTER,
        payload: division
      })
    },

    addSubDivisionFilter: (subDivision) => {
      dispatch({
        type: GANG_FILTER_ACTIONS.ADD_SUBDIVISION_FILTER,
        payload: subDivision
      })
    },

    removeSubDivisionFilter: (subDivision) => {
      dispatch({
        type: GANG_FILTER_ACTIONS.REMOVE_SUBDIVISION_FILTER,
        payload: subDivision
      })
    },

    clearFilters: () => {
      dispatch({
        type: GANG_FILTER_ACTIONS.CLEAR_FILTERS
      })
      GangFilterService.clearFiltersFromStorage()
    },

    toggleDivisionFilter: (division) => {
      if (state.filters.divisions.includes(division)) {
        actions.removeDivisionFilter(division)
      } else {
        actions.addDivisionFilter(division)
      }
    },

    toggleSubDivisionFilter: (subDivision) => {
      if (state.filters.subDivisions.includes(subDivision)) {
        actions.removeSubDivisionFilter(subDivision)
      } else {
        actions.addSubDivisionFilter(subDivision)
      }
    },

    selectAllSubDivisions: () => {
      const allSubDivisions = GangFilterService.getUniqueSubDivisions(
        state.availableData.gangs
      )
      actions.setFilters({
        ...state.filters,
        subDivisions: allSubDivisions,
        hasActiveFilter: true
      })
    },

    clearSubDivisionFilters: () => {
      actions.setFilters({
        ...state.filters,
        subDivisions: [],
        hasActiveFilter: state.filters.divisions.length > 0
      })
    },

    // Utility methods
    getFilteredGangs: () => {
      return GangFilterService.applyFilters(
        state.availableData.gangs,
        state.filters
      )
    },

    getGangGrouping: () => {
      return GangFilterService.groupGangsBySubDivision(
        state.availableData.gangs
      )
    },

    getFilterSummary: () => {
      return GangFilterService.createFilterSummary(
        state.filters,
        state.availableData.gangs
      )
    },

    validateFilters: () => {
      return GangFilterService.validateFilters(
        state.filters,
        state.availableData
      )
    },

    getRecommendedFilters: () => {
      return GangFilterService.getRecommendedFilters(
        state.availableData.gangs
      )
    }
  }

  const value = {
    ...state,
    ...actions
  }

  return (
    <GangFilterContext.Provider value={value}>
      {children}
    </GangFilterContext.Provider>
  )
}

// Custom hook to use the context
export function useGangFilter() {
  const context = useContext(GangFilterContext)
  if (!context) {
    throw new Error('useGangFilter must be used within a GangFilterProvider')
  }
  return context
}

export default GangFilterContext