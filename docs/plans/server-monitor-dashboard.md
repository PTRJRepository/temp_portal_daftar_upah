# Server Monitoring Dashboard - Implementation Plan

> **Goal:** Buat dashboard monitoring web server yang canggih dan modern untuk pantau server lokal (n8n + sistem terkait)

**Architecture:**
Dashboard web modern berbasis React + Vite dengan real-time monitoring, aesthetic cyberpunk/terminal-style yang premium. Menggunakan WebSocket/SSE untuk data real-time, animasi glitch effects, dan dark theme.

**Tech Stack:**
- Frontend: React + TypeScript + Vite
- UI: Custom CSS dengan glassmorphism + neon accents
- Charts: Recharts
- Backend: Node.js + Express (sama dengan portal-daftar-upah-services)
- Data Source: API endpoints dari sistem lokal

---

## Task 1: Setup Project Structure

**Objective:** Buat struktur folder untuk monitoring dashboard

**Files to Create:**
- `frontend/src/pages/ServerMonitor.tsx`
- `frontend/src/components/monitor/` (directory)

**Step 1:** Create directories
```bash
cd "D:\Server\Services\Daftar Upah Portal\portal-daftar-upah-services\frontend"
mkdir -p src/components/monitor/components
mkdir -p src/components/monitor/hooks
mkdir -p src/components/monitor/utils
```

---

## Task 2: Create Backend API Endpoints

**Objective:** Tambah endpoint monitoring di backend Express

**Files to Modify:**
- `backend/src/index.js` atau `server.js`

**Step 1:** Add monitoring endpoints
```javascript
// Add to Express server
app.get('/api/monitor/system', async (req, res) => {
  const os = require('os');
  res.json({
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    freemem: os.freemem(),
    totalmem: os.totalmem(),
    cpuCount: os.cpus().length,
    platform: os.platform(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/monitor/services', async (req, res) => {
  const services = [
    { name: 'n8n', port: 5678 },
    { name: 'Portal API', port: 3001 },
    { name: 'MySQL', port: 3306 },
  ];
  // Check each service...
  res.json(services);
});
```

---

## Task 3: Build Main Dashboard Component

**Objective:** Buat komponen ServerMonitor.tsx utama

**Files to Create:**
- `frontend/src/components/monitor/ServerMonitor.tsx`
- `frontend/src/components/monitor/ServerMonitor.css`

**Step 1:** Create ServerMonitor.tsx
```typescript
import { useState, useEffect } from 'react';
import './ServerMonitor.css';

export function ServerMonitor() {
  const [systemInfo, setSystemInfo] = useState(null);
  const [services, setServices] = useState([]);
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sysRes, svcRes] = await Promise.all([
          fetch('/api/monitor/system'),
          fetch('/api/monitor/services')
        ]);
        setSystemInfo(await sysRes.json());
        setServices(await svcRes.json());
      } catch (err) {
        console.error('Failed to fetch', err);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="server-monitor">
      <header className="monitor-header">
        <h1>⚡ SYSTEM MONITOR</h1>
        <div className="status-indicator online" />
      </header>
      
      <div className="monitor-grid">
        <div className="monitor-card cpu-card">
          <h3>CPU Usage</h3>
          <div className="stat-value">{systemInfo?.loadavg?.[0] || '0'}%</div>
        </div>
        
        <div className="monitor-card memory-card">
          <h3>Memory</h3>
          <div className="stat-value">
            {((systemInfo?.totalmem - systemInfo?.freemem) / systemInfo?.totalmem * 100).toFixed(1) || '0'}%
          </div>
        </div>
        
        <div className="monitor-card uptime-card">
          <h3>Uptime</h3>
          <div className="stat-value">{formatUptime(systemInfo?.uptime)}</div>
        </div>
        
        <div className="monitor-card services-card">
          <h3>Services</h3>
          {services.map(svc => (
            <div key={svc.name} className={`service-item ${svc.status}`}>
              <span>{svc.name}</span>
              <span>{svc.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}
```

**Step 2:** Create ServerMonitor.css
```css
.server-monitor {
  --bg-primary: #0a0a0f;
  --bg-card: rgba(20, 20, 30, 0.8);
  --accent-cyan: #00f0ff;
  --accent-magenta: #ff00ff;
  --accent-green: #00ff88;
  --accent-yellow: #ffcc00;
  
  min-height: 100vh;
  background: var(--bg-primary);
  background-image: 
    radial-gradient(ellipse at 20% 80%, rgba(0, 240, 255, 0.1) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 20%, rgba(255, 0, 255, 0.1) 0%, transparent 50%);
  padding: 2rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.monitor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
  margin-top: 2rem;
}

.monitor-card {
  background: var(--bg-card);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.monitor-card:hover {
  border-color: var(--accent-cyan);
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.2);
  transform: translateY(-2px);
}

.stat-value {
  font-size: 2.5rem;
  font-weight: bold;
  color: var(--accent-cyan);
  text-shadow: 0 0 20px rgba(0, 240, 255, 0.5);
}

.service-item {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.service-item.online .status { color: var(--accent-green); }
.service-item.offline .status { color: #ff4444; }
```

---

## Task 4: Add Recharts for CPU/Memory Charts

**Objective:** Tambah visualisasi real-time charts

**Step 1:** Install recharts
```bash
npm install recharts
```

**Files to Create:**
- `frontend/src/components/monitor/Charts.tsx`

```typescript
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

export function CpuChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <XAxis dataKey="time" stroke="#a0a0b0" />
        <YAxis domain={[0, 100]} stroke="#a0a0b0" />
        <Line type="monotone" dataKey="value" stroke="#00f0ff" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

---

## Task 5: Add Animations & Glitch Effects

**Objective:** Tingkatkan visual appeal dengan animasi

**Add to ServerMonitor.css:**
```css
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 5px var(--accent-green); }
  50% { box-shadow: 0 0 20px var(--accent-green), 0 0 40px var(--accent-green); }
}

.status-indicator.online {
  animation: pulse-glow 2s infinite;
  background: var(--accent-green);
}

@keyframes glitch {
  0% { transform: translate(0); }
  20% { transform: translate(-2px, 2px); }
  40% { transform: translate(-2px, -2px); }
  60% { transform: translate(2px, 2px); }
  80% { transform: translate(2px, -2px); }
  100% { transform: translate(0); }
}

.monitor-header h1 {
  animation: glitch 3s infinite;
  color: var(--accent-cyan);
  text-shadow: 
    0 0 10px var(--accent-cyan),
    0 0 20px var(--accent-cyan),
    0 0 40px var(--accent-cyan);
}
```

---

## Task 6: Integrate with Router

**Objective:** Tambah route /monitor

**Files to Modify:**
- `frontend/src/App.tsx`

```typescript
import ServerMonitor from './components/monitor/ServerMonitor';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/monitor" element={<ServerMonitor />} />
    </Routes>
  );
}
```

---

## Task 7: Test & Verify

**Step 1:** Start backend
```bash
cd backend && npm start
```

**Step 2:** Start frontend
```bash
cd frontend && npm run dev
```

**Step 3:** Test API
```bash
curl http://localhost:3001/api/monitor/system
```

**Step 4:** Open browser
```
http://localhost:5173/monitor
```

---

## Verification Checklist

- [ ] Backend API returns system data
- [ ] Dashboard loads without errors
- [ ] System stats display (CPU, Memory, Uptime)
- [ ] Service status cards work
- [ ] Animations render smoothly
- [ ] Dark theme applied
- [ ] Responsive on different screens
