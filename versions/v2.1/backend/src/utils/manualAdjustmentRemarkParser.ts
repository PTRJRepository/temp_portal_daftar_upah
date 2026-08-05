export interface ManualAdjustmentAdCodeInference {
    adCode: string | null;
    adCodeDesc: string | null;
}

export interface PipeDelimitedRemarksParts {
    adjustmentName: string | null;
    adCodePart: string | null;
    adCode: string | null;
    adCodeDesc: string | null;
    amount: number | null;
    syncStatus: string | null;
    matchStatus: string | null;
}

export interface PipeDelimitedSyncStatusUpdate {
    remarks: string;
    oldSyncStatus: string;
    newSyncStatus: string;
    changed: boolean;
}

export interface PipeDelimitedSyncAndMatchStatusUpdate {
    remarks: string;
    oldSyncStatus: string;
    newSyncStatus: string;
    oldMatchStatus: string;
    newMatchStatus: string;
    changed: boolean;
}

function normalizeSpaces(value: unknown): string {
    return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeManualAdjustmentPresetName(value: unknown): string {
    const firstSegment = normalizeSpaces(value).split("|")[0] || "";
    return normalizeSpaces(firstSegment).toUpperCase();
}

function cleanDescription(value: string | undefined): string | null {
    const cleaned = normalizeSpaces(value || "").replace(/\|.*$/, "").trim();
    return cleaned || null;
}

const AD_CODE_CAPTURE = "([A-Z]{2}\\d[A-Z0-9_-]*)";
const TASK_DESC_DISPLAY_PREFIX = /^\((AL|DE)\)\s+.+/i;

function splitTaskDescDisplayPair(value: string): { adCode: string; adCodeDesc: string } | null {
    const text = normalizeSpaces(value);
    if (!TASK_DESC_DISPLAY_PREFIX.test(text)) return null;

    const separators = Array.from(text.matchAll(/\s+-\s+\((?:AL|DE)\)\s+/gi));
    if (separators.length === 0) {
        return { adCode: text, adCodeDesc: text };
    }

    const separatorIndex = separators[separators.length - 1].index;
    if (separatorIndex == null) return { adCode: text, adCodeDesc: text };

    const adCode = text.slice(0, separatorIndex).trim();
    const adCodeDesc = text.slice(separatorIndex).replace(/^\s+-\s+/, "").trim();
    if (!TASK_DESC_DISPLAY_PREFIX.test(adCode) || !TASK_DESC_DISPLAY_PREFIX.test(adCodeDesc)) {
        return { adCode: text, adCodeDesc: text };
    }

    return { adCode, adCodeDesc };
}

function parseAdCodePart(value: unknown): ManualAdjustmentAdCodeInference {
    const text = normalizeSpaces(value);
    if (!text) return { adCode: null, adCodeDesc: null };

    const rawCodeMatch = text.match(new RegExp(`^${AD_CODE_CAPTURE}\\s*(?:-\\s*(.+))?$`, "i"));
    if (rawCodeMatch) {
        return {
            adCode: rawCodeMatch[1].toUpperCase(),
            adCodeDesc: cleanDescription(rawCodeMatch[2])
        };
    }

    const parenthesizedCodeMatch = text.match(new RegExp(`^\\(${AD_CODE_CAPTURE}\\)\\s*(.+)$`, "i"));
    if (parenthesizedCodeMatch) {
        const taskDescPart = parenthesizedCodeMatch[2];
        const taskDescDisplay = splitTaskDescDisplayPair(taskDescPart);
        return {
            adCode: parenthesizedCodeMatch[1].toUpperCase(),
            adCodeDesc: taskDescDisplay?.adCodeDesc || cleanDescription(taskDescPart)
        };
    }

    const taskDescDisplay = splitTaskDescDisplayPair(text);
    if (taskDescDisplay) {
        return taskDescDisplay;
    }

    return { adCode: null, adCodeDesc: null };
}

export function inferManualAdjustmentAdCodeFromRemarks(value: unknown): ManualAdjustmentAdCodeInference {
    const remarks = normalizeSpaces(value);
    if (!remarks) return { adCode: null, adCodeDesc: null };

    const adCodeLabelMatch = remarks.match(/AD\s*CODE\s*:\s*([^|]+)/i);
    if (adCodeLabelMatch) {
        return parseAdCodePart(adCodeLabelMatch[1]);
    }

    if (remarks.includes("|")) {
        const pipeSegments = remarks.split("|").map((segment) => segment.trim());
        return parseAdCodePart(pipeSegments[1]);
    }

    return { adCode: null, adCodeDesc: null };
}

/**
 * Parse pipe-delimited remarks template into structured parts.
 * Format: ADJUSTMENT_NAME | AD_CODE - DESC | AMOUNT | sync:STATUS | match:STATUS
 */
export function parsePipeDelimitedRemarks(value: unknown): PipeDelimitedRemarksParts {
    const remarks = normalizeSpaces(value);
    if (!remarks || !remarks.includes("|")) {
        return {
            adjustmentName: null,
            adCodePart: null,
            adCode: null,
            adCodeDesc: null,
            amount: null,
            syncStatus: null,
            matchStatus: null
        };
    }

    const segments = remarks.split("|").map((s) => s.trim());
    const adjustmentName = segments[0] || null;

    // Parse second segment: AD_CODE - DESC
    let adCodePart: string | null = null;
    let adCode: string | null = null;
    let adCodeDesc: string | null = null;
    if (segments[1]) {
        adCodePart = segments[1];
        const parsedAdCode = parseAdCodePart(segments[1]);
        adCode = parsedAdCode.adCode;
        adCodeDesc = parsedAdCode.adCodeDesc;
    }

    // Parse amount
    let amount: number | null = null;
    if (segments[2]) {
        const amountMatch = segments[2].match(/^(-?\d+(?:\.\d+)?)$/);
        if (amountMatch) {
            amount = parseFloat(amountMatch[1]);
        }
    }

    // Parse sync: and match: statuses
    let syncStatus: string | null = null;
    let matchStatus: string | null = null;
    for (let i = 3; i < segments.length; i++) {
        const seg = segments[i];
        const syncMatch = seg.match(/^sync:\s*(\w+)$/i);
        if (syncMatch) syncStatus = syncMatch[1].toUpperCase();
        const matchMatch = seg.match(/^match:\s*(\w+)$/i);
        if (matchMatch) matchStatus = matchMatch[1].toUpperCase();
    }

    return { adjustmentName, adCodePart, adCode, adCodeDesc, amount, syncStatus, matchStatus };
}

export function updatePipeDelimitedSyncStatus(value: unknown, status: unknown): PipeDelimitedSyncStatusUpdate | null {
    const originalRemarks = String(value || "").trim();
    if (!originalRemarks || !originalRemarks.includes("|")) return null;

    const newSyncStatus = normalizeSpaces(status).toUpperCase();
    if (!newSyncStatus) return null;

    const segments = originalRemarks.split("|").map((segment) => segment.trim());
    const syncSegmentIndex = segments.findIndex((segment) => /^sync:\s*\w+$/i.test(segment));
    if (syncSegmentIndex < 0) return null;

    const oldSyncStatus = segments[syncSegmentIndex].match(/^sync:\s*(\w+)$/i)?.[1]?.toUpperCase();
    if (!oldSyncStatus) return null;

    if (oldSyncStatus === newSyncStatus) {
        return {
            remarks: originalRemarks,
            oldSyncStatus,
            newSyncStatus,
            changed: false
        };
    }

    segments[syncSegmentIndex] = `sync:${newSyncStatus}`;

    return {
        remarks: segments.join(" | "),
        oldSyncStatus,
        newSyncStatus,
        changed: true
    };
}

export function updatePipeDelimitedSyncAndMatchStatus(
    value: unknown,
    syncStatus: unknown,
    matchStatus: unknown
): PipeDelimitedSyncAndMatchStatusUpdate | null {
    const originalRemarks = String(value || "").trim();
    if (!originalRemarks || !originalRemarks.includes("|")) return null;

    const newSyncStatus = normalizeSpaces(syncStatus).toUpperCase();
    const newMatchStatus = normalizeSpaces(matchStatus).toUpperCase();
    if (!newSyncStatus || !newMatchStatus) return null;

    const segments = originalRemarks.split("|").map((segment) => segment.trim());
    const syncSegmentIndex = segments.findIndex((segment) => /^sync:\s*\w+$/i.test(segment));
    const matchSegmentIndex = segments.findIndex((segment) => /^match:\s*\w+$/i.test(segment));
    if (syncSegmentIndex < 0 || matchSegmentIndex < 0) return null;

    const oldSyncStatus = segments[syncSegmentIndex].match(/^sync:\s*(\w+)$/i)?.[1]?.toUpperCase();
    const oldMatchStatus = segments[matchSegmentIndex].match(/^match:\s*(\w+)$/i)?.[1]?.toUpperCase();
    if (!oldSyncStatus || !oldMatchStatus) return null;

    const changed = oldSyncStatus !== newSyncStatus || oldMatchStatus !== newMatchStatus;
    if (!changed) {
        return {
            remarks: originalRemarks,
            oldSyncStatus,
            newSyncStatus,
            oldMatchStatus,
            newMatchStatus,
            changed: false
        };
    }

    segments[syncSegmentIndex] = `sync:${newSyncStatus}`;
    segments[matchSegmentIndex] = `match:${newMatchStatus}`;

    return {
        remarks: segments.join(" | "),
        oldSyncStatus,
        newSyncStatus,
        oldMatchStatus,
        newMatchStatus,
        changed: true
    };
}
