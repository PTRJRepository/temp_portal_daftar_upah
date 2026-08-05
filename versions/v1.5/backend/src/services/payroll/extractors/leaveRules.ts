export interface LeaveClassificationInput {
    taskCode?: string | null;
    isSunday?: boolean;
    isHoliday?: boolean;
}

export interface LeaveClassification {
    cuti_tahunan: boolean;
    cuti_sakit_haid: boolean;
    cuti_minggu: boolean;
    cuti_nasional: boolean;
}

function normalizeTaskCode(taskCode?: string | null): string {
    return String(taskCode || '').trim().toUpperCase();
}

export function classifyLeaveDay(input: LeaveClassificationInput): LeaveClassification {
    const taskCode = normalizeTaskCode(input.taskCode);
    const isSunday = input.isSunday === true;
    const isHoliday = input.isHoliday === true;

    return {
        cuti_tahunan: taskCode.startsWith('GA9129'),
        cuti_sakit_haid: taskCode.startsWith('GA9126'),
        // Business rule: when a public holiday falls on Sunday, count it as Sunday only.
        cuti_minggu: taskCode.startsWith('GA9127') || isSunday,
        cuti_nasional: !isSunday && (taskCode.startsWith('GA9128') || isHoliday)
    };
}

export function buildLeaveSqlExpressions(lineAlias = 'trl', holidayAlias = 'h') {
    const taskCodeExpr = `${lineAlias}.TaskCode`;
    const trxDateExpr = `${lineAlias}.TrxDate`;
    const weekdayExpr = `DATEPART(weekday, ${trxDateExpr})`;
    const isSundayExpr = `${weekdayExpr} = 1`;
    const hasHolidayExpr = `EXISTS (SELECT 1 FROM HR_GPH ${holidayAlias} WHERE ${holidayAlias}.HolidayDate = ${trxDateExpr} AND ${holidayAlias}.Status = 1)`;

    return {
        cutiTahunan: `CASE WHEN ${taskCodeExpr} LIKE 'GA9129%' THEN 1 ELSE 0 END`,
        cutiSakitHaid: `CASE WHEN ${taskCodeExpr} LIKE 'GA9126%' THEN 1 ELSE 0 END`,
        cutiMinggu: `CASE WHEN ${taskCodeExpr} LIKE 'GA9127%' OR ${isSundayExpr} THEN 1 ELSE 0 END`,
        cutiNasional: `CASE WHEN ${weekdayExpr} <> 1 AND (${taskCodeExpr} LIKE 'GA9128%' OR ${hasHolidayExpr}) THEN 1 ELSE 0 END`,
        whereClause: `(
            ${taskCodeExpr} LIKE 'GA9129%'
            OR ${taskCodeExpr} LIKE 'GA9126%'
            OR ${taskCodeExpr} LIKE 'GA9127%'
            OR ${taskCodeExpr} LIKE 'GA9128%'
            OR ${isSundayExpr}
            OR ${hasHolidayExpr}
        )`
    };
}
