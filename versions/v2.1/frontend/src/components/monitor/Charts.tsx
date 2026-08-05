/**
 * Charts Component
 * SVG-based charts for CPU/Memory monitoring with cyberpunk styling
 */

import { ChartDataPoint } from './types';

interface CpuChartProps {
  data: ChartDataPoint[];
  height?: number;
}

export function CpuChart({ data, height = 200 }: CpuChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height: `${height}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
          fontSize: '0.75rem',
          fontFamily: 'inherit',
        }}
      >
        Collecting data...
      </div>
    );
  }

  const maxValue = 100;
  const chartPadding = { top: 10, right: 5, bottom: 15, left: 5 };
  const chartHeight = height - chartPadding.top - chartPadding.bottom;
  const chartWidth = 100;

  // Generate SVG path for line
  const generatePath = (points: string[]) => points.join(' ');

  // Generate area fill path (closes the shape at the bottom)
  const generateAreaPath = (points: string[], baseline: number) => {
    if (points.length === 0) return '';
    const firstX = points[0].split(',')[0];
    const lastX = points[points.length - 1].split(',')[0];
    return `${generatePath(points)} ${lastX},${baseline} ${firstX},${baseline}`;
  };

  // Calculate points
  const xStep = chartWidth / Math.max(data.length - 1, 1);

  const cpuPoints = data.map((d, i) => {
    const x = i * xStep;
    const y = chartPadding.top + chartHeight - (Math.min(d.cpu, maxValue) / maxValue) * chartHeight;
    return `${x},${y}`;
  });

  const memPoints = data.map((d, i) => {
    const x = i * xStep;
    const y = chartPadding.top + chartHeight - (Math.min(d.memory, maxValue) / maxValue) * chartHeight;
    return `${x},${y}`;
  });

  const baseline = chartPadding.top + chartHeight;

  // Y-axis labels
  const yLabels = [100, 75, 50, 25, 0];

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${chartWidth} ${height}`}
      preserveAspectRatio="none"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* CPU gradient fill */}
        <linearGradient id="cpuGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0.02" />
        </linearGradient>

        {/* Memory gradient fill */}
        <linearGradient id="memGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--accent-magenta)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent-magenta)" stopOpacity="0.02" />
        </linearGradient>

        {/* Glow filter for lines */}
        <filter id="glowCyan" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="glowMagenta" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      {yLabels.map(y => {
        const yPos = chartPadding.top + chartHeight - (y / maxValue) * chartHeight;
        return (
          <g key={y}>
            <line
              x1="0"
              y1={yPos}
              x2={chartWidth}
              y2={yPos}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="0.3"
            />
            <text
              x="2"
              y={yPos - 1}
              fill="var(--text-dim)"
              fontSize="2.5"
              fontFamily="inherit"
            >
              {y}
            </text>
          </g>
        );
      })}

      {/* CPU Area Fill */}
      <polygon
        points={generateAreaPath(cpuPoints, baseline)}
        fill="url(#cpuGradient)"
        opacity="0.6"
      />

      {/* Memory Area Fill */}
      <polygon
        points={generateAreaPath(memPoints, baseline)}
        fill="url(#memGradient)"
        opacity="0.4"
      />

      {/* CPU Line */}
      <polyline
        points={generatePath(cpuPoints)}
        fill="none"
        stroke="var(--accent-cyan)"
        strokeWidth="0.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#glowCyan)"
      />

      {/* Memory Line */}
      <polyline
        points={generatePath(memPoints)}
        fill="none"
        stroke="var(--accent-magenta)"
        strokeWidth="0.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#glowMagenta)"
      />

      {/* Data points (only show for last few points) */}
      {data.slice(-5).map((d, i) => {
        const idx = data.length - 5 + i;
        const cpuX = idx * xStep;
        const cpuY = chartPadding.top + chartHeight - (Math.min(d.cpu, maxValue) / maxValue) * chartHeight;
        const memX = idx * xStep;
        const memY = chartPadding.top + chartHeight - (Math.min(d.memory, maxValue) / maxValue) * chartHeight;

        return (
          <g key={idx}>
            {/* CPU point */}
            <circle
              cx={cpuX}
              cy={cpuY}
              r="1.2"
              fill="var(--accent-cyan)"
              filter="url(#glowCyan)"
            />
            {/* Memory point */}
            <circle
              cx={memX}
              cy={memY}
              r="1.2"
              fill="var(--accent-magenta)"
              filter="url(#glowMagenta)"
            />
          </g>
        );
      })}

      {/* Time labels at bottom */}
      {data.length > 0 && (
        <g>
          <text
            x="2"
            y={height - 2}
            fill="var(--text-dim)"
            fontSize="2"
            fontFamily="inherit"
          >
            {data[0].time}
          </text>
          <text
            x={chartWidth - 2}
            y={height - 2}
            fill="var(--text-dim)"
            fontSize="2"
            fontFamily="inherit"
            textAnchor="end"
          >
            {data[data.length - 1].time}
          </text>
        </g>
      )}
    </svg>
  );
}

interface MemoryChartProps {
  used: number;
  total: number;
}

export function MemoryChart({ used, total }: MemoryChartProps) {
  const usedPercent = (used / total) * 100;
  const height = 60;
  const width = 100;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="memBarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--accent-magenta)" />
          <stop offset="100%" stopColor="rgba(255,0,255,0.3)" />
        </linearGradient>
      </defs>

      {/* Background track */}
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill="rgba(255,255,255,0.03)"
        rx="4"
      />

      {/* Used memory bar */}
      <rect
        x="0"
        y="0"
        width={usedPercent}
        height={height}
        fill="url(#memBarGradient)"
        rx="4"
      />

      {/* Percentage label */}
      <text
        x={width / 2}
        y={height / 2 + 1}
        fill="var(--text-primary)"
        fontSize="6"
        fontFamily="inherit"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {usedPercent.toFixed(1)}%
      </text>
    </svg>
  );
}

export default CpuChart;
