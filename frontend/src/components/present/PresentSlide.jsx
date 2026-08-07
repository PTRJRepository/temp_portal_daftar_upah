import React from 'react';

export function PresentSlide({ num, title, subtitle, id, children }) {
    return (
        <section id={id} className="present-slide" data-num={num} data-title={title}>
            <header className="present-slide-header">
                <span className="present-slide-num">{num}</span>
                <div>
                    <h2>{title}</h2>
                    {subtitle && <p>{subtitle}</p>}
                </div>
                <span className="present-slide-kicker">Slide {num}</span>
            </header>
            <div className="present-slide-body">{children}</div>
        </section>
    );
}

export default PresentSlide;
