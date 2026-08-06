import React, { useState, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

// Recharts Custom Tooltip
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: 'rgba(0,0,0,0.8)', border: '1px solid var(--glass-border)', padding: '10px', borderRadius: '8px' }}>
        <p style={{ margin: '0 0 5px', color: '#fff', fontSize: '12px' }}>{label}</p>
        {payload.map(p => {
          if (typeof p.dataKey === 'function') return null;
          if (typeof p.dataKey === 'string' && p.dataKey.startsWith('loss')) return null; // Don't show the loss bars in tooltip directly
          return (
            <p key={p.dataKey} style={{ color: p.color, margin: '2px 0', fontSize: '12px' }}>
              {p.name}: {p.value === 999 ? 'Timeout' : `${p.value} ms`}
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

const LatencyChart = ({ history }) => {
  const [timeRange, setTimeRange] = useState(24); // 0.5, 1, 6, 24

  const filteredData = useMemo(() => {
    if (!history) return [];
    // Calculate how many points to take based on 5-min intervals
    const pointsNeeded = timeRange * 12; // 12 points per hour
    return history.slice(-pointsNeeded);
  }, [history, timeRange]);

  const ranges = [
    { label: '30分', value: 0.5 },
    { label: '1时', value: 1 },
    { label: '6时', value: 6 },
    { label: '24时', value: 24 }
  ];

  return (
    <div style={{ width: '100%', marginTop: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>TCP PING · 近 {timeRange} 小时</div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {ranges.map(r => (
            <button
              key={r.value}
              onClick={() => setTimeRange(r.value)}
              className={`range-btn ${timeRange === r.value ? 'active' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      
      <div style={{ height: 300, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={filteredData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="timeStr" 
              stroke="var(--text-muted)" 
              tick={{ fontSize: 11 }} 
              tickMargin={10}
              minTickGap={30}
            />
            <YAxis 
              stroke="var(--text-muted)" 
              tick={{ fontSize: 11 }}
              domain={[0, 'dataMax + 50']}
              tickFormatter={(v) => `${v}ms`}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Red lines for packet loss (simulated by bar chart mapping 1 to a high height) */}
            <Bar dataKey={(d) => d.loss_CU ? 1000 : 0} fill="var(--accent-rose)" barSize={1} isAnimationActive={false}/>
            <Bar dataKey={(d) => d.loss_CT ? 1000 : 0} fill="var(--accent-rose)" barSize={1} isAnimationActive={false}/>
            <Bar dataKey={(d) => d.loss_CM ? 1000 : 0} fill="var(--accent-rose)" barSize={1} isAnimationActive={false}/>

            {/* Latency Lines */}
            <Line type="monotone" name="联通" dataKey="CU" stroke="#a855f7" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" name="移动" dataKey="CM" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" name="电信" dataKey="CT" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LatencyChart;
