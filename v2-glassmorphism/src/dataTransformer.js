// Holds previous network state for calculating speeds
const prevNetworkState = {};

// History arrays for charts
const cpuHistory = {};
const networkHistory = []; // Global network history

// Format bytes to KiB/s, MiB/s
export const formatSpeed = (bytesPerSec) => {
  if (bytesPerSec === 0 || isNaN(bytesPerSec)) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatBytes = (bytes) => {
  if (bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Takes raw responses from NodeGet and produces the state tree for App.jsx
export const formatUptime = (seconds) => {
  if (!seconds) return 'Unknown';
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  if (d > 0) return `${d}天 ${h}时 ${m}分`;
  if (h > 0) return `${h}时 ${m}分`;
  return `${m}分`;
};

export const formatTimeAgo = (ms) => {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  return `很久前`;
};

export const transformData = (metadataMap, staticDataArr, dynamicDataArr, config, realLatencies = {}) => {
  const agents = {};
  const latencies = { ...realLatencies };
  
  let totalSpeedRx = 0;
  let totalSpeedTx = 0;
  let totalRx = 0;
  let totalTx = 0;
  let onlineCount = 0;
  
  const now = Date.now();

  // Create lookup maps
  const staticMap = {};
  if (staticDataArr) {
    staticDataArr.forEach(s => staticMap[s.uuid] = s);
  }

  if (dynamicDataArr) {
    dynamicDataArr.forEach(dyn => {
      const uuid = dyn.uuid;
      const meta = metadataMap[uuid] || { name: null, flag: null };
      const stat = staticMap[uuid] || {};
      
      const isOnline = (now - dyn.timestamp) < 30000; // Consider offline if older than 30s
      if (isOnline) onlineCount++;

      // System Specs
      let osStr = 'Unknown OS';
      if (stat.system) {
        osStr = `${stat.system.system_name} (${stat.system.system_os_version})`;
        if (stat.system.virtualization) osStr += ` · ${stat.system.virtualization}`;
      }
      
      let cpuBrand = 'Unknown CPU';
      let physicalCores = 0;
      if (stat.cpu) {
        physicalCores = stat.cpu.physical_cores || 0;
        if (stat.cpu.per_core && stat.cpu.per_core.length > 0) {
          // Clean up the CPU brand string (remove trailing slashes or extra spaces)
          const brandRaw = stat.cpu.per_core[0].brand || '';
          const brandClean = brandRaw.replace(/[\/\s\\]+$/, '').trim();
          cpuBrand = `${physicalCores} 核 · ${brandClean}`;
        }
      }

      // CPU Usage
      let cpuPercent = 0;
      if (dyn.cpu && dyn.cpu.total_cpu_usage) {
        cpuPercent = parseFloat(dyn.cpu.total_cpu_usage.toFixed(1));
      }

      // Update CPU History
      if (!cpuHistory[uuid]) cpuHistory[uuid] = Array(20).fill(0);
      cpuHistory[uuid].push(cpuPercent);
      if (cpuHistory[uuid].length > 20) cpuHistory[uuid].shift();

      // RAM Usage
      let ramPercent = 0;
      let swapPercent = 0;
      if (dyn.ram) {
        if (dyn.ram.total_memory > 0) {
          ramPercent = parseFloat(((dyn.ram.used_memory / dyn.ram.total_memory) * 100).toFixed(1));
        }
        if (dyn.ram.total_swap > 0) {
          swapPercent = parseFloat(((dyn.ram.used_swap / dyn.ram.total_swap) * 100).toFixed(1));
        }
      }

      // Network Speed Calculation
      let speed_rx = 0;
      let speed_tx = 0;
      let rx_bytes = 0;
      let tx_bytes = 0;
      
      if (dyn.network) {
        // NodeGet schema: total_received, total_transmitted, receive_speed, transmit_speed
        if (dyn.network.interfaces && Array.isArray(dyn.network.interfaces)) {
          dyn.network.interfaces.forEach(iface => {
            // Ignore loopback interface for external traffic
            if (iface.interface_name === 'lo') return;
            rx_bytes += (iface.total_received || 0);
            tx_bytes += (iface.total_transmitted || 0);
            speed_rx += (iface.receive_speed || 0);
            speed_tx += (iface.transmit_speed || 0);
          });
        }
      }
      
      // Disk Calculation
      let disk_used = 0;
      let disk_total = 0;
      if (dyn.disk && Array.isArray(dyn.disk)) {
        dyn.disk.forEach(d => {
          // Ignore read-only mounts like /dev
          if (d.is_read_only) return;
          disk_total += (d.total_space || 0);
          const avail = (d.available_space || 0);
          disk_used += ((d.total_space || 0) - avail);
        });
      }

      totalSpeedRx += speed_rx;
      totalSpeedTx += speed_tx;
      totalRx += rx_bytes;
      totalTx += tx_bytes;

      agents[uuid] = {
        id: uuid,
        name: meta.name,
        flag: meta.flag,
        status: isOnline ? 'online' : 'offline',
        os: osStr,
        cpuBrand: cpuBrand,
        cpu: cpuPercent,
        cpu_history: [...cpuHistory[uuid]].map(v => ({ value: v })),
        ram_used: dyn.ram ? parseFloat((dyn.ram.used_memory / 1048576).toFixed(0)) : 0,
        ram_total: dyn.ram ? parseFloat((dyn.ram.total_memory / 1048576).toFixed(0)) : 0,
        swap_used: dyn.ram ? parseFloat((dyn.ram.used_swap / 1048576).toFixed(0)) : 0,
        swap_total: dyn.ram ? parseFloat((dyn.ram.total_swap / 1048576).toFixed(0)) : 0,
        disk_used: disk_used > 0 ? parseFloat((disk_used / 1048576).toFixed(0)) : 0, // convert to MiB to match usage
        disk_total: disk_total > 0 ? parseFloat((disk_total / 1048576).toFixed(0)) : 0,
        net_rx_speed: speed_rx,
        net_tx_speed: speed_tx,
        net_rx_total: rx_bytes,
        net_tx_total: tx_bytes,
        connections: dyn.network ? (dyn.network.tcp_connections || 0) : 0,
        processes: dyn.system ? (dyn.system.process_count || 0) : 0,
        uptime: dyn.system ? formatUptime(dyn.system.uptime) : 'Unknown',
        last_update: formatTimeAgo(now - dyn.timestamp),
        load: dyn.load ? dyn.load.one || dyn.load.load_1 || 0 : 0
      };
    });
  }

  // We do not have real ping data, so we don't fake latencies anymore.
  // The latencies object remains empty, and the UI will just show the connection lines without numbers.

  // Global Network History
  const globalSpeedRxMbps = parseFloat(((totalSpeedRx * 8) / 1000000).toFixed(2));
  const globalSpeedTxMbps = parseFloat(((totalSpeedTx * 8) / 1000000).toFixed(2));
  
  networkHistory.push({
    time: new Date().toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' }),
    rx: globalSpeedRxMbps,
    tx: globalSpeedTxMbps
  });
  if (networkHistory.length > 20) networkHistory.shift();

  const totalCount = dynamicDataArr ? dynamicDataArr.length : 0;
  
  return {
    agents,
    latencies,
    config,
    global: {
      health: totalCount > 0 ? Math.round((onlineCount / totalCount) * 100) : 0,
      onlineCount,
      totalCount: totalCount,
      rx_speed: totalSpeedRx,
      tx_speed: totalSpeedTx,
      rx_total: totalRx,
      tx_total: totalTx,
      history: [...networkHistory]
    }
  };
};
