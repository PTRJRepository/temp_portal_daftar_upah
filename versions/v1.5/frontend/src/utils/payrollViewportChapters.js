import { getPayrollHeaderGroup } from './payrollHeaderGroups';

export const resolvePayrollDisplayModeState = (state = {}) => ({
    mode: state.mode === 'simple' ? 'simple' : 'detail',
    focusLens: state.focusLens === true
});

export const buildPayrollViewportChapters = (columnDefs = []) => {
    const chapters = [];
    let start = 0;

    for (const column of columnDefs) {
        const width = Number(column?.w) || 0;
        const group = getPayrollHeaderGroup(column?.headers?.[0]);

        if (!group || width <= 0) {
            start += width;
            continue;
        }

        const lastChapter = chapters[chapters.length - 1];
        if (lastChapter?.group === group) {
            lastChapter.width += width;
            lastChapter.end += width;
        } else {
            chapters.push({
                group,
                start,
                width,
                end: start + width
            });
        }

        start += width;
    }

    const totalWidth = chapters.reduce((sum, chapter) => sum + chapter.width, 0);
    return chapters.map((chapter) => ({
        ...chapter,
        ratio: totalWidth > 0 ? chapter.width / totalWidth : 0
    }));
};

export const detectActivePayrollChapter = (chapters = [], viewport = {}) => {
    if (!chapters.length) return null;

    const scrollLeft = Number(viewport.scrollLeft) || 0;
    const clientWidth = Math.max(0, Number(viewport.clientWidth) || 0);
    const stickyOffset = Math.max(0, Number(viewport.stickyOffset) || 0);
    const anchorOffset = clientWidth > 0
        ? Math.min(Math.max(stickyOffset + 1, 1), clientWidth - 1)
        : stickyOffset + 1;
    const anchor = scrollLeft + anchorOffset;

    const active = chapters.find((chapter) => anchor >= chapter.start && anchor < chapter.end);
    if (active?.group) return active.group;

    const fallback = [...chapters].reverse().find((chapter) => anchor >= chapter.start);
    return fallback?.group || chapters[0].group;
};

export const getPayrollChapterScrollLeft = (chapters = [], group) => {
    const chapter = chapters.find((item) => item.group === group);
    return chapter ? chapter.start : 0;
};

export const getPayrollViewportWindow = (chapters = [], viewport = {}) => {
    if (!chapters.length) {
        return { startRatio: 0, widthRatio: 1 };
    }

    const totalWidth = chapters[chapters.length - 1]?.end || 0;
    if (totalWidth <= 0) {
        return { startRatio: 0, widthRatio: 1 };
    }

    const scrollLeft = Math.max(0, Number(viewport.scrollLeft) || 0);
    const clientWidth = Math.max(0, Number(viewport.clientWidth) || 0);
    const startRatio = Math.min(1, scrollLeft / totalWidth);
    const widthRatio = Math.min(1, Math.max(clientWidth / totalWidth, 0.06));

    return {
        startRatio,
        widthRatio
    };
};
