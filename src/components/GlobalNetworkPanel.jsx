import React from 'react';
import { Activity, Globe, ArrowDown, ArrowUp, Zap } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { formatBytes, formatSpeed } from '../dataTransformer';

const GlobalNetworkPanel = ({ global }) => {
  if (!global) return null;

  return (
    <div style={{ marginBottom: '2rem' }}>
      {/* Status Bar */}
      <div className="glass-card" style={{ padding: '0.8rem 1.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '2rem', borderTop: '3px solid var(--accent-emerald)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-emerald)', fontWeight: 'bold' }}>
          <Zap size={18} />
          {global.health}% 健康度
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
          <Activity size={18} color="var(--accent-emerald)"/> {global.onlineCount} / <Activity size={18} color="var(--accent-rose)"/> {global.totalCount - global.onlineCount}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
          <span style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center' }}><ArrowDown size={14}/> {formatSpeed(global.rx_speed)}</span>
          <span style={{ color: 'var(--accent-amber)', display: 'flex', alignItems: 'center' }}><ArrowUp size={14}/> {formatSpeed(global.tx_speed)}</span>
          <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>⇅ {formatSpeed(global.rx_speed + global.tx_speed)}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-emerald)', fontSize: '0.8rem' }}>
          <span className="pulse-dot"></span> LIVE
        </div>
      </div>

      {/* Network Stats & Chart */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem' }}>
        
        {/* Left: Throughput Stats */}
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            <Globe size={16} /> 网络吞吐量
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>实时入站</div>
              <div style={{ color: 'var(--accent-cyan)', fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                <ArrowDown size={16} style={{marginRight: '4px'}}/> {formatSpeed(global.rx_speed)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>实时出站</div>
              <div style={{ color: 'var(--accent-amber)', fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                <ArrowUp size={16} style={{marginRight: '4px'}}/> {formatSpeed(global.tx_speed)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>累计入站</div>
              <div style={{ color: '#a855f7', fontSize: '1.1rem', fontWeight: 'bold' }}>
                {formatBytes(global.rx_total)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>累计出站</div>
              <div style={{ color: 'var(--accent-emerald)', fontSize: '1.1rem', fontWeight: 'bold' }}>
                {formatBytes(global.tx_total)}
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>总累计流量</span>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>{formatBytes(global.rx_total + global.tx_total)}</span>
          </div>
        </div>

        {/* Right: Area Chart */}
        <div className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
            <Activity size={16} /> 实时带宽
          </div>
          
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '1rem', fontWeight: 'bold' }}>
            <span style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center' }}><ArrowDown size={14} style={{marginRight:'4px'}}/> {formatSpeed(global.rx_speed)}</span>
            <span style={{ color: 'var(--accent-amber)', display: 'flex', alignItems: 'center' }}><ArrowUp size={14} style={{marginRight:'4px'}}/> {formatSpeed(global.tx_speed)}</span>
          </div>

          <div style={{ flex: 1, minHeight: '120px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={global.history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-amber)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--accent-amber)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="rx" stroke="var(--accent-cyan)" fillOpacity={1} fill="url(#colorRx)" isAnimationActive={false} />
                <Area type="monotone" dataKey="tx" stroke="var(--accent-amber)" fillOpacity={1} fill="url(#colorTx)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap:'4px'}}><span style={{width:6,height:6,borderRadius:'50%',background:'var(--accent-cyan)'}}></span> 入站</span>
              <span style={{ display: 'flex', alignItems: 'center', gap:'4px'}}><span style={{width:6,height:6,borderRadius:'50%',background:'var(--accent-amber)'}}></span> 出站</span>
            </div>
            <span>20 采样点</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default GlobalNetworkPanel;
