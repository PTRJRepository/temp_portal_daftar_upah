/**
 * Server Monitoring Dashboard
 *
 * Fetches from:
 *   GET /api/monitor/system  - CPU, Memory, Uptime stats
 *   GET /api/monitor/services - Service status list
 *   GET /api/monitor/process  - Process memory/CPU usage
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import './ServerMonitor.css';
import { SystemInfo, ServiceInfo, ProcessInfo, ChartDataPoint } from './types';
import { CpuChart } from './Charts';

// ========================
// UTILITY FUNCTIONS
// ========================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ========================
// API TYPES (Backend Response)
// ========================

interface BackendSystemResponse {
  uptime: number;
  uptime_formatted: string;
  loadavg: number[];
  memory: {
    total: number;
    used: number;
    free: number;
    usage_percent: number;
  };
  cpu: {
    count: number;
    usage_percent: number;
    model: string;
    speed: number;
  };
  platform: string;
  hostname: string;
  arch: string;
  release: string;
  timestamp: string;
}

interface BackendServicesResponse {
  services: Array<{
    name: string;
    port: number;
    type: string;
    status: 'online' | 'offline' | 'unknown' | 'checking';
    last_check?: string;
  }>;
  timestamp: string;
}

interface BackendProcessResponse {
  pid: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  timestamp: string;
}

// ========================
// MOCK DATA (Fallback)
// ========================

function generateMockData(): { system: BackendSystemResponse; services: BackendServicesResponse; process: BackendProcessResponse } {
  const usedMem = Math.random() * 40 + 30; // 30-70%

  return {
    system: {
      uptime: 86400 * 3 + Math.floor(Math.random() * 3600),
      uptime_formatted: '3d 14h 22m',
      loadavg: [Math.random() * 100, Math.random() * 80, Math.random() * 60],
      memory: {
        total: 16 * 1024 * 1024 * 1024,
        used: (16 * 1024 * 1024 * 1024 * usedMem) / 100,
        free: (16 * 1024 * 1024 * 1024 * (100 - usedMem)) / 100,
        usage_percent: usedMem
      },
      cpu: {
        count: 8,
        usage_percent: Math.random() * 60 + 20,
        model: 'Intel Core i7-10700K',
        speed: 3800
      },
      platform: 'win32',
      hostname: 'ITDPC-SERVER',
      arch: 'x64',
      release: '10.0.19045',
      timestamp: new Date().toISOString()
    },
    services: {
      services: [
        { name: 'Portal Backend API', port: 8002, type: 'api', status: 'online', last_check: new Date().toISOString() },
        { name: 'SQL Gateway', port: 8001, type: 'service', status: 'online', last_check: new Date().toISOString() },
        { name: 'n8n Automation', port: 5678, type: 'automation', status: 'unknown', last_check: new Date().toISOString() },
        { name: 'MSSQL Database', port: 1433, type: 'database', status: 'unknown', last_check: new Date().toISOString() },
      ],
      timestamp: new Date().toISOString()
    },
    process: {
      pid: 12345,
      memory: {
        rss: 150 * 1024 * 1024,
        heapTotal: 80 * 1024 * 1024,
        heapUsed: 45 * 1024 * 1024,
        external: 12 * 1024 * 1024
      },
      cpu: { user: 5000, system: 2000 },
      timestamp: new Date().toISOString()
    }
  };
}

// ========================
// SUB-COMPONENTS
// ========================

function StatCard({
  icon,
  label,
  value,
  unit,
  subValue,
  accent = 'cyan'
}: {
  icon: string;
  label: string;
  value: string | number;
  unit?: string;
  subValue?: string;
  accent?: 'cyan' | 'magenta' | 'green' | 'yellow';
}) {
  return (
    <div className={`monitor-card stat-card ${accent}`}>
      <div className="card-header">
        <span className="card-title">
          <span className="card-icon">{icon}</span>
          {label}
        </span>
      </div>
      <div className="stat-main">
        <span className="stat-value">{value}</span>
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {subValue && <div className="stat-sub">{subValue}</div>}
    </div>
  );
}

function ServiceItem({ service }: { service: BackendServicesResponse['services'][0] }) {
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'online': return 'ONLINE';
      case 'offline': return 'OFFLINE';
      case 'checking': return 'CHECKING';
      default: return 'UNKNOWN';
    }
  };

  const getServiceIcon = (type: string) => {
    switch (type) {
      case 'api': return '⚡';
      case 'database': return '🗄️';
      case 'automation': return '🔧';
      default: return '🔌';
    }
  };

  return (
    <div className={`service-item ${service.status}`}>
      <div className="service-info">
        <span className={`service-status-dot ${service.status}`} />
        <span className="service-icon">{getServiceIcon(service.type)}</span>
        <span className="service-name">{service.name}</span>
        <span className="service-port">:{service.port}</span>
      </div>
      <div className="service-right">
        <span className={`service-badge ${service.status}`}>{getStatusLabel(service.status)}</span>
      </div>
    </div>
  );
}

// ========================
// MAIN COMPONENT
// ========================

export function ServerMonitor() {
  const [systemInfo, setSystemInfo] = useState<BackendSystemResponse | null>(null);
  const [services, setServices] = useState<BackendServicesResponse['services']>([]);
  const [processInfo, setProcessInfo] = useState<BackendProcessResponse | null>(null);
  const [cpuHistory, setCpuHistory] = useState<ChartDataPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sysRes, svcRes, procRes] = await Promise.allSettled([
        fetch('/api/monitor/system'),
        fetch('/api/monitor/services'),
        fetch('/api/monitor/process')
      ]);

      let systemData: BackendSystemResponse | null = null;
      let serviceData: BackendServicesResponse['services'] = [];
      let processData: BackendProcessResponse | null = null;

      if (sysRes.status === 'fulfilled' && sysRes.value.ok) {
        systemData = await sysRes.value.json();
      }

      if (svcRes.status === 'fulfilled' && svcRes.value.ok) {
        const svcData: BackendServicesResponse = await svcRes.value.json();
        serviceData = svcData.services || [];
      }

      if (procRes.status === 'fulfilled' && procRes.value.ok) {
        processData = await procRes.value.json();
      }

      // Fallback to mock data if API fails
      if (!systemData || !serviceData.length || !processData) {
        const mock = generateMockData();
        systemData = systemData || mock.system;
        serviceData = serviceData.length ? serviceData : mock.services.services;
        processData = processData || mock.process;
      }

      setSystemInfo(systemData);
      setServices(serviceData);
      setProcessInfo(processData);

      // Update CPU/Memory history for chart
      const now = new Date();
      const cpu = systemData.cpu.usage_percent;
      const memory = systemData.memory.usage_percent;

      setCpuHistory(prev => {
        const newHistory = [...prev, { time: formatTime(now), cpu, memory }];
        // Keep last 30 data points
        return newHistory.slice(-30);
      });

      setLastUpdated(now);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch monitoring data:', err);
      setError('Connection failed - using simulated data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Calculate derived values
  const cpuPercent = systemInfo?.cpu.usage_percent ?? 0;
  const memPercent = systemInfo?.memory.usage_percent ?? 0;
  const memUsed = systemInfo ? formatBytes(systemInfo.memory.used) : '0 GB';
  const memTotal = systemInfo ? formatBytes(systemInfo.memory.total) : '0 GB';
  const memFree = systemInfo ? formatBytes(systemInfo.memory.free) : '0 GB';

  const onlineCount = services.filter(s => s.status === 'online').length;
  const totalServices = services.length;

  // Process memory
  const heapUsed = processInfo ? formatBytes(processInfo.memory.heapUsed) : '0 MB';
  const heapTotal = processInfo ? formatBytes(processInfo.memory.heapTotal) : '0 MB';
  const heapPercent = processInfo
    ? ((processInfo.memory.heapUsed / processInfo.memory.heapTotal) * 100).toFixed(0)
    : '0';

  return (
    <div className="server-monitor">
      {/* Scanline overlay */}
      <div className="scanline-overlay" />

      {/* Header */}
      <header className="monitor-header">
        <div className="header-left">
          <h1 className="glitch-text">
            <span className="header-icon">⚡</span>
            SYSTEM MONITOR
          </h1>
          <span className="header-hostname">{systemInfo?.hostname || 'Loading...'}</span>
        </div>
        <div className="header-right">
          <div className={`status-badge ${loading ? 'loading' : 'live'}`}>
            <span className="status-dot" />
            {loading ? 'Connecting...' : error ? 'Simulated' : 'Live'}
          </div>
        </div>
      </header>

      {/* Main Stats Grid */}
      <div className="monitor-grid stats-grid">
        {/* CPU Card */}
        <StatCard
          icon="💻"
          label="CPU Usage"
          value={cpuPercent.toFixed(1)}
          unit="%"
          subValue={`${systemInfo?.cpu.count || 0} Cores • ${systemInfo?.cpu.speed || 0} MHz`}
          accent="cyan"
        />

        {/* Memory Card */}
        <StatCard
          icon="🧠"
          label="System Memory"
          value={memPercent.toFixed(1)}
          unit="%"
          subValue={`${memUsed} / ${memTotal}`}
          accent="magenta"
        />

        {/* Uptime Card */}
        <StatCard
          icon="⏱️"
          label="Uptime"
          value={systemInfo?.uptime_formatted || formatUptime(systemInfo?.uptime || 0)}
          subValue={`Load: ${systemInfo?.loadavg.map(l => l.toFixed(1)).join(' / ') || '0 / 0 / 0'}`}
          accent="green"
        />

        {/* Process Memory Card */}
        <StatCard
          icon="🐰"
          label="Process Memory (Bun)"
          value={heapPercent}
          unit="%"
          subValue={`Heap: ${heapUsed} / ${heapTotal}`}
          accent="yellow"
        />
      </div>

      {/* Charts Row */}
      <div className="monitor-grid charts-grid">
        {/* Performance Chart */}
        <div className="monitor-card chart-card">
          <div className="card-header">
            <span className="card-title">
              <span className="card-icon">📊</span>
              Performance History
            </span>
            <span className="chart-range">Last 30 samples</span>
          </div>
          <div className="chart-wrapper" ref={chartContainerRef}>
            <CpuChart data={cpuHistory} height={220} />
          </div>
          <div className="chart-legend">
            <div className="legend-item">
              <div className="legend-color cpu" />
              <span>CPU %</span>
            </div>
            <div className="legend-item">
              <div className="legend-color memory" />
              <span>Memory %</span>
            </div>
          </div>
        </div>

        {/* Services Card */}
        <div className="monitor-card services-card">
          <div className="card-header">
            <span className="card-title">
              <span className="card-icon">🔌</span>
              Services Status
            </span>
            <span className="services-summary">
              <span className="online-count">{onlineCount}</span>
              <span className="separator">/</span>
              <span className="total-count">{totalServices}</span>
              <span className="label">online</span>
            </span>
          </div>
          <div className="services-list">
            {services.map((service, idx) => (
              <ServiceItem key={`${service.name}-${idx}`} service={service} />
            ))}
          </div>
        </div>
      </div>

      {/* System Info Row */}
      <div className="monitor-grid info-grid">
        {/* Platform Info */}
        <div className="monitor-card">
          <div className="card-header">
            <span className="card-title">
              <span className="card-icon">🖥️</span>
              Platform Info
            </span>
          </div>
          <div className="info-grid-inner">
            <div className="info-item">
              <span className="info-label">Platform</span>
              <span className="info-value">{systemInfo?.platform || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Architecture</span>
              <span className="info-value">{systemInfo?.arch || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">OS Release</span>
              <span className="info-value">{systemInfo?.release || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">CPU Model</span>
              <span className="info-value cpu-model">{systemInfo?.cpu.model || '—'}</span>
            </div>
          </div>
        </div>

        {/* Process Info */}
        <div className="monitor-card">
          <div className="card-header">
            <span className="card-title">
              <span className="card-icon">⚙️</span>
              Process Info
            </span>
          </div>
          <div className="info-grid-inner">
            <div className="info-item">
              <span className="info-label">PID</span>
              <span className="info-value">{processInfo?.pid || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">RSS Memory</span>
              <span className="info-value">{processInfo ? formatBytes(processInfo.memory.rss) : '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">External</span>
              <span className="info-value">{processInfo ? formatBytes(processInfo.memory.external) : '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Last Check</span>
              <span className="info-value">{lastUpdated.toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="monitor-footer">
        <div className="footer-left">
          <span className="refresh-indicator" />
          <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
          {error && <span className="error-hint">({error})</span>}
        </div>
        <div className="footer-right">
          Auto-refresh: 5s • Portal Server Monitor v1.0
        </div>
      </footer>
    </div>
  );
}

export default ServerMonitor;
