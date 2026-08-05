import React, { useEffect, useRef } from 'react';

export default function TableContextMenu({ x, y, options, onClose }) {
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [onClose]);

    if (!options || options.length === 0) return null;

    return (
        <div
            className="context-menu"
            style={{ top: y, left: x }}
            ref={menuRef}
        >
            {options.map((item, index) => {
                if (item === 'separator') {
                    return <div key={index} className="context-menu-separator" />;
                }
                return (
                    <div
                        key={index}
                        className="context-menu-item"
                        onClick={(e) => {
                            e.stopPropagation();
                            item.action();
                            onClose();
                        }}
                    >
                        {item.label}
                    </div>
                );
            })}
        </div>
    );
}
