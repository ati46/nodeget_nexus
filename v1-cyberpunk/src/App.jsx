import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, Clock3, Loader2, Radio, RotateCcw, Server, Palette } from 'lucide-react';
import SegmentTopology from './components/SegmentTopology';
import NodeCard from './components/NodeCard';
import NodeDetailModal from './components/NodeDetailModal';
import GlobalNetworkPanel from './components/GlobalNetworkPanel';
import GlobalLatencyPanel from './components/GlobalLatencyPanel';
import { fetch24hTaskHistory, fetchAgentMetadata, fetchAllAgentUuids, fetchDynamicData, fetchFrontendConfig, fetchStaticData, fetchTaskLatencies, initApi } from './apiClient';
import { transformData } from './dataTransformer';
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
const timeLabel = (value) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';

const App = () => {
  const [config, setConfig] = useState(null);
  const [data, setData] = useState(null);
  const [history24h, setHistory24h] = useState({});
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedIncidentKey, setSelectedIncidentKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [demoMode, setDemoMode] = useState(() => new URLSearchParams(window.location.search).get('demo') === '1');
  const [theme, setTheme] = useState(() => localStorage.getItem('nodeget-theme') || 'cyberpunk');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nodeget-theme', theme);
  }, [theme]);
  const snapshotRef = useRef(null);
  const latencyRef = useRef({});

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        // [CAUTION] External configuration request; response is validated before use.
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
          setConnection('demo'); setUpdatedAt(Date.now()); setLoading(false);
          return;
        }

        // Initialize WebSocket RPC client
        initApi(apiUrl || '/', apiToken || '');

        // Dynamic KV Merge (KV wins, static config supplements)
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

        if (!active.topology?.layers?.length) {
          throw new Error('拓扑配置缺失：必须包含 topology.layers（支持配置于 KV 或 config.json）。');
        }

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
        setConnection('live');
        setUpdatedAt(Date.now());
        setLoading(false);
      } catch (cause) {
        if (cancelled) return;
        console.error('Dashboard initialization failed:', cause);
        setError(cause.message || String(cause));
        setConnection('offline');
        setLoading(false);
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
          setUpdatedAt(Date.now());
          setConnection('live');
        }
      } catch (cause) {
        console.warn('Dynamic refresh failed:', cause);
        if (!cancelled) setConnection('stale');
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

  const routes = useMemo(() => {
    const summary = { healthy: 0, warning: 0, critical: 0, unknown: 0, incidents: [] };
    if (!config || !data) return summary;
    const seen = new Set();
    const edges = Array.isArray(config.edges) ? config.edges : [];
    edges.forEach((edge) => {
      if (!edge || !edge.from || !edge.to) return;
      const key = `${edge.from}->${edge.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      const latency = data.latencies?.[key];
      const state = routeState(latency);
      summary[state] += 1;
      if (state === 'warning' || state === 'critical') {
        summary.incidents.push({ ...edge, key, latency, state, task: config.latency_tasks?.[key] || edge.latencyTask || null });
      }
    });
    return summary;
  }, [config, data]);

  useEffect(() => {
    if (!selectedIncidentKey || routes.incidents.some((item) => item.key === selectedIncidentKey)) return;
    setSelectedIncidentKey(null);
  }, [routes.incidents, selectedIncidentKey]);

  const selectedIncident = routes.incidents.find((item) => item.key === selectedIncidentKey);
  const selectedLatencyTask = selectedIncident?.task || null;
  const handleIncidentSelect = (item) => {
    if (!item.task || !history24h[item.task]) return;
    setSelectedIncidentKey((current) => current === item.key ? null : item.key);
  };
  const nodes = useMemo(() => data ? Object.values(data.agents).sort((a, b) => a.status !== b.status ? (a.status === 'offline' ? -1 : 1) : b.cpu - a.cpu) : [], [data]);
  const enterDemo = () => { setError(null); setLoading(true); setDemoMode(true); };

  if (loading) return <div className="center-state" role="status"><div className="boot-mark"><Loader2 size={22} /></div><p className="eyebrow">NODEGET / NEXUS</p><h1>正在建立监控链路</h1><p>读取拓扑、Agent 快照与线路拨测结果。</p></div>;
  if (error) return <div className="center-state error-state"><div className="boot-mark error"><AlertTriangle size={22} /></div><p className="eyebrow">CONNECTION INTERRUPTED</p><h1>无法连接 NodeGet</h1><p>{error}</p><div className="state-actions"><button className="button primary" onClick={() => window.location.reload()}><RotateCcw size={16} />重新连接</button><button className="button ghost" onClick={enterDemo}>查看演示界面<ArrowRight size={16} /></button></div></div>;
  if (!data || !config) return null;

  return (
    <div className="app-shell">
      <header className="command-header">
        <div className="brand-lockup"><div className="brand-glyph" aria-hidden="true"><span /><span /><span /></div><div><p className="eyebrow">NODEGET / ROUTE OPERATIONS</p><h1>Nexus <span>线路控制台</span></h1></div></div>
        <div className="header-status">
          <button type="button" className="icon-button" onClick={() => setTheme(t => t === 'cyberpunk' ? 'glass' : 'cyberpunk')} title="切换主题 (Theme)">
            <Palette size={16} />
          </button>
          <span className={`connection-badge ${connection}`}><Radio size={14} />{connection === 'demo' ? 'DEMO' : connection === 'stale' ? 'STALE' : 'LIVE'}</span>
          <span className="updated-at"><Clock3 size={14} />{timeLabel(updatedAt)}</span>
        </div>
      </header>
      <main className="dashboard">
        <GlobalNetworkPanel global={data.global} routeSummary={routes} />
        <section className="panel topology-panel">
          <div className="section-heading"><div><p className="eyebrow">ROUTE LENS</p><h2>端到端链路</h2><p>选择节点，聚焦它参与的全部路径。</p></div><div className="legend"><span><i className="healthy" />正常</span><span><i className="warning" />波动</span><span><i className="critical" />故障</span><span><i className="unknown" />无数据</span></div></div>
          <SegmentTopology data={data} onNodeDetail={setSelectedNode} />
        </section>
        <div className="insight-grid">
          <section className="panel incidents-panel"><div className="section-heading compact"><div><p className="eyebrow">ATTENTION QUEUE</p><h2>需要关注</h2></div><span className="count-badge">{routes.incidents.length}</span></div>
            {routes.incidents.length ? (
              <div className="incident-list">
                {routes.incidents.slice(0, 5).map((item) => {
                  const isSelected = selectedIncidentKey === item.key;
                  const hasHistory = Boolean(item.task && history24h[item.task]);
                  return (
                    <button
                      type="button"
                      className={`incident-row ${item.state} ${isSelected ? 'is-selected' : ''}`}
                      key={item.key}
                      onClick={() => handleIncidentSelect(item)}
                      aria-pressed={isSelected}
                      disabled={!hasHistory}
                      title={hasHistory ? `在历史图表中聚焦 ${item.task}` : '该线路没有可用的历史拨测'}
                    >
                      <AlertTriangle size={17} />
                      <div>
                        <strong title={`${item.from} → ${item.to}`}>{getNodeName(item.from, data, config)} → {getNodeName(item.to, data, config)}</strong>
                        <span>{item.latency?.ping === 'fail' ? '探测失败' : `${item.latency?.ping} ms · 丢包 ${item.latency?.loss || 0}%`}</span>
                        <small>{item.task || '未关联历史任务'}</small>
                      </div>
                      <ArrowRight className="incident-row-arrow" size={15} />
                    </button>
                  );
                })}
              </div>
            ) : <div className="quiet-state"><Activity size={22} /><strong>当前没有异常线路</strong><span>所有可观测路径都在阈值内。</span></div>}
          </section>
          <section className="panel latency-panel"><div className="section-heading compact"><div><p className="eyebrow">LATENCY HISTORY</p><h2>延迟与丢包</h2></div></div>{Object.keys(history24h).length ? <GlobalLatencyPanel historyData={history24h} hideTitle selectedSource={selectedLatencyTask} onClearSource={() => setSelectedIncidentKey(null)} /> : <div className="quiet-state"><Activity size={22} /><strong>暂无历史拨测</strong></div>}</section>
        </div>
        <section className="panel assets-panel"><div className="section-heading"><div><p className="eyebrow">AGENT ROSTER</p><h2>节点资产</h2><p>优先显示离线节点和资源占用较高的节点。</p></div><span className="asset-count"><Server size={15} />{nodes.length} Agents</span></div><div className="asset-list">{nodes.map((node) => <NodeCard key={node.id} stats={node} onClick={() => setSelectedNode(node)} />)}</div></section>
      </main>
      <footer className="site-footer"><span>NodeGet Nexus</span><span>Read-only telemetry surface</span></footer>
      {selectedNode && <NodeDetailModal agent={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  );
};

export default App;
