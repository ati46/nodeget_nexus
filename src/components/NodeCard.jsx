import React from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { ArrowDown, ArrowUp, Activity, HardDrive, Clock, Cpu } from 'lucide-react';
import { formatBytes, formatSpeed } from '../dataTransformer';

const ProgressBar = ({ label, usedStr, totalStr, percent, color }) => (
  <div style={{ marginBottom: '0.8rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.85rem' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)' }}>{percent}%</span>
    </div>
    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden', marginBottom: '4px' }}>
      <div style={{ width: `${Math.min(100, percent)}%`, height: '100%', background: color, borderRadius: '3px' }}></div>
    </div>
    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{usedStr} / {totalStr}</div>
  </div>
);

const NodeCard = ({ node, stats, onClick }) => {
  if (!stats) return null;

  const isOffline = stats.status === 'offline';
  const getStatusColor = () => {
    if (stats.status === 'online') return 'var(--accent-emerald)';
    if (stats.status === 'warning') return 'var(--accent-amber)';
    return 'var(--accent-rose)';
  };

  const cpuPct = stats.cpu;
  const ramPct = (isOffline || stats.ram_total === 0) ? 0 : ((stats.ram_used / stats.ram_total) * 100).toFixed(1);
  const diskPct = (isOffline || stats.disk_total === 0) ? 0 : ((stats.disk_used / stats.disk_total) * 100).toFixed(1);
  const swapPct = (isOffline || stats.swap_total === 0) ? 0 : ((stats.swap_used / stats.swap_total) * 100).toFixed(1);

  return (
    <div className={`glass-card detailed-node-card ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: getStatusColor(), boxShadow: `0 0 8px ${getStatusColor()}` }}></span>
        <h3 style={{ margin: 0, fontSize: '1.1rem', flex: 1, letterSpacing: '0.5px' }}>{stats.name}</h3>
        <span style={{ fontSize: '1.2rem' }}>{stats.flag}</span>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stats.os}
      </div>

      {/* Resource Bars */}
      <ProgressBar 
        label="CPU" 
        percent={cpuPct} 
        usedStr={stats.cpuBrand} 
        totalStr="" 
        color={cpuPct > 80 ? 'var(--accent-rose)' : 'var(--accent-emerald)'} 
      />
      <ProgressBar 
        label="内存" 
        percent={ramPct} 
        usedStr={`${stats.ram_used} MiB`} 
        totalStr={`${stats.ram_total} MiB`} 
        color={ramPct > 85 ? 'var(--accent-rose)' : 'var(--accent-emerald)'} 
      />
      <ProgressBar 
        label="磁盘" 
        percent={diskPct} 
        usedStr={`${(stats.disk_used / 1024).toFixed(2)} GiB`} 
        totalStr={`${(stats.disk_total / 1024).toFixed(2)} GiB`} 
        color={diskPct > 90 ? 'var(--accent-rose)' : 'var(--accent-cyan)'} 
      />
      <ProgressBar 
        label="Swap" 
        percent={swapPct} 
        usedStr={`${stats.swap_used} MiB`} 
        totalStr={`${stats.swap_total} MiB`} 
        color="var(--accent-amber)" 
      />

      {/* Mini CPU Chart */}
      {!isOffline && (
        <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            <span>CPU 趋势</span>
            <span>23~53% · 当前 {stats.cpu}%</span>
          </div>
          <div style={{ height: '40px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.cpu_history}>
                <defs>
                  <linearGradient id={`cpu-${stats.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke="var(--accent-cyan)" fillOpacity={1} fill={`url(#cpu-${stats.id})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Stats Table Grid */}
      <div className="node-stats-grid">
        <div className="stat-row split">
          <span className="val"><ArrowDown size={14}/> {formatSpeed(stats.net_rx_speed)}</span>
          <span className="val"><ArrowUp size={14}/> {formatSpeed(stats.net_tx_speed)}</span>
        </div>
        <div className="stat-row split">
          <span className="lbl">⇅ 总流量</span>
          <span className="val"><ArrowDown size={12}/> {formatBytes(stats.net_rx_total)} <ArrowUp size={12}/> {formatBytes(stats.net_tx_total)}</span>
        </div>
        <div className="stat-row split">
          <span className="lbl"><Activity size={14}/> 负载</span>
          <span className="val">{stats.load}</span>
        </div>
        <div className="stat-row split">
          <span className="lbl"><HardDrive size={14}/> 读写</span>
          <span className="val">0 B/s · 0 B/s</span>
        </div>
        <div className="stat-row split">
          <span className="lbl"><Cpu size={14}/> 连接</span>
          <span className="val">{stats.processes} 进程 · {stats.connections}/2</span>
        </div>
        <div className="stat-row split">
          <span className="lbl"><Clock size={14}/> {stats.uptime}</span>
          <span className="val">{stats.last_update}</span>
        </div>
      </div>
    </div>
  );
};

export default NodeCard;
