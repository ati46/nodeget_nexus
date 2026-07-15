import React, { useEffect, useState } from 'react';
import { X, Activity } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fetchNodeTaskHistory } from '../apiClient';
import GlobalLatencyPanel from './GlobalLatencyPanel';

const NodeDetailModal = ({ agent, onClose }) => {
  const [historyData, setHistoryData] = useState(null);

  useEffect(() => {
    if (!agent) return;
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
    
    const loadHistory = async () => {
      const data = await fetchNodeTaskHistory(agent.id);
      setHistoryData(data);
    };
    loadHistory();
    
    return () => {
      document.body.style.overflow = '';
    };
  }, [agent]);

  if (!agent) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(10px)' }}>
      <div className="glass-card modal-content custom-scrollbar" onClick={e => e.stopPropagation()} style={{ width: '1000px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', overflowX: 'hidden', backgroundColor: 'var(--bg-card)', backdropFilter: 'blur(30px)', border: '1px solid var(--glass-border)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem', position: 'sticky', top: 0, backgroundColor: 'var(--bg-card)', zIndex: 10 }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity color="var(--accent-cyan)"/> {agent.name}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <p><strong>UUID:</strong> {agent.id.substring(0,8)}...</p>
            <p><strong>系统:</strong> {agent.os}</p>
            <p><strong>CPU:</strong> {agent.cpuBrand}</p>
            <p><strong>运行时长:</strong> {agent.uptime}</p>
            <p><strong>入站总计:</strong> {(agent.net_rx_total / 1024 / 1024 / 1024).toFixed(2)} GiB</p>
            <p><strong>出站总计:</strong> {(agent.net_tx_total / 1024 / 1024 / 1024).toFixed(2)} GiB</p>
          </div>
          
          <div style={{ marginTop: '2rem', minHeight: '200px' }}>
            {historyData ? (
              Object.keys(historyData).length > 0 ? (
                <div style={{ margin: '-2rem' }}>
                  <GlobalLatencyPanel historyData={historyData} hideTitle={true} />
                </div>
              ) : (
                <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  无拨测数据 (No Ping Data)
                </div>
              )
            ) : (
              <div style={{ height: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
                <div className="spin"><Activity size={32} color="var(--accent-cyan)" /></div>
                <div>加载中... (Loading)</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NodeDetailModal;
