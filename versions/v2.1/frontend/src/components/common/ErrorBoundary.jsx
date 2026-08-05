import React from 'react';

/**
 * ErrorBoundary — Catches render errors in lazy-loaded pages.
 * Provides a retry button to force re-render and recover from
 * chunk loading failures or transient errors.
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo });
        console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    handleHardRefresh = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            const isChunkError = this.state.error?.message?.includes('Loading chunk') ||
                this.state.error?.message?.includes('Failed to fetch dynamically imported module') ||
                this.state.error?.message?.includes('Importing a module script failed');

            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '100vh',
                    backgroundColor: '#f8fafc',
                    fontFamily: "'Inter', 'Segoe UI', Roboto, sans-serif",
                    padding: '2rem'
                }}>
                    <div style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '12px',
                        padding: '3rem',
                        maxWidth: '480px',
                        width: '100%',
                        textAlign: 'center',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                        border: '1px solid #e2e8f0'
                    }}>
                        {/* Icon */}
                        <div style={{
                            width: '64px',
                            height: '64px',
                            borderRadius: '50%',
                            backgroundColor: isChunkError ? '#fef3c7' : '#fee2e2',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem',
                            fontSize: '28px'
                        }}>
                            {isChunkError ? '🔄' : '⚠️'}
                        </div>

                        {/* Title */}
                        <h2 style={{
                            margin: '0 0 0.75rem',
                            fontSize: '1.25rem',
                            fontWeight: '700',
                            color: '#1e293b'
                        }}>
                            {isChunkError ? 'Koneksi Terputus' : 'Terjadi Kesalahan'}
                        </h2>

                        {/* Description */}
                        <p style={{
                            margin: '0 0 2rem',
                            fontSize: '0.9rem',
                            color: '#64748b',
                            lineHeight: '1.6'
                        }}>
                            {isChunkError
                                ? 'Halaman gagal dimuat. Periksa koneksi internet Anda dan coba lagi.'
                                : 'Halaman ini mengalami kesalahan saat dimuat. Coba muat ulang halaman.'
                            }
                        </p>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                            <button
                                onClick={this.handleRetry}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    backgroundColor: '#3b82f6',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontWeight: '600',
                                    fontSize: '0.9rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                            >
                                🔄 Coba Lagi
                            </button>

                            <button
                                onClick={this.handleHardRefresh}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    backgroundColor: '#ffffff',
                                    color: '#475569',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '8px',
                                    fontWeight: '600',
                                    fontSize: '0.9rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.borderColor = '#94a3b8';
                                    e.currentTarget.style.backgroundColor = '#f8fafc';
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.borderColor = '#cbd5e1';
                                    e.currentTarget.style.backgroundColor = '#ffffff';
                                }}
                            >
                                Refresh Halaman
                            </button>
                        </div>

                        {/* Technical Detail (collapsed) */}
                        {this.state.error && (
                            <details style={{ marginTop: '1.5rem', textAlign: 'left' }}>
                                <summary style={{
                                    fontSize: '0.75rem',
                                    color: '#94a3b8',
                                    cursor: 'pointer',
                                    fontWeight: '500'
                                }}>
                                    Detail Teknis
                                </summary>
                                <pre style={{
                                    marginTop: '0.5rem',
                                    padding: '0.75rem',
                                    backgroundColor: '#f1f5f9',
                                    borderRadius: '6px',
                                    fontSize: '0.7rem',
                                    color: '#64748b',
                                    overflow: 'auto',
                                    maxHeight: '120px',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all'
                                }}>
                                    {this.state.error.toString()}
                                </pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
