export interface SystemInfo {
  uptime: number;
  loadavg: number[];
  freemem: number;
  totalmem: number;
  usedmem: number;
  cpuCount: number;
  platform: string;
  hostname: string;
  timestamp: string;
}

export interface ServiceInfo {
  name: string;
  port: number;
  status: 'online' | 'offline' | 'checking';
  responseTime?: number;
  error?: string;
}

export interface ChartDataPoint {
  time: string;
  cpu: number;
  memory: number;
}

export interface NetworkInfo {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
}
