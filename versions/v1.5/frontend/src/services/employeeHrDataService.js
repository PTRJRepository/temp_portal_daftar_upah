import axios from 'axios';

export const employeeHrDataService = {
    /**
     * Bulk fetch HR data for multiple employees
     */
    getHrDataBulk: async (empCodes) => {
        if (!empCodes || empCodes.length === 0) return { success: true, data: {} };
        try {
            const codes = Array.isArray(empCodes) ? empCodes.join(',') : empCodes;
            const response = await axios.get(`/employee-hr-data/bulk?emp_codes=${codes}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching bulk HR data:', error);
            throw error;
        }
    },

    /**
     * Update a specific HR data field for an employee
     */
    updateHrDataField: async (empCode, field, value) => {
        try {
            const response = await axios.put(`/employee-hr-data/${empCode}`, {
                field,
                value
            });
            return response.data;
        } catch (error) {
            console.error(`Error updating ${field} for ${empCode}:`, error);
            throw error;
        }
    },

    /**
     * Get HR data history for an employee
     */
    getHrDataHistory: async (empCode) => {
        try {
            const response = await axios.get(`/employee-hr-data/${empCode}/history`);
            return response.data;
        } catch (error) {
            console.error(`Error fetching history for ${empCode}:`, error);
            throw error;
        }
    }
};
