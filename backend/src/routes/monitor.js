const express = require('express');
const os = require('os');
const { exec } = require('child_process');
const dns = require('dns');

const router = express.Router();

// Check if a port is in use
function checkPort(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    const result = { port, status: 'offline', responseTime: null };
    
    const startTime = Date.now();
    
    socket.setTimeout(2000);
    
    socket.on('connect', () => {
      result.status = 'online';
      result.responseTime = Date.now() - startTime;
      socket.destroy();
      resolve(result);
    });
    
    socket.on('timeout', () => {
      result.error = 'timeout';
      socket.destroy();
      resolve(result);
    });
    
    socket.on('error', (err) => {
      result.error = err.code;
      resolve(result);
    });
    
    socket.connect(port, '127.0.0.1');
  });
}

// Get system information
router.get('/system', async (req, res) => {
  try {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const cpuUsage = ((1 - totalIdle / totalTick) * 100).toFixed(2);
    
    const info = {
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      freemem: os.freemem(),
      totalmem: os.totalmem(),
      usedmem: os.totalmem() - os.freemem(),
      cpuCount: cpus.length,
      cpuUsage: parseFloat(cpuUsage),
      platform: os.platform(),
      hostname: os.hostname(),
      type: os.type(),
      release: os.release(),
      arch: os.arch(),
      timestamp: new Date().toISOString()
    };
    
    res.json(info);
  } catch (error) {
    console.error('Error getting system info:', error);
    res.status(500).json({ error: 'Failed to get system information' });
  }
});

// Get services status
router.get('/services', async (req, res) => {
  try {
    const services = [
      { name: 'n8n', port: 5678 },
      { name: 'Portal API', port: 3001 },
      { name: 'MySQL', port: 3306 },
      { name: 'Redis', port: 6379 },
      { name: 'nginx', port: 80 },
    ];
    
    const results = await Promise.all(
      services.map(async (service) => {
        const result = await checkPort(service.port);
        return {
          name: service.name,
          port: service.port,
          status: result.status,
          responseTime: result.responseTime,
          error: result.error
        };
      })
    );
    
    res.json(results);
  } catch (error) {
    console.error('Error checking services:', error);
    res.status(500).json({ error: 'Failed to check services' });
  }
});

// Get network statistics (simplified for Windows)
router.get('/network', async (req, res) => {
  try {
    const networkInterfaces = os.networkInterfaces();
    const stats = {
      interfaces: [],
      total: { bytesIn: 0, bytesOut: 0 }
    };
    
    for (const [name, addrs] of Object.entries(networkInterfaces)) {
      if (addrs) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            stats.interfaces.push({
              name,
              address: addr.address,
              mac: addr.mac
            });
          }
        }
      }
    }
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting network info:', error);
    res.status(500).json({ error: 'Failed to get network information' });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: os.uptime()
  });
});

module.exports = router;
