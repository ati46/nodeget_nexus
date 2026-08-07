import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, LayoutDashboard, Server, Settings, Search, Bell, Monitor, BarChart3, ChevronRight, Cpu, ArrowDown, ArrowUp, HardDrive, Network, Clock3, X } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer, AreaChart, Area } from 'recharts';
import SegmentTopology from './components/SegmentTopology';
import NodeCard from './components/NodeCard';
import NodeDetailModal from './components/NodeDetailModal';
import { fetch24hTaskHistory, fetchAgentMetadata, fetchAllAgentUuids, fetchDynamicData, fetchFrontendConfig, fetchStaticData, fetchTaskLatencies, initApi } from './apiClient';
import { transformData, formatBytes } from './dataTransformer';
import { buildDemoDashboard } from './demoData';
import './index.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIRTUAL_NODE_LABELS = { client: 'Client', internet: 'Internet' };
const getNodeName = (nodeId, data, config) => (
  data?.agents?.[nodeId]?.name ||
  config?.node_metadata?.[nodeId]?.name ||
  VIRTUAL_NODE_LABELS[nodeId] ||
  nodeId.slice(0, 8)
);

const buildTasks = (config) => {
  const tasks = {};
  const edges = Array.isArray(config?.edges) ? config.edges : [];
  edges.forEach((edge) => {
    if (edge && edge.from && edge.to && edge.latencyTask) {
      tasks[`${edge.from}->${edge.to}`] = edge.latencyTask;
    }
  });
  return { ...tasks, ...(config?.latency_tasks || {}) };
};

const routeState = (latency) => !latency ? 'unknown' : latency.ping === 'fail' || latency.loss > 20 ? 'critical' : latency.ping > 150 || latency.loss > 5 ? 'warning' : 'healthy';

const SegmentedBar = ({ value, max = 100, segments = 15, color = '#3b82f6', style = {}, inactiveColor = 'rgba(255,255,255,0.1)' }) => {
  const safeValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, max));
  const filled = Math.round((safeValue / max) * segments);
  return (
    <div style={{ display: 'flex', gap: '3px', height: '4px', ...style }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div 
          key={i} 
          style={{ 
            flex: 1, 
            background: i < filled ? color : inactiveColor,
            borderRadius: '1px'
          }} 
        />
      ))}
    </div>
  );
};

const DotBar = ({ value, max = 100, segments = 15, color = '#3b82f6', style = {} }) => {
  const safeValue = isNaN(value) ? 0 : Math.max(0, Math.min(value, max));
  const filled = Math.round((safeValue / max) * segments);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '4px', ...style }}>
      {Array.from({ length: segments }).map((_, i) => (
        <div 
          key={i} 
          style={{ 
            width: i === filled - 1 ? '6px' : '4px', 
            height: i === filled - 1 ? '6px' : '4px', 
            background: i < filled ? color : 'rgba(255,255,255,0.1)',
            borderRadius: '50%'
          }} 
        />
      ))}
    </div>
  );
};

const formatGbMb = (mb) => {
  if (!mb || isNaN(mb)) return '0 MB';
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
  return Math.round(mb) + ' MB';
};

const setCookie = (name, value, days = 365) => {
  const d = new Date();
  d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`;
};

const getCookie = (name) => {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
};

const App = () => {
  const [config, setConfig] = useState(null);
  const [data, setData] = useState(null);
  const [history24h, setHistory24h] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [demoMode, setDemoMode] = useState(() => new URLSearchParams(window.location.search).get('demo') === '1');
  const [selectedNode, setSelectedNode] = useState(null);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [glassLevel, setGlassLevel] = useState(() => {
    const val = parseInt(getCookie('glassLevel'), 10);
    return isNaN(val) ? 80 : val;
  });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [hoveredAlertEdge, setHoveredAlertEdge] = useState(null);
  const snapshotRef = React.useRef(null);
  const latencyRef = React.useRef({});

  useEffect(() => {
    setCookie('glassLevel', glassLevel);
    const root = document.documentElement;
    root.style.setProperty('--glass-opacity-app', (glassLevel * 0.003).toFixed(3));
    root.style.setProperty('--glass-blur-app', `${(glassLevel * 0.2).toFixed(1)}px`);
    root.style.setProperty('--glass-opacity-panel', (glassLevel * 0.0005).toFixed(4));
    root.style.setProperty('--glass-blur-panel', `${(glassLevel * 0.1).toFixed(1)}px`);
    root.style.setProperty('--glass-opacity-drawer', (glassLevel * 0.002).toFixed(3));
    root.style.setProperty('--glass-blur-drawer', `${(glassLevel * 0.15).toFixed(1)}px`);
  }, [glassLevel]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const response = await fetch('config.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`配置加载失败（HTTP ${response.status}）`);
        const raw = await response.json();
        const site = raw.site_tokens?.[0];
        const apiUrl = site?.backend_url || raw.api_url;
        const apiToken = site?.token || raw.api_token;

        if (demoMode) {
          const demoConfig = { ...raw, edges: raw.edges || [], latency_tasks: buildTasks(raw) };
          const demo = buildDemoDashboard(demoConfig);
          if (cancelled) return;
          setConfig(demoConfig); setData(demo.data); setHistory24h(demo.history24h);
          setLoading(false);
          return;
        }

        initApi(apiUrl || '/', apiToken || '');
        let active = { ...raw, edges: Array.isArray(raw.edges) ? raw.edges : [] };
        const kvConfig = await fetchFrontendConfig();
        if (kvConfig && typeof kvConfig === 'object') {
          active = {
            ...active,
            ...kvConfig,
            topology: kvConfig.topology || active.topology,
            edges: Array.isArray(kvConfig.edges) ? kvConfig.edges : active.edges,
            latency_tasks: { ...(active.latency_tasks || {}), ...(kvConfig.latency_tasks || {}) }
          };
        }

        active.latency_tasks = buildTasks(active);
        const edges = Array.isArray(active.edges) ? active.edges : [];
        const ids = new Set(edges.flatMap((edge) => [edge?.from, edge?.to]).filter((id) => id && UUID_RE.test(id)));

        // Dynamic Agent Discovery
        const allUuids = await fetchAllAgentUuids();
        if (Array.isArray(allUuids)) {
          allUuids.forEach((id) => ids.add(id));
        }

        const uuidList = Array.from(ids);
        const [metadata, staticData, dynamicData] = await Promise.all([
          fetchAgentMetadata(uuidList),
          fetchStaticData(uuidList),
          fetchDynamicData(uuidList),
        ]);

        if (cancelled) return;
        snapshotRef.current = { metadata, staticData, uuidList };
        latencyRef.current = {};
        setConfig(active);
        setData(transformData(metadata, staticData, dynamicData, active, {}));
        setLoading(false);

        // Fetch latencies and history asynchronously without blocking the initial render
        fetchTaskLatencies(active.latency_tasks).then(latencies => {
          if (!cancelled) {
            latencyRef.current = latencies;
            setData(current => current ? { ...current, latencies } : current);
          }
        }).catch(err => console.warn('Init latency fetch failed:', err));

        fetch24hTaskHistory(active.latency_tasks).then(history => {
          if (!cancelled) {
            setHistory24h(history);
          }
        }).catch(err => console.warn('Init history fetch failed:', err));
      } catch (err) {
        if (!cancelled) {
          console.error('Init Error:', err);
          setError(err.message);
          setLoading(false);
        }
      }
    };
    initialize();
    return () => { cancelled = true; };
  }, [demoMode]);

  useEffect(() => {
    if (demoMode || !config || !snapshotRef.current) return undefined;
    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const dynamicData = await fetchDynamicData(snapshotRef.current.uuidList);
        if (!cancelled) {
          setData(transformData(snapshotRef.current.metadata, snapshotRef.current.staticData, dynamicData, config, latencyRef.current));
        }
      } catch (cause) {
        console.warn('Dynamic refresh failed:', cause);
      } finally { running = false; }
    };
    const timer = window.setInterval(refresh, 6000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [config, demoMode]);

  useEffect(() => {
    if (demoMode || !config) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const latencies = await fetchTaskLatencies(config.latency_tasks);
        if (!cancelled) {
          latencyRef.current = latencies;
          setData((current) => current ? { ...current, latencies } : current);
        }
      } catch (cause) { console.warn('Latency refresh failed:', cause); }
    };
    const timer = window.setInterval(refresh, 20000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [config, demoMode]);

  const nodes = useMemo(() => {
    if (!data) return [];
    return Object.values(data.agents).sort((a, b) => {
      if (a.status !== b.status) return a.status === 'online' ? -1 : 1;
      const nameA = getNodeName(a.id, data, config) || a.id;
      const nameB = getNodeName(b.id, data, config) || b.id;
      return nameA.localeCompare(nameB);
    });
  }, [data, config]);
  
  const { maxCpu, maxCpuNode, maxRam, maxRamNode, totalRx, totalTx, totalRxVolume, totalTxVolume } = useMemo(() => {
    if (!nodes.length) return { maxCpu: 0, maxCpuNode: '-', maxRam: 0, maxRamNode: '-', totalRx: 0, totalTx: 0, totalRxVolume: 0, totalTxVolume: 0 };
    let cpuMax = 0, ramMax = 0, rx = 0, tx = 0, rxVol = 0, txVol = 0, count = 0;
    let cpuNodeName = '-', ramNodeName = '-';
    nodes.forEach(n => {
      if (n.status === 'online') {
        if (n.cpu >= cpuMax) { cpuMax = n.cpu; cpuNodeName = n.id; }
        if (n.ram_total) {
          const rPct = (n.ram_used / n.ram_total) * 100;
          if (rPct >= ramMax) { ramMax = rPct; ramNodeName = n.id; }
        }
        rx += n.net_rx_speed || 0;
        tx += n.net_tx_speed || 0;
        rxVol += n.net_rx_total || 0;
        txVol += n.net_tx_total || 0;
        count++;
      }
    });
    return {
      maxCpu: count ? Math.round(cpuMax) : 0,
      maxCpuNode: cpuNodeName,
      maxRam: count ? Math.round(ramMax) : 0,
      maxRamNode: ramNodeName,
      totalRx: formatBytes(rx) + '/s',
      totalTx: formatBytes(tx) + '/s',
      totalRxVolume: formatBytes(rxVol),
      totalTxVolume: formatBytes(txVol)
    };
  }, [nodes]);

  const routes = useMemo(() => {
    if (!data || !config) return { incidents: [] };
    const incidents = [];
    (config.edges || []).forEach(edge => {
      if (!edge.from || !edge.to) return;
      const latency = data.latencies?.[`${edge.from}->${edge.to}`];
      const state = routeState(latency);
      if (state === 'critical' || state === 'warning') {
        incidents.push({ key: `${edge.from}->${edge.to}`, from: edge.from, to: edge.to, latency, state, task: edge.latencyTask });
      }
    });
    return { incidents: incidents.sort((a, b) => a.state === 'critical' ? -1 : 1) };
  }, [data, config]);

  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#fff' }}>Loading Nexus...</div>;
  if (error) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'red' }}>Error: {error}</div>;

  return (
    <div className="app-layout">
      <nav className="glass-panel thin-nav" style={{ width: '64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', padding: '24px 0', borderRadius: '16px' }}>
        <div className="brand-icon-small" style={{ width: 32, height: 32, borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-cyan))', display: 'grid', placeItems: 'center', marginBottom: '16px' }}>
          <Monitor size={16} color="#fff" />
        </div>
        
        {[
          { name: 'Dashboard', icon: LayoutDashboard },
          { name: 'Servers', icon: Server },
          { name: 'Routing', icon: Activity },
          { name: 'Settings', icon: Settings }
        ].map(tab => (
          <button
            key={tab.name}
            onClick={() => setActiveTab(tab.name)}
            title={tab.name}
            style={{ 
              background: activeTab === tab.name ? 'rgba(255,255,255,0.1)' : 'transparent', 
              border: 'none', width: 40, height: 40, borderRadius: '12px', 
              display: 'grid', placeItems: 'center', cursor: 'pointer', 
              color: activeTab === tab.name ? 'var(--accent-cyan)' : 'var(--text-secondary)' 
            }}
          >
            <tab.icon size={20} />
          </button>
        ))}
      </nav>

      {/* STATS SIDEBAR (Only on Dashboard) */}
      {activeTab === 'Dashboard' && (
        <aside className="stats-sidebar" style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', paddingRight: '8px' }}>
          <header style={{ padding: '8px 0' }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
              以太监控
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>/ 网络视界</div>
          </header>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
            系统总览 <span>...</span>
          </div>
          
          <div style={{ fontSize: '13px', color: hoveredNodeId ? '#fff' : 'var(--accent-cyan)', marginBottom: '20px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={14} /> {hoveredNodeId ? getNodeName(hoveredNodeId, data, config) : (maxCpuNode !== '-' ? `最高负载: ${getNodeName(maxCpuNode, data, config)}` : '全局最高负载')}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {(() => {
               const targetData = hoveredNodeId ? data.agents?.[hoveredNodeId] : null;
               const displayCpu = targetData ? (targetData.cpu || 0).toFixed(1) : maxCpu;
               const displayRam = targetData ? (targetData.ram_total ? (targetData.ram_used / targetData.ram_total * 100) : 0).toFixed(1) : maxRam;
               const displayRx = targetData ? formatBytes(targetData.net_rx_speed || 0) + '/s' : totalRx;
               const displayTx = targetData ? formatBytes(targetData.net_tx_speed || 0) + '/s' : totalTx;
               const displayRxVol = targetData ? formatBytes(targetData.net_rx_total || 0) : totalRxVolume;
               const displayTxVol = targetData ? formatBytes(targetData.net_tx_total || 0) : totalTxVolume;
               
               return (
                 <>
                   <div>
                     <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                       <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}><Activity size={14}/> CPU</span>
                       <span style={{ fontWeight: 'bold' }}>{displayCpu}%</span>
                     </div>
                     <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                       <div style={{ width: `${displayCpu}%`, height: '100%', background: displayCpu > 80 ? 'var(--critical)' : 'var(--accent-purple)', transition: 'width 0.3s ease, background 0.3s ease' }} />
                     </div>
                   </div>

                   <div>
                     <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                       <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}><Monitor size={14}/> MEM</span>
                       <span style={{ fontWeight: 'bold' }}>{displayRam}%</span>
                     </div>
                     <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                       <div style={{ width: `${displayRam}%`, height: '100%', background: displayRam > 90 ? 'var(--critical)' : 'var(--accent-cyan)', transition: 'width 0.3s ease, background 0.3s ease' }} />
                     </div>
                   </div>
                   
                   <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginTop: '4px' }}>
                     <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                       <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}><ArrowDown size={12} color="var(--accent-cyan)" /> 入站</div>
                       <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{displayRx}</div>
                       <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>总量: {displayRxVol}</div>
                     </div>
                     <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                       <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}><ArrowUp size={12} color="var(--accent-purple)" /> 出站</div>
                       <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{displayTx}</div>
                       <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>总量: {displayTxVol}</div>
                     </div>
                   </div>
                 </>
               );
            })()}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '300px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.1em' }}>
            服务器节点 ({nodes.filter(n => n.status === 'online').length} 在线)
          </div>
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
            {nodes.map(node => (
              <div 
                key={node.id}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onClick={() => setSelectedNode(node)}
                style={{ 
                  padding: '10px 12px', 
                  background: hoveredNodeId === node.id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)', 
                  borderRadius: '8px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '10px', 
                  fontSize: '13px', 
                  border: '1px solid',
                  borderColor: hoveredNodeId === node.id ? 'var(--border-light)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: node.status === 'online' ? 'var(--healthy)' : 'var(--critical)', boxShadow: node.status === 'online' ? '0 0 8px var(--healthy)' : 'none' }}></div>
                <div style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: hoveredNodeId === node.id ? '#fff' : 'var(--text-secondary)' }}>
                  {getNodeName(node.id, data, config)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
      )}

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', gridColumn: activeTab === 'Dashboard' ? '3' : '2 / -1', paddingRight: '8px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
          <div style={{ display: 'flex', gap: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'rgba(255,255,255,0.03)', padding: '6px 16px', borderRadius: '20px', border: '1px solid var(--border)' }}>
               <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>速率↓</span>
               <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>{totalRx}</span>
               <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>速率↑</span>
               <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>{totalTx}</span>
               <div style={{ width: '1px', height: '12px', background: 'var(--border)' }}></div>
               <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>总量↓</span>
               <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>{totalRxVolume}</span>
               <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>总量↑</span>
               <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>{totalTxVolume}</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'rgba(255,255,255,0.03)', padding: '6px 16px', borderRadius: '20px', border: '1px solid var(--border)' }}>
               <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--healthy)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--healthy)' }}></span> {nodes.filter(n => n.status === 'online').length} 在线</span>
               <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--warning)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)' }}></span> {routes.incidents.filter(i => i.state === 'warning').length} 警告</span>
               <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--critical)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--critical)' }}></span> {nodes.filter(n => n.status === 'offline').length} 离线</span>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>透明度</span>
              <input 
                type="range" min="0" max="100" value={glassLevel}
                onChange={(e) => setGlassLevel(Number(e.target.value))}
                style={{ width: '80px', accentColor: 'var(--accent-cyan)' }}
              />
            </div>
            
            <Activity size={20} color="var(--text-secondary)" />
            <div style={{ position: 'relative' }}>
              <Bell size={20} color="var(--text-secondary)" />
              {routes.incidents.length > 0 && <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, background: 'var(--critical)', borderRadius: '50%' }} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-purple)', display: 'grid', placeItems: 'center', fontWeight: 'bold', fontSize: '14px', color: '#fff' }}>AD</div>
              <div style={{ fontSize: '13px' }}>
                <div style={{ fontWeight: 600 }}>管理员</div>
              </div>
            </div>
          </div>
        </header>

        {activeTab === 'Dashboard' && (
          <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0 }}>
            <section className="glass-panel topology-area" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="topology-header" style={{ padding: '24px 32px 0 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '20px', letterSpacing: '0.02em', fontWeight: 600 }}>网络拓扑星图</h2>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px' }}>实时网络：全球基础设施地图</div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '16px' }}>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px', background: 'rgba(255,255,255,0.03)', padding: '6px 16px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>区域: <span style={{ color: 'var(--accent-cyan)' }}>全球</span></span>
                    <span style={{ color: 'var(--text-secondary)' }}>平均延迟: <span style={{ color: '#fff' }}>{data.agents ? '42ms' : '-'}</span></span>
                    <span style={{ color: 'var(--text-secondary)' }}>总吞吐量: <span style={{ color: '#fff' }}>{totalRx}</span></span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--healthy)', boxShadow: '0 0 8px var(--healthy)' }}></span> 健康 (绿)</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)', boxShadow: '0 0 8px var(--warning)' }}></span> 警告 (橙)</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--critical)', boxShadow: '0 0 8px var(--critical)' }}></span> 严重 (红)</span>
                  </div>
                </div>
              </div>
              
              <div style={{ flex: 1, position: 'relative', minHeight: '400px', display: 'flex' }}>
                 <SegmentTopology data={data} onNodeDetail={setSelectedNode} config={config} hoveredNodeId={hoveredNodeId} hoveredAlertEdge={hoveredAlertEdge} />
              </div>
            </section>
            
            <aside className="right-sidebar custom-scrollbar" style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', paddingRight: '8px' }}>
              <div className="glass-panel" style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                 <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
                   实时告警 ({routes.incidents.length}) <span>•••</span>
                 </div>
                 <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>
                    {routes.incidents.map((incident, i) => {
                      const fromName = getNodeName(incident.from, data, config);
                      const toName = incident.to ? getNodeName(incident.to, data, config) : '未知目标';
                      const isCritical = incident.state === 'critical';
                      
                      return (
                        <div 
                          key={i} 
                          onMouseEnter={() => setHoveredAlertEdge({ key: `${incident.from}->${incident.to}` })}
                          onMouseLeave={() => setHoveredAlertEdge(null)}
                          onClick={() => setSelectedNode(data.agents?.[incident.from] || { id: incident.from })}
                          style={{ 
                            background: isCritical ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                            borderLeft: `2px solid ${isCritical ? 'var(--critical)' : 'var(--warning)'}`,
                            padding: '12px',
                            borderRadius: '0 8px 8px 0',
                            display: 'flex', 
                            gap: '12px', 
                            alignItems: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: isCritical ? 'inset 0 0 12px rgba(239, 68, 68, 0.02)' : 'none'
                          }}
                        >
                          <div style={{ color: isCritical ? 'var(--critical)' : 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {isCritical ? <X size={16}/> : <Activity size={16}/>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {fromName} ➔ {toName}
                            </div>
                            <div style={{ fontSize: '12px', color: isCritical ? 'rgba(239, 68, 68, 0.8)' : 'rgba(245, 158, 11, 0.8)', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                              <span>延迟突增</span>
                              <span style={{ fontWeight: 600 }}>{incident.latency?.ping}ms</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {routes.incidents.length === 0 && <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>✅ 所有节点健康运行，暂无告警。</div>}
                 </div>
              </div>

              <div id="issue-tray-portal" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}></div>
            </aside>
          </div>
        )}

        {activeTab === 'Servers' && (
          <section className="glass-panel" style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '20px', letterSpacing: '0.02em', fontWeight: 600, marginBottom: '24px' }}>SERVERS ({nodes.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '24px' }}>
              {nodes.map(node => (
                <NodeCard key={node.id} stats={node} onClick={() => setSelectedNode(node)} />
              ))}
            </div>
          </section>
        )}

        {activeTab === 'Routing' && (
          <section className="glass-panel" style={{ flex: 1, padding: '32px', display: 'grid', placeItems: 'center' }}>
            <h2 style={{ color: 'var(--text-muted)' }}>Routing Visualization Coming Soon</h2>
          </section>
        )}
        {activeTab === 'Settings' && (
          <section className="glass-panel" style={{ flex: 1, padding: '32px', display: 'grid', placeItems: 'center' }}>
            <h2 style={{ color: 'var(--text-muted)' }}>System Settings Coming Soon</h2>
          </section>
        )}
      </main>

      {selectedNode && (
        <NodeDetailModal 
          agent={selectedNode} 
          onClose={() => setSelectedNode(null)} 
        />
      )}
    </div>
  );
}

export default App;
