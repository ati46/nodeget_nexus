import React, { useEffect, useRef } from 'react';
import { Activity, ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Network, X } from 'lucide-react';
import { formatBytes, formatSpeed } from '../dataTransformer';
import GlobalLatencyPanel from './GlobalLatencyPanel';

const DetailMetric = ({ icon: Icon, label, value, detail }) => (
  <article className="detail-metric"><Icon size={17} /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
);

const NodeDetailModal = ({ agent, historyData, onClose }) => {
  const closeRef = useRef(null);
  useEffect(() => {
    // [CAUTION] Global document state mutation; always restored on close.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);
  if (!agent) return null;
  const ramPercent = agent.ram_total ? Math.round((agent.ram_used / agent.ram_total) * 100) : 0;
  const diskPercent = agent.disk_total ? Math.round((agent.disk_used / agent.disk_total) * 100) : 0;
  return (
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="node-drawer" role="dialog" aria-modal="true" aria-labelledby="node-detail-title">
        <header className="drawer-header"><div><p className="eyebrow">AGENT DETAIL</p><h2 id="node-detail-title"><i className={`node-status ${agent.status}`} />{agent.name}</h2><p>{agent.id}</p></div><button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭节点详情"><X size={20} /></button></header>
        <div className="drawer-body">
          <div className="detail-grid">
            <DetailMetric icon={Cpu} label="CPU" value={`${agent.cpu}%`} detail={agent.cpuBrand} />
            <DetailMetric icon={MemoryStick} label="内存" value={`${ramPercent}%`} detail={`${agent.ram_used} / ${agent.ram_total} MiB`} />
            <DetailMetric icon={HardDrive} label="磁盘" value={`${diskPercent}%`} detail={`${(agent.disk_used / 1024).toFixed(1)} / ${(agent.disk_total / 1024).toFixed(1)} GiB`} />
            <DetailMetric icon={Activity} label="系统负载" value={agent.load} detail={agent.uptime} />
            <DetailMetric icon={ArrowDown} label="实时入站" value={formatSpeed(agent.net_rx_speed)} detail={formatBytes(agent.net_rx_total)} />
            <DetailMetric icon={ArrowUp} label="实时出站" value={formatSpeed(agent.net_tx_speed)} detail={formatBytes(agent.net_tx_total)} />
          </div>
          <section className="drawer-section"><div className="drawer-section-title"><Network size={16} /><h3>线路拨测历史</h3></div>{historyData && Object.keys(historyData).length ? <GlobalLatencyPanel historyData={historyData} hideTitle /> : <div className="quiet-state"><Activity size={22} /><strong>暂无历史拨测</strong></div>}</section>
        </div>
      </section>
    </div>
  );
};

export default NodeDetailModal;
