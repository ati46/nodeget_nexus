import React from 'react';
import { Server, Globe } from 'lucide-react';

const TopologyNode = ({ nodeId, stats, onClick }) => {
  // Virtual nodes
  if (nodeId === 'client' || nodeId === 'internet') {
    return (
      <div className="glass-card topology-node client-target">
        <Globe size={32} color={nodeId === 'internet' ? 'var(--accent-cyan)' : 'var(--text-secondary)'} />
        <div className="node-name">{nodeId === 'internet' ? 'Global Internet' : 'Client (Local)'}</div>
      </div>
    );
  }

  // Placeholder for unreachable / misconfigured nodes
  if (!stats) {
    return (
      <div className="glass-card topology-node clickable" style={{borderColor: 'var(--accent-rose)', opacity: 0.5}}>
        <div className="node-header">
          <Server size={24} color="var(--accent-rose)" />
        </div>
        <div className="node-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span className="status-dot offline" style={{ width: '8px', height: '8px' }}></span>
          Unreachable
        </div>
      </div>
    );
  }

  // Active nodes
  return (
    <div className="glass-card topology-node clickable" onClick={onClick}>
      <div className="node-header">
        <Server size={24} color={stats.status === 'offline' ? 'var(--accent-rose)' : 'var(--accent-emerald)'} />
      </div>
      <div className="node-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span className={`status-dot ${stats.status}`} style={{ width: '8px', height: '8px' }}></span>
        {stats.name}
      </div>
    </div>
  );
};

export default TopologyNode;
