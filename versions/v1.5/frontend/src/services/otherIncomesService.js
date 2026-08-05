import axios from 'axios';

const api = axios;

export const otherIncomesService = {
    getIncomes: async (year, month, divisionCode, gangCode) => {
        try {
            const params = new URLSearchParams({
                year: year.toString(),
                month: month.toString()
            });

            if (divisionCode) params.append('divisionCode', divisionCode);
            if (gangCode) params.append('gangCode', gangCode);

            const response = await api.get(`other-incomes?${params.toString()}`);
            return response.data?.data || [];
        } catch (error) {
            console.error('Error fetching other incomes:', error);
            throw error;
        }
    },

    getThrSummary: async (year, month, divisionCode) => {
        try {
            const params = new URLSearchParams({
                year: year.toString(),
                month: month.toString()
            });

            if (divisionCode) params.append('divisionCode', divisionCode);

            const response = await api.get(`other-incomes/summary?${params.toString()}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching THR summary:', error);
            throw error;
        }
    },

    getThrRecapAll: async (year, month, excludeIjl = false, ijlOnly = false) => {
        try {
            const params = new URLSearchParams({
                year: year.toString(),
                month: month.toString()
            });
            if (excludeIjl) {
                params.append('exclude_ijl', 'true');
            }
            if (ijlOnly) {
                params.append('ijl_only', 'true');
            }
            const response = await api.get(`other-incomes/recap-all?${params.toString()}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching THR recap all:', error);
            throw error;
        }
    },

    addIncome: async (data) => {
        try {
            const response = await api.post('other-incomes', data);
            return response.data?.data;
        } catch (error) {
            console.error('Error adding other income:', error);
            throw error;
        }
    },

    updateIncome: async (id, data) => {
        try {
            const response = await api.put(`other-incomes/${id}`, data);
            return response.data;
        } catch (error) {
            console.error('Error updating other income:', error);
            throw error;
        }
    },

    deleteIncome: async (id) => {
        try {
            const response = await api.delete(`other-incomes/${id}`);
            return response.data;
        } catch (error) {
            console.error('Error deleting other income:', error);
            throw error;
        }
    },

    deleteByPeriod: async (year, month, divisionCode, gangCode) => {
        try {
            const params = new URLSearchParams({
                year: year.toString(),
                month: month.toString()
            });

            if (divisionCode) params.append('divisionCode', divisionCode);
            if (gangCode) params.append('gangCode', gangCode);

            const response = await api.delete(`other-incomes/delete-by-period?${params.toString()}`);
            return response.data;
        } catch (error) {
            console.error('Error deleting by period:', error);
            throw error;
        }
    },

    getBlacklist: async (year, month, type = 'THR') => {
        try {
            const response = await api.get(`other-incomes/blacklist?year=${year}&month=${month}&type=${type}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching blacklist:', error);
            throw error;
        }
    },

    removeFromBlacklist: async (id) => {
        try {
            const response = await api.delete(`other-incomes/blacklist/${id}`);
            return response.data;
        } catch (error) {
            console.error('Error removing from blacklist:', error);
            throw error;
        }
    },

    addToBlacklist: async (nik, emp_name, year, month, type = 'THR', reason = 'Manual') => {
        try {
            const response = await api.post(`other-incomes/blacklist`, { nik, emp_name, year, month, type, reason });
            return response.data;
        } catch (error) {
            console.error('Error adding to blacklist:', error);
            throw error;
        }
    },

    calculateTHR: async (year, month, divisionCode, gangCode) => {
        try {
            const data = { year, month };
            if (divisionCode) data.divisionCode = divisionCode;
            if (gangCode) data.gangCode = gangCode;

            const response = await api.post('other-incomes/calculate-thr', data);
            return response.data;
        } catch (error) {
            console.error('Error calculating THR:', error);
            throw error;
        }
    },

    previewTHR: async (year, month, divisionCode, gangCode) => {
        try {
            const data = { year, month };
            if (divisionCode) data.divisionCode = divisionCode;
            if (gangCode) data.gangCode = gangCode;

            const response = await api.post('other-incomes/preview-thr', data);
            return response.data;
        } catch (error) {
            console.error('Error previewing THR:', error);
            throw error;
        }
    },

    bulkSave: async (incomes) => {
        try {
            const response = await api.post('other-incomes/bulk-save', { incomes });
            return response.data;
        } catch (error) {
            console.error('Error bulk saving incomes:', error);
            throw error;
        }
    },

    getFormula: async (type) => {
        try {
            const response = await api.get(`other-incomes/formulas/${type}`);
            return response.data?.formula || '';
        } catch (error) {
            console.error('Error fetching formula:', error);
            throw error;
        }
    },

    saveFormula: async (type, formulaString) => {
        try {
            const response = await api.post(`other-incomes/formulas/${type}`, { formulaString });
            return response.data;
        } catch (error) {
            console.error('Error saving formula:', error);
            throw error;
        }
    },

    exportExcel: async (year, month, divisionCode, gangCode, incomeType) => {
        try {
            const params = new URLSearchParams({
                year: year.toString(),
                month: month.toString()
            });

            if (divisionCode) params.append('divisionCode', divisionCode);
            if (gangCode) params.append('gangCode', gangCode);
            if (incomeType && incomeType !== 'TOTAL') params.append('incomeType', incomeType);

            const response = await api.get(`other-incomes/export?${params.toString()}`, {
                responseType: 'blob'
            });

            // Create download link
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            const prefix = incomeType && incomeType !== 'TOTAL' ? incomeType : 'Other_Incomes';
            link.setAttribute('download', `Laporan_${prefix}_${month}_${year}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            return true;
        } catch (error) {
            console.error('Error exporting excel:', error);
            throw error;
        }
    },

    exportBankListExcel: async (year, month, divisionCode, gangCode) => {
        try {
            const params = new URLSearchParams({
                year: year.toString(),
                month: month.toString()
            });

            if (divisionCode) params.append('divisionCode', divisionCode);
            if (gangCode) params.append('gangCode', gangCode);

            const response = await api.get(`other-incomes/export-bank-list?${params.toString()}`, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Bank_List_THR_${month}_${year}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            return true;
        } catch (error) {
            console.error('Error exporting bank list excel:', error);
            throw error;
        }
    },

    // EMP-CODE BASIS: Get gang members from history_gang_member for THR display
    getGangMembers: async (month, year, gangCode, divisionCode) => {
        try {
            const params = new URLSearchParams({
                month: month.toString(),
                year: year.toString()
            });
            if (gangCode && gangCode !== 'ALL') params.append('gang_code', gangCode);
            if (divisionCode && divisionCode !== 'ALL') params.append('division_code', divisionCode);

            const response = await api.get(`other-incomes/gang-members?${params.toString()}`);
            return response.data || [];
        } catch (error) {
            console.error('Error fetching gang members:', error);
            throw error;
        }
    },

    exportTHRExcel: async (year, month, divisionCode, gangCode) => {
        try {
            const params = new URLSearchParams({
                year: year.toString(),
                month: month.toString()
            });

            if (divisionCode) params.append('divisionCode', divisionCode);
            if (gangCode) params.append('gangCode', gangCode);

            const response = await api.get(`other-incomes/export-thr?${params.toString()}`, {
                responseType: 'blob'
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `Laporan_THR_${month}_${year}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            return true;
        } catch (error) {
            console.error('Error exporting THR excel:', error);
            throw error;
        }
    }
};
