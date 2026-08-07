import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, LayoutDashboard, Server, Settings, Search, Bell, Monitor, BarChart3, ChevronRight, Cpu, ArrowDown, ArrowUp, HardDrive, Network, Clock3 } from 'lucide-react';
import { RadialBarChart, RadialBar, ResponsiveContainer, AreaChart, Area } from 'recharts';
import SegmentTopology from './components/SegmentTopology';
import NodeCard from './components/NodeCard';
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
  const [glassLevel, setGlassLevel] = useState(() => parseInt(getCookie('glassLevel') || '10', 10));
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
        const [metadata, staticData, dynamicData, latencies, history] = await Promise.all([
          fetchAgentMetadata(uuidList),
          fetchStaticData(uuidList),
          fetchDynamicData(uuidList),
          fetchTaskLatencies(active.latency_tasks),
          fetch24hTaskHistory(active.latency_tasks),
        ]);

        if (cancelled) return;
        snapshotRef.current = { metadata, staticData, uuidList };
        latencyRef.current = latencies;
        setConfig(active);
        setHistory24h(history);
        setData(transformData(metadata, staticData, dynamicData, active, latencies));
        setLoading(false);
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

  const nodes = useMemo(() => data ? Object.values(data.agents).sort((a, b) => a.status !== b.status ? (a.status === 'offline' ? -1 : 1) : b.cpu - a.cpu) : [], [data]);
  
  const { maxCpu, maxCpuNode, maxRam, maxRamNode, totalRx, totalTx } = useMemo(() => {
    if (!nodes.length) return { maxCpu: 0, maxCpuNode: '-', maxRam: 0, maxRamNode: '-', totalRx: 0, totalTx: 0 };
    let cpuMax = 0, ramMax = 0, rx = 0, tx = 0, count = 0;
    let cpuNodeName = '-', ramNodeName = '-';
    nodes.forEach(n => {
      if (n.status === 'online') {
        if (n.cpu >= cpuMax) { cpuMax = n.cpu; cpuNodeName = n.name || n.id; }
        if (n.ram_total) {
          const rPct = (n.ram_used / n.ram_total) * 100;
          if (rPct >= ramMax) { ramMax = rPct; ramNodeName = n.name || n.id; }
        }
        rx += n.net_rx_speed || 0;
        tx += n.net_tx_speed || 0;
        count++;
      }
    });
    return {
      maxCpu: count ? Math.round(cpuMax) : 0,
      maxCpuNode: cpuNodeName,
      maxRam: count ? Math.round(ramMax) : 0,
      maxRamNode: ramNodeName,
      totalRx: formatBytes(rx) + '/s',
      totalTx: formatBytes(tx) + '/s'
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
              AETHERMONITOR
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>/ Netview</div>
          </header>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.1em' }}>SERVERS ({nodes.filter(n => n.status === 'online').length} ACTIVE)</div>
          <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', border: '1px solid var(--border-light)' }}>
            <Activity size={16} /> Network
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '20px', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
            SYSTEM OVERVIEW <span>•••</span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}><Activity size={14}/> CPU</span>
                <span style={{ fontWeight: 'bold' }}>{maxCpu}%</span>
              </div>
              <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${maxCpu}%`, height: '100%', background: maxCpu > 80 ? 'var(--critical)' : 'var(--accent-purple)' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}><Monitor size={14}/> MEM</span>
                <span style={{ fontWeight: 'bold' }}>{maxRam}%</span>
              </div>
              <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${maxRam}%`, height: '100%', background: maxRam > 90 ? 'var(--critical)' : 'var(--accent-cyan)' }} />
              </div>
            </div>
            
            <div style={{ marginTop: '8px', height: '40px', width: '100%' }}>
               <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={[{v:30},{v:40},{v:35},{v:50},{v:45},{v:60}]}>
                   <defs>
                     <linearGradient id="colorV" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.3}/><stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0}/></linearGradient>
                   </defs>
                   <Area type="monotone" dataKey="v" stroke="var(--accent-cyan)" strokeWidth={2} fillOpacity={1} fill="url(#colorV)" />
                 </AreaChart>
               </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
            LIVE ALERTS <span>•••</span>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <span style={{ padding: '4px 8px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--critical)', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--critical)'}}></span> {routes.incidents.filter(i => i.state === 'critical').length} Critical
            </span>
            <span style={{ padding: '4px 8px', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', borderRadius: '12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)'}}></span> {routes.incidents.filter(i => i.state === 'warning').length} Warning
            </span>
          </div>
          
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '8px' }}>
            {routes.incidents.map((incident, i) => (
              <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ color: incident.state === 'critical' ? 'var(--critical)' : 'var(--warning)', marginTop: '2px' }}>
                  {incident.state === 'critical' ? <X size={14}/> : <Activity size={14}/>}
                </div>
                <div style={{ fontSize: '12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Node: {incident.from}</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: '4px' }}>Latency Spike: {incident.latency?.ping}ms</div>
                </div>
              </div>
            ))}
            {routes.incidents.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No active alerts.</div>}
          </div>
        </div>
      </aside>
      )}

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', gridColumn: activeTab === 'Dashboard' ? '3' : '2 / -1', paddingRight: '8px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
          <div style={{ position: 'relative', width: '320px' }}>
            <Search size={16} style={{ position: 'absolute', left: 16, top: 10, color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Search" style={{ width: '100%', background: 'rgba(20,22,35,0.75)', border: '1px solid var(--border-light)', borderRadius: '20px', padding: '8px 16px 8px 40px', color: '#fff', fontSize: '14px', outline: 'none' }} />
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Opacity</span>
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
                <div style={{ fontWeight: 600 }}>Admin</div>
              </div>
            </div>
          </div>
        </header>

        {activeTab === 'Dashboard' && (
          <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0 }}>
            <section className="glass-panel topology-area" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="topology-header" style={{ padding: '24px 32px 0 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '20px', letterSpacing: '0.02em', fontWeight: 600 }}>NETWORK TOPOLOGY MAP</h2>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px' }}>Live Network: Global Infrastructure Map</div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '16px' }}>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px', background: 'rgba(255,255,255,0.03)', padding: '6px 16px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Region: <span style={{ color: 'var(--accent-cyan)' }}>Global</span></span>
                    <span style={{ color: 'var(--text-secondary)' }}>Avg Latency: <span style={{ color: '#fff' }}>{data.agents ? '42ms' : '-'}</span></span>
                    <span style={{ color: 'var(--text-secondary)' }}>Throughput: <span style={{ color: '#fff' }}>{totalRx}</span></span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--healthy)', boxShadow: '0 0 8px var(--healthy)' }}></span> Healthy Green</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)', boxShadow: '0 0 8px var(--warning)' }}></span> Warning Orange</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--critical)', boxShadow: '0 0 8px var(--critical)' }}></span> Critical Red</span>
                  </div>
                </div>
              </div>
              
              <div style={{ flex: 1, position: 'relative', minHeight: '400px', display: 'flex' }}>
                 <SegmentTopology data={data} onNodeDetail={() => {}} />
              </div>
            </section>
            
            <aside className="right-sidebar custom-scrollbar" style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', paddingRight: '8px' }}>
              <div className="glass-panel" style={{ padding: '20px' }}>
                 <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
                   TRAFFIC SUMMARY <span>•••</span>
                 </div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <div>
                     <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Ingress: <span style={{ color: '#fff', fontWeight: 600 }}>{totalRx}</span></div>
                     <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Egress: <span style={{ color: '#fff', fontWeight: 600 }}>{totalTx}</span></div>
                   </div>
                   <div style={{ width: '120px', height: '40px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={[{v:20},{v:40},{v:30},{v:50},{v:30},{v:60}]}>
                          <Area type="monotone" dataKey="v" stroke="var(--accent-cyan)" strokeWidth={2} fill="transparent" />
                        </AreaChart>
                      </ResponsiveContainer>
                   </div>
                 </div>
              </div>
              
              <div className="glass-panel" style={{ padding: '20px' }}>
                 <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '20px', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
                   SERVER HEALTH <span>•••</span>
                 </div>
                 <div style={{ display: 'flex', gap: '2px', height: '6px', borderRadius: '3px', overflow: 'hidden', marginBottom: '16px' }}>
                   <div style={{ flex: nodes.filter(n => n.status === 'online').length, background: 'var(--healthy)' }}></div>
                   <div style={{ flex: routes.incidents.filter(i => i.state === 'warning').length, background: 'var(--warning)' }}></div>
                   <div style={{ flex: nodes.filter(n => n.status === 'offline').length, background: 'var(--critical)' }}></div>
                 </div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 500 }}>
                   <span style={{ color: 'var(--healthy)' }}>Online: {nodes.filter(n => n.status === 'online').length}</span>
                   <span style={{ color: 'var(--warning)' }}>Warning: {routes.incidents.filter(i => i.state === 'warning').length}</span>
                   <span style={{ color: 'var(--critical)' }}>Offline: {nodes.filter(n => n.status === 'offline').length}</span>
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
                <NodeCard key={node.id} stats={node} onClick={() => setSelectedNode(node.id)} />
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
    </div>
  );
}

export default App;
