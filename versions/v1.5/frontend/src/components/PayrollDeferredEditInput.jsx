import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

const toDraftValue = (value, emptyWhenZero = false) => {
    if (value === null || value === undefined) return '';
    if (emptyWhenZero && Number(value) === 0) return '';
    return String(value);
};

export const DeferredPayrollNumberInput = memo(function DeferredPayrollNumberInput({
    value,
    onCommit,
    className = '',
    placeholder = '0',
    style,
    emptyWhenZero = false,
    onBlur,
    onFocus,
    onChange,
    onKeyDown,
    ...inputProps
}) {
    const [draft, setDraft] = useState(() => toDraftValue(value, emptyWhenZero));
    const focusedRef = useRef(false);
    const lastCommittedRef = useRef(toDraftValue(value, emptyWhenZero));
    const skipNextBlurCommitRef = useRef(false);

    useEffect(() => {
        const nextDraft = toDraftValue(value, emptyWhenZero);
        lastCommittedRef.current = nextDraft;
        if (!focusedRef.current) {
            setDraft(nextDraft);
        }
    }, [emptyWhenZero, value]);

    const commitDraft = useCallback(() => {
        const nextDraft = String(draft ?? '');
        if (nextDraft === lastCommittedRef.current) return;
        lastCommittedRef.current = nextDraft;
        onCommit?.(nextDraft);
    }, [draft, onCommit]);

    const handleBlur = useCallback((event) => {
        focusedRef.current = false;
        onBlur?.(event);
        if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
            return;
        }
        commitDraft();
    }, [commitDraft, onBlur]);

    const handleFocus = useCallback((event) => {
        focusedRef.current = true;
        onFocus?.(event);
    }, [onFocus]);

    const handleChange = useCallback((event) => {
        setDraft(event.target.value);
        onChange?.(event);
    }, [onChange]);

    const handleKeyDown = useCallback((event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;

        if (event.key === 'Enter') {
            commitDraft();
            event.currentTarget.blur();
            return;
        }

        if (event.key === 'Escape') {
            skipNextBlurCommitRef.current = true;
            setDraft(lastCommittedRef.current);
            event.currentTarget.blur();
        }
    }, [commitDraft, onKeyDown]);

    const stopCellSelection = useCallback((event) => {
        event.stopPropagation();
    }, []);

    return (
        <input
            {...inputProps}
            type="text"
            inputMode="decimal"
            className={className}
            value={draft}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onClick={stopCellSelection}
            onMouseDown={stopCellSelection}
            placeholder={placeholder}
            style={style}
        />
    );
});
