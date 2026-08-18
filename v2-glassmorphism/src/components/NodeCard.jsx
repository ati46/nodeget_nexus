import React from 'react';
import { ArrowDown, ArrowUp, Cpu, HardDrive, Network, Clock, Activity, MemoryStick, Globe, Link2 } from 'lucide-react';
import { formatSpeed, formatBytes } from '../dataTransformer';

const clamp = (value) => Math.min(100, Math.max(0, Number(value) || 0));

const SegmentedBar = ({ value, max = 100, segments = 20, activeColor = '#3b82f6', inactiveColor = 'rgba(255,255,255,0.05)' }) => {
  const safeValue = clamp((value / max) * 100);
  const filled = Math.round((safeValue / 100) * segments);
  return (
    <div style={{ display: 'flex', gap: '2px', height: '6px', width: '100%' }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div 
          key={i} 
          style={{ 
            flex: 1, 
            background: i < filled ? activeColor : inactiveColor,
            borderRadius: '1px'
          }} 
        />
      ))}
    </div>
  );
};

const NodeCard = ({ stats, onClick }) => {
  if (!stats) return null;
  const ramPercent = stats.ram_total ? (stats.ram_used / stats.ram_total) * 100 : 0;
  const diskPercent = stats.disk_total ? (stats.disk_used / stats.disk_total) * 100 : 0;
  
  const getTone = (pct) => pct > 90 ? 'var(--critical)' : pct > 75 ? 'var(--warning)' : 'var(--accent-cyan)';
  
  return (
    <div 
      className="node-card glass-panel"
      onClick={onClick}
      style={{
        padding: '16px 18px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        transition: 'all 0.2s ease',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        width: '100%',
        boxSizing: 'border-box'
      }}
      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>{stats.flag || '🌐'}</span>
          <span style={{ fontWeight: 'bold', fontSize: '15px', color: 'var(--text-primary)' }}>{stats.name || stats.id.slice(0,8)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 'bold', color: stats.status === 'online' ? 'var(--healthy)' : 'var(--critical)', background: stats.status === 'online' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: '12px' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: stats.status === 'online' ? 'var(--healthy)' : 'var(--critical)' }}></div>
          {stats.status.toUpperCase()}
        </div>
      </div>

      {/* CPU & RAM */}
      <div style={{ display: 'flex', gap: '24px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Cpu size={12}/> CPU</span>
            <span style={{ fontWeight: 'bold', color: '#fff' }}>{Math.round(stats.cpu || 0)}%</span>
          </div>
          <SegmentedBar value={stats.cpu} activeColor={getTone(stats.cpu)} />
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{stats.cpuBrand || 'Unknown CPU'}</div>
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><MemoryStick size={12}/> MEM</span>
            <span style={{ fontWeight: 'bold', color: '#fff' }}>{Math.round(ramPercent)}%</span>
          </div>
          <SegmentedBar value={ramPercent} activeColor={getTone(ramPercent)} />
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatBytes(stats.ram_used * 1024 * 1024)} / {formatBytes(stats.ram_total * 1024 * 1024)}</div>
        </div>
      </div>

      {/* Disk & Load */}
      <div style={{ display: 'flex', gap: '24px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><HardDrive size={12}/> DISK</span>
            <span style={{ fontWeight: 'bold', color: '#fff' }}>{Math.round(diskPercent)}%</span>
          </div>
          <SegmentedBar value={diskPercent} activeColor={getTone(diskPercent)} />
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formatBytes(stats.disk_used * 1024 * 1024)} / {formatBytes(stats.disk_total * 1024 * 1024)}</div>
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={12}/> LOAD</span>
            <span style={{ fontWeight: 'bold', color: '#fff' }}>{stats.load || 0}</span>
          </div>
          <SegmentedBar value={stats.load * 20} max={100} activeColor="var(--accent-purple)" />
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>1 Min Avg</div>
        </div>
      </div>

      {/* Network Speed */}
      <div style={{ display: 'flex', gap: '24px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--accent-cyan)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowUp size={12}/> UP</span>
          <span style={{ fontWeight: 'bold' }}>{formatSpeed(stats.net_tx_speed)}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--healthy)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowDown size={12}/> DOWN</span>
          <span style={{ fontWeight: 'bold' }}>{formatSpeed(stats.net_rx_speed)}</span>
        </div>
      </div>

      {/* Network Traffic */}
      <div style={{ display: 'flex', gap: '24px' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Globe size={11}/> Out:</span>
          <span>{formatBytes(stats.net_tx_total)}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Globe size={11}/> In:</span>
          <span>{formatBytes(stats.net_rx_total)}</span>
        </div>
      </div>

      {/* TCP & UDP */}
      <div style={{ display: 'flex', gap: '24px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Link2 size={11}/> TCP 连接</span>
          <span style={{ color: 'var(--healthy)', fontWeight: 'bold' }}>{stats.connections || 0}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Link2 size={11}/> UDP 连接</span>
          <span style={{ color: 'var(--healthy)', fontWeight: 'bold' }}>{stats.udp || 0}</span>
        </div>
      </div>

      {/* Latency & Packet Loss */}
      <div style={{ display: 'flex', gap: '24px' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={11}/> 延迟</span>
            <span style={{ color: 'var(--healthy)', fontWeight: 'bold' }}>{stats.latency ? `${stats.latency} ms` : '- ms'}</span>
          </div>
          <SegmentedBar value={stats.latency || 10} max={200} activeColor="var(--healthy)" />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={11}/> 丢包率</span>
            <span style={{ color: 'var(--healthy)', fontWeight: 'bold' }}>{stats.packet_loss ? `${stats.packet_loss}%` : '0.0%'}</span>
          </div>
          <SegmentedBar value={stats.packet_loss || 0} max={100} activeColor="var(--healthy)" />
        </div>
      </div>

      {/* Uptime */}
      <div style={{ display: 'flex', gap: '24px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={11}/> 在线</span>
          <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>{stats.uptime}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={11}/> 到期</span>
          <span style={{ color: 'var(--healthy)', fontWeight: 'bold' }}>长期</span>
        </div>
      </div>

    </div>
  );
};

export default NodeCard;
