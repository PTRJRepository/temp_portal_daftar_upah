import { getPayrollHeaderGroup } from './payrollHeaderGroups.js';

export const PAYROLL_HEADER_RENDER_CONFIG = Object.freeze({
    maxDepth: 4
});

const normalizeHeaderPath = (headers = [], maxDepth = PAYROLL_HEADER_RENDER_CONFIG.maxDepth) => {
    const compactPath = (Array.isArray(headers) ? headers : [])
        .filter((item) => item !== null && item !== undefined)
        .slice(0, maxDepth);

    return compactPath.length > 0 ? compactPath : [''];
};

const getStickyBoundaryKey = (column) => (column?.left !== undefined ? 'sticky' : 'flow');

export const getPayrollChapterWindowForGroup = (chapters = [], group) => {
    const target = chapters.find((chapter) => chapter.group === group);
    const totalWidth = chapters[chapters.length - 1]?.end || 0;

    if (!target || totalWidth <= 0) {
        return { startRatio: 0, widthRatio: 1 };
    }

    return {
        startRatio: Math.max(0, Math.min(1, target.start / totalWidth)),
        widthRatio: Math.max(0.06, Math.min(1, target.width / totalWidth))
    };
};

export const buildPayrollHeaderRows = ({
    columnDefs = [],
    getHeaderStyle = () => ({})
} = {}) => {
    if (!Array.isArray(columnDefs) || columnDefs.length === 0) return [];

    const normalizedColumns = columnDefs.map((column) => ({
        column,
        path: normalizeHeaderPath(column.headers),
        stickyBoundaryKey: getStickyBoundaryKey(column)
    }));

    const depth = Math.max(
        PAYROLL_HEADER_RENDER_CONFIG.maxDepth,
        ...normalizedColumns.map((item) => item.path.length)
    );
    const rows = Array.from({ length: depth }, () => []);

    for (let rowIndex = 0; rowIndex < depth; rowIndex += 1) {
        let colIndex = 0;

        while (colIndex < normalizedColumns.length) {
            const current = normalizedColumns[colIndex];
            const currentLabel = current.path[rowIndex];

            if (currentLabel === undefined) {
                colIndex += 1;
                continue;
            }

            let colSpan = 1;
            while (colIndex + colSpan < normalizedColumns.length) {
                const next = normalizedColumns[colIndex + colSpan];
                const sameStickyBoundary = next.stickyBoundaryKey === current.stickyBoundaryKey;
                const sameLabel = next.path[rowIndex] === currentLabel;

                if (!sameStickyBoundary || !sameLabel) break;

                let sameAncestors = true;
                for (let ancestorIndex = 0; ancestorIndex < rowIndex; ancestorIndex += 1) {
                    if (next.path[ancestorIndex] !== current.path[ancestorIndex]) {
                        sameAncestors = false;
                        break;
                    }
                }

                if (!sameAncestors) break;
                colSpan += 1;
            }

            const rowSpan = current.path[rowIndex + 1] === undefined ? (depth - rowIndex) : 1;
            const colObj = current.column;

            rows[rowIndex].push({
                label: currentLabel,
                colSpan,
                rowSpan,
                isSticky: current.stickyBoundaryKey === 'sticky',
                left: colObj.left,
                headerGroup: getPayrollHeaderGroup(colObj.headers?.[0]),
                headerStyle: getHeaderStyle(currentLabel, rowIndex),
                level: rowIndex,
                field: colSpan === 1 ? colObj.field : null,
                sortable: colSpan === 1 && ['emp_code', 'nik', 'nama'].includes(colObj.field),
                isCheckboxHeader: colObj.field === 'checkbox' && rowIndex === (current.path.length - 1),
                topHeader: getPayrollHeaderGroup(colObj.headers?.[0]) || colObj.headers?.[0] || '',
                stickyBoundaryKey: current.stickyBoundaryKey
            });

            colIndex += colSpan;
        }
    }

    return rows;
};
