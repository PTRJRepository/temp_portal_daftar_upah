const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const getMillProductionSummary = async (month, year) => {
    try {
        const response = await fetch(`${API_BASE_URL}/mill-production/summary?month=${month}&year=${year}`);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error fetching mill production: ${response.status} ${errorText}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || "Failed to get mill production data");
        }

        return result.data;
    } catch (error) {
        console.error("MillProductionService getSummary error:", error);
        throw error;
    }
};
