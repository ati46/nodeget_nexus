import React, { useState, useEffect } from 'react';
import SegmentTopology from './components/SegmentTopology';
import NodeCard from './components/NodeCard';
import NodeDetailModal from './components/NodeDetailModal';
import GlobalNetworkPanel from './components/GlobalNetworkPanel';
import GlobalLatencyPanel from './components/GlobalLatencyPanel';
import { Activity, Grid, Loader2 } from 'lucide-react';
import { initApi, fetchAgentMetadata, fetchStaticData, fetchDynamicData, fetchFrontendConfig, fetchTaskLatencies, fetch24hTaskHistory, fetchAllAgentUuids } from './apiClient';
import { transformData } from './dataTransformer';
import './index.css';

const App = () => {
  const [remoteConfig, setRemoteConfig] = useState(null);
  const [data, setData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState(null);
  
  // Persist fetched data for polling merges
  const [metadataMap, setMetadataMap] = useState({});
  const [staticData, setStaticData] = useState([]);
  const [history24h, setHistory24h] = useState({});

  // 1. Initial Setup: Load config.json, init API, fetch metadata & static
  useEffect(() => {
    const initialize = async () => {
      try {
        const res = await fetch('config.json');
        const cfg = await res.json();
        setRemoteConfig(cfg);
        
        let apiUrl = cfg.api_url || '/';
        let apiToken = cfg.api_token || '';

        if (cfg.site_tokens && cfg.site_tokens.length > 0) {
          const site = cfg.site_tokens[0];
          apiUrl = site.backend_url || apiUrl;
          apiToken = site.token || apiToken;
        }

        initApi(apiUrl, apiToken);

        // Try to fetch topology routes from NodeGet KV (Dynamic configuration!)
        const kvConfig = await fetchFrontendConfig();
        // Fallback to static config.json if KV is not set or empty
        const activeConfig = (kvConfig && kvConfig.topology_routes) ? kvConfig : cfg;
        
        if (!activeConfig.topology_routes) {
          throw new Error("Missing topology_routes. The token might lack KV Read permissions, or you deleted it from config.json before saving it to KV.");
        }
        
        // Ensure latency_tasks from static config is loaded/merged if KV lacks it or is outdated
        if (cfg.latency_tasks) {
          activeConfig.latency_tasks = { ...activeConfig.latency_tasks, ...cfg.latency_tasks };
        }
        
        setRemoteConfig(activeConfig);

        // Extract unique UUIDs from topology (excluding virtual nodes)
        const uuids = new Set();
        activeConfig.topology_routes.forEach(route => {
          route.nodes.forEach(n => {
            if (n !== 'client' && n !== 'internet') uuids.add(n);
          });
        });
        
        // Dynamically fetch ALL active agents from the backend, so Server Grid shows all assets (even if not in topology)
        const allAgents = await fetchAllAgentUuids();
        allAgents.forEach(u => uuids.add(u));

        const uuidList = Array.from(uuids);

        // Fetch Metadata (Names) and Static Data (OS/CPU)
        const meta = await fetchAgentMetadata(uuidList);
        const stat = await fetchStaticData(uuidList);
        
        setMetadataMap(meta);
        setStaticData(stat);

        // First dynamic fetch
        const dyn = await fetchDynamicData(uuidList);
        // Also fetch initial latencies if configured
        if (activeConfig.latency_tasks) {
          realLatenciesRef.current = await fetchTaskLatencies(activeConfig.latency_tasks);
        }
        setData(transformData(meta, stat, dyn, activeConfig, realLatenciesRef.current));
        
        setIsInitializing(false);
      } catch (err) {
        console.error("Failed to initialize:", err);
        setInitError(err.message || String(err));
        setIsInitializing(false);
      }
    };
    initialize();
  }, []);

  // 2. Data Polling loop
  const realLatenciesRef = React.useRef({});

  useEffect(() => {
    if (!remoteConfig || isInitializing) return;
    
    const uuidList = Object.keys(metadataMap);
    if (uuidList.length === 0) return;

    const timer = setInterval(async () => {
      const dyn = await fetchDynamicData(uuidList);
      setData(transformData(metadataMap, staticData, dyn, remoteConfig, realLatenciesRef.current));
    }, 2000);
    
    return () => clearInterval(timer);
  }, [remoteConfig, isInitializing, metadataMap, staticData]);

  // 3. Latency Polling loop (every 20s to protect DB)
  useEffect(() => {
    if (!remoteConfig || !remoteConfig.latency_tasks || isInitializing) return;
    
    const fetchLatencies = async () => {
      const lats = await fetchTaskLatencies(remoteConfig.latency_tasks);
      realLatenciesRef.current = lats;
    };
    
    const fetch24h = async () => {
      const hist = await fetch24hTaskHistory(remoteConfig.latency_tasks);
      setHistory24h(hist);
    };

    fetchLatencies();
    fetch24h(); // initial load of 24h data

    const timer = setInterval(fetchLatencies, 20000); // 20s for real-time dots
    const timer24h = setInterval(fetch24h, 5 * 60 * 1000); // 5 minutes for massive 24h history
    return () => {
      clearInterval(timer);
      clearInterval(timer24h);
    };
  }, [remoteConfig, isInitializing]);

  if (isInitializing) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <Loader2 className="spin" size={48} color="var(--accent-cyan)" />
        <h2 style={{ color: 'var(--text-primary)', letterSpacing: '2px' }}>LOADING NODEGET KV CONFIG...</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Fetching dynamic topology namespace</p>
      </div>
    );
  }

  if (initError) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem' }}>
        <div style={{ background: 'rgba(244, 63, 94, 0.1)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--accent-rose)', maxWidth: '600px', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--accent-rose)', marginBottom: '1rem' }}>Failed to Initialize Dashboard</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Please check your <code>config.json</code> (especially the <code>api_url</code>) and ensure you are logged into the NodeGet Admin Dashboard on this browser.
          </p>
          <div style={{ background: 'rgba(0,0,0,0.5)', padding: '1rem', borderRadius: '8px', color: '#ff8a8a', fontFamily: 'monospace', fontSize: '0.9rem', textAlign: 'left', wordBreak: 'break-all' }}>
            {initError}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Find all mapped UUIDs in the topology config
  const mappedNodeIds = new Set();
  remoteConfig.topology_routes.forEach(route => {
    route.nodes.forEach(id => mappedNodeIds.add(id));
  });

  // All nodes will be shown in the Grid
  const allNodes = Object.values(data.agents);

  return (
    <div className="app-container">
      <GlobalNetworkPanel global={data.global} />

      <main>
        {/* Middle: Clean Routing Topology View */}
        <div className="glass-card" style={{ padding: '1rem 2rem', marginBottom: '1.5rem' }}>
          <h2 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
            Routing Topology (网络连通性)
          </h2>
          <SegmentTopology data={data} onNodeClick={(nodeStats) => setSelectedNode(nodeStats)} />
        </div>

        {/* Bottom: Detailed Grid View for ALL nodes */}
        {allNodes.length > 0 && (
          <div className="glass-card" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Grid size={20} color="var(--accent-emerald)" />
              Server Grid (全景资产管理)
            </h2>
            <div className="nodes-grid">
              {allNodes.map(nodeStats => (
                <NodeCard 
                  key={nodeStats.id} 
                  node={{ id: nodeStats.id, name: nodeStats.name }} 
                  stats={nodeStats}
                  onClick={() => setSelectedNode(nodeStats)}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modal for 3-ISP Ping details */}
      {selectedNode && (
        <NodeDetailModal 
          agent={selectedNode} 
          onClose={() => setSelectedNode(null)} 
        />
      )}

      <footer style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem', fontSize: '0.9rem' }}>
        <p>Powered by NodeGet JSON-RPC &middot; Hybrid Auto-Discovery</p>
      </footer>
    </div>
  );
}

export default App;
