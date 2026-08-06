import React, { useMemo, useState } from 'react';
import { Activity, X } from 'lucide-react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

// Aggregates raw history records into time buckets for the chart
const aggregateHistory = (historyData, timeWindowHours = 24) => {
  if (!historyData || Object.keys(historyData).length === 0) return { chartData: [], stats: {} };

  const now = Date.now();
  const startTime = now - timeWindowHours * 3600 * 1000;
  
  // Decide bucket size based on time window
  // 24h -> 10 min buckets = 144 points
  // 6h -> 2.5 min buckets = 144 points
  // 1h -> 30 sec buckets = 120 points
  let bucketSizeMs = (timeWindowHours * 3600 * 1000) / 144;
  if (bucketSizeMs < 20000) bucketSizeMs = 20000; // minimum bucket 20s

  const buckets = {};
  const stats = {};
  const sources = Object.keys(historyData);

  // Initialize stats
  sources.forEach(src => {
    stats[src] = { total: 0, fail: 0, latSum: 0, latCount: 0, min: 9999, max: 0 };
  });

  sources.forEach(src => {
    const records = historyData[src] || [];
    records.forEach(rec => {
      if (rec.timestamp < startTime) return;

      // Update Stats
      stats[src].total++;
      if (!rec.success || rec.latency === null) {
        stats[src].fail++;
      } else {
        stats[src].latSum += rec.latency;
        stats[src].latCount++;
        if (rec.latency < stats[src].min) stats[src].min = rec.latency;
        if (rec.latency > stats[src].max) stats[src].max = rec.latency;
      }

      // Assign to bucket
      const bucketTime = Math.floor(rec.timestamp / bucketSizeMs) * bucketSizeMs;
      if (!buckets[bucketTime]) buckets[bucketTime] = { timestamp: bucketTime };
      
      if (!buckets[bucketTime][`${src}_sum`]) {
        buckets[bucketTime][`${src}_sum`] = 0;
        buckets[bucketTime][`${src}_count`] = 0;
      }

      if (rec.success && rec.latency !== null) {
        buckets[bucketTime][`${src}_sum`] += rec.latency;
        buckets[bucketTime][`${src}_count`]++;
      } else {
        buckets[bucketTime][`${src}_fail`] = true;
      }
    });
  });

  // Calculate final buckets
  const chartData = Object.keys(buckets).sort().map(tsStr => {
    const ts = parseInt(tsStr);
    const point = {
      timestamp: ts,
      time: new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    };
    
    sources.forEach(src => {
      const sum = buckets[ts][`${src}_sum`];
      const count = buckets[ts][`${src}_count`];
      const fail = buckets[ts][`${src}_fail`];
      
      if (count > 0) {
        point[src] = parseFloat((sum / count).toFixed(1));
      } else {
        point[src] = null;
      }
      
      // If there was a failure, add a loss spike for this specific source
      if (fail) {
        point[`${src}_loss`] = 300; // visual spike height
      }
    });
    return point;
  });

  // Calculate final stats
  Object.keys(stats).forEach(src => {
    const s = stats[src];
    s.lossRate = s.total > 0 ? ((s.fail / s.total) * 100).toFixed(1) : 0;
    s.avg = s.latCount > 0 ? (s.latSum / s.latCount).toFixed(1) : 0;
    if (s.min === 9999) s.min = 0;
  });

  return { chartData, stats, sources };
};

const COLORS = [
  'var(--accent-cyan)',
  'var(--accent-emerald)',
  'var(--accent-amber)',
  'var(--accent-rose)',
  '#a855f7' // purple
];

const GlobalLatencyPanel = ({ historyData, hideTitle, selectedSource, onClearSource }) => {
  const [timeWindow, setTimeWindow] = useState(1); // Default to 1 hour
  
  const { chartData, stats, sources } = useMemo(() => {
    return aggregateHistory(historyData, timeWindow);
  }, [historyData, timeWindow]);

  if (!sources || sources.length === 0) return null;

  const hasSelectedSource = Boolean(selectedSource && sources.includes(selectedSource));
  const tcpingSources = sources.filter(s => s.toLowerCase().includes('tcp'));
  const pingSources = sources.filter(s => !s.toLowerCase().includes('tcp'));

  const renderChart = (title, chartSources) => {
    if (chartSources.length === 0) return null;
    return (
      <div key={title} style={{ marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Activity size={16} color="var(--accent-cyan)" /> {title} &middot; 近 {timeWindow} 小时
        </h3>
        <div style={{ height: '200px', marginBottom: '1rem' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickMargin={10} minTickGap={30} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} tickFormatter={val => `${val}ms`} width={60} domain={[0, 300]} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
                labelStyle={{ color: 'var(--text-secondary)', marginBottom: '8px' }}
                itemStyle={{ padding: '2px 0' }}
              />
              
              {/* Render Lines */}
              {chartSources.map((src) => {
                const isFocused = !hasSelectedSource || selectedSource === src;
                return (
                <Line 
                  key={`line_${src}`}
                  type="monotone" 
                  dataKey={src} 
                  name={src}
                  stroke={COLORS[sources.indexOf(src) % COLORS.length]} 
                  strokeWidth={isFocused ? 3 : 1}
                  strokeOpacity={isFocused ? 1 : 0.14}
                  dot={false}
                  activeDot={isFocused ? { r: 5 } : false}
                  connectNulls={false}
                />
                );
              })}

              {/* Render Loss Spikes */}
              {chartSources.map((src) => {
                const isFocused = !hasSelectedSource || selectedSource === src;
                return (
                <Bar 
                  key={`bar_${src}`}
                  dataKey={`${src}_loss`}
                  name={`${src} 丢包`}
                  fill="var(--accent-rose)"
                  fillOpacity={isFocused ? 0.8 : 0.08}
                  barSize={2}
                />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div>来源 (Source)</div>
            <div>平均 (Avg)</div>
            <div>最差 (Max)</div>
            <div>丢包 (Loss)</div>
          </div>
          
          {chartSources.map((src) => {
            const s = stats[src];
            const isSelected = hasSelectedSource && selectedSource === src;
            return (
              <div className={`latency-stat-row ${isSelected ? 'is-selected' : hasSelectedSource ? 'is-dimmed' : ''}`} key={src} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '1rem', alignItems: 'center', padding: '0.5rem', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: COLORS[sources.indexOf(src) % COLORS.length] }}></div>
                  {src}
                </div>
                <div style={{ color: 'var(--accent-amber)' }}>{s.avg} ms</div>
                <div>{s.max} ms</div>
                <div style={{ color: s.lossRate > 5 ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
                  {s.lossRate}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="glass-card" style={{ padding: hideTitle ? '0' : '2rem', marginBottom: hideTitle ? '0' : '1.5rem', background: hideTitle ? 'transparent' : 'var(--glass-card)', border: hideTitle ? 'none' : '1px solid var(--glass-border)', boxShadow: hideTitle ? 'none' : '' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: hideTitle ? 'none' : '1px solid var(--glass-border)', paddingBottom: hideTitle ? '0' : '1rem' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: hideTitle ? '1.1rem' : '1.5rem' }}>
          <Activity size={20} color="var(--accent-cyan)" />
          TCP PING &middot; 近 {timeWindow} 小时
        </h2>
        
        <div className="latency-panel-controls">
          {hasSelectedSource && (
            <button type="button" className="latency-filter-clear" onClick={onClearSource} title="取消线路聚焦">
              <span>{selectedSource}</span>
              <X size={13} />
            </button>
          )}
          <div className="latency-range-switch">
            {[1, 6, 24].map(h => (
              <button
                key={h}
                onClick={() => setTimeWindow(h)}
                style={{
                  background: timeWindow === h ? 'var(--glass-border)' : 'transparent',
                  color: timeWindow === h ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: 'none',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                {h}时
              </button>
            ))}
          </div>
        </div>
      </div>

      {renderChart('TCP PING', tcpingSources)}
      {renderChart('ICMP PING', pingSources)}
    </div>
  );
};

export default GlobalLatencyPanel;
