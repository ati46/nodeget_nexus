import React from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Cpu, MemoryStick } from 'lucide-react';
import { formatSpeed } from '../dataTransformer';

const clamp = (value) => Math.min(100, Math.max(0, Number(value) || 0));
const MiniMeter = ({ icon: Icon, label, value, tone }) => (
  <span className="asset-meter"><Icon size={13} /><span>{label}</span><b>{Math.round(clamp(value))}%</b><i><em className={tone} style={{ width: `${clamp(value)}%` }} /></i></span>
);

const NodeCard = ({ stats, onClick }) => {
  if (!stats) return null;
  const ramPercent = stats.ram_total ? (stats.ram_used / stats.ram_total) * 100 : 0;
  const cpuTone = stats.cpu > 85 ? 'critical' : stats.cpu > 70 ? 'warning' : 'healthy';
  const ramTone = ramPercent > 90 ? 'critical' : ramPercent > 75 ? 'warning' : 'healthy';
  return (
    <button type="button" className={`asset-row ${stats.status}`} onClick={onClick}>
      <span className="asset-identity"><i className={`node-status ${stats.status}`} aria-hidden="true" /><span className="region-code">{stats.flag || 'GL'}</span><span><strong>{stats.name}</strong><small>{stats.os}</small></span></span>
      <span className="asset-health"><MiniMeter icon={Cpu} label="CPU" value={stats.cpu} tone={cpuTone} /><MiniMeter icon={MemoryStick} label="RAM" value={ramPercent} tone={ramTone} /></span>
      <span className="asset-throughput"><span><ArrowDown size={13} />{formatSpeed(stats.net_rx_speed)}</span><span><ArrowUp size={13} />{formatSpeed(stats.net_tx_speed)}</span></span>
      <span className="asset-freshness"><strong>{stats.status === 'offline' ? '离线' : stats.uptime}</strong><small>{stats.last_update}</small></span>
      <ChevronRight className="asset-chevron" size={17} />
    </button>
  );
};

export default NodeCard;
