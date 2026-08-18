import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Globe2, Server, X, User, Cloud } from 'lucide-react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { geoEquirectangular } from 'd3-geo';
import topoData from '../assets/features.json';

const VIRTUAL_NODE_LABELS = {
  client: 'Client',
  internet: 'Internet',
  '外网': '外网'
};

const LAYER_THEMES = [
  'transit',
  'landing',
  'target',
  'custom'
];

const EMPTY_EDGES = [];

const LAYER_VIEWPORT = {
  paddingX: 24,
  paddingTop: 48,
  paddingBottom: 36,
  defaultLayerGap: 240,
  layerGaps: [240, 240, 240],
  nodeWidth: 136,
  nodeHeight: 56,
  nodeGap: 24
};

const mapWidth = 1600;
const mapHeight = 700;
const mapProjection = geoEquirectangular()
  .scale(250)
  .translate([mapWidth / 2, mapHeight / 2 + 140]);

const RAW_GEO_REGIONS = [
  { id: 'unknown', regex: /.*/, lon: 0, lat: 0, color: 'rgba(255, 255, 255, 0.15)', country: 'Unknown', label: 'Unknown Location', glow: 'rgba(255, 255, 255, 0.5)' }
];

const isRealUuid = (nodeId) => (
  typeof nodeId === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)
);

const getNodeLabel = (nodeId, stats, config) => {
  if (stats && stats.name) return stats.name;
  if (config?.node_metadata?.[nodeId]?.name) return config.node_metadata[nodeId].name;
  if (VIRTUAL_NODE_LABELS[nodeId]) return VIRTUAL_NODE_LABELS[nodeId];
  return nodeId;
};

const trimNodeLabel = (label) => {
  if (!label) return '';
  return label.length > 10 ? `${label.slice(0, 9)}...` : label;
};

const getLatencyState = (latency) => {
  if (!latency) return 'unknown';
  if (latency.ping === 'fail' || latency.loss > 20) return 'critical';
  if (latency.ping > 150 || latency.loss > 5) return 'warning';
  return 'healthy';
};

const getLatencyLabel = (latency) => {
  if (!latency || (typeof latency.ping !== 'number' && latency.ping !== 'fail')) return '0ms';
  if (latency.ping === 'fail') return `${latency.loss || 100}% loss`;
  if (latency.loss > 0) return `${latency.ping}ms / ${latency.loss}%`;
  return `${latency.ping}ms`;
};

const getMapArcPath = (x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx*dx + dy*dy);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const arcHeight = distance * 0.25;
  return `M ${x1} ${y1} Q ${midX} ${midY - arcHeight}, ${x2} ${y2}`;
};

const getBezierPath = (x1, y1, x2, y2) => {
  const distance = Math.max(32, x2 - x1);
  const curve = Math.min(70, distance * 0.44);
  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
};

const SegmentTopology = ({ data, onNodeDetail, config, hoveredNodeId, hoveredAlertEdge }) => {
  // Pure automatic detection: mobile displays layered topology, desktop displays 2D map
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 960 : false));
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [hoveredMapRegion, setHoveredMapRegion] = useState(null);
  const [pinnedEdgeKey, setPinnedEdgeKey] = useState(null);
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    setPortalTarget(document.getElementById('issue-tray-portal'));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 960);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!activeNodeId && !pinnedEdgeKey) return undefined;
    const clearFocus = (event) => {
      if (event.key === 'Escape') {
        setActiveNodeId(null);
        setHoveredEdge(null);
        setPinnedEdgeKey(null);
      }
    };
    window.addEventListener('keydown', clearFocus);
    return () => window.removeEventListener('keydown', clearFocus);
  }, [activeNodeId, pinnedEdgeKey]);

  const GEO_REGIONS = useMemo(() => {
    const customRegions = Array.isArray(config?.geo_regions) 
      ? config.geo_regions.map(r => {
          let reg;
          try { reg = new RegExp(r.regex, 'i'); } catch (e) { reg = /.*/; }
          return { ...r, regex: reg };
        })
      : [];
    
    const customIds = new Set(customRegions.map(r => r.id));
    const merged = [
      ...customRegions,
      ...RAW_GEO_REGIONS.filter(r => !customIds.has(r.id))
    ];

    return merged.map(r => {
      const [x, y] = mapProjection([r.lon, r.lat]);
      if (r.id === 'entry') return { ...r, x: 1500, y: 100 };
      if (r.id === 'target') return { ...r, x: 100, y: 100 };
      return { ...r, x, y };
    });
  }, [config?.geo_regions]);

  const topology = data && data.config && data.config.topology ? data.config.topology : null;
  const edges = data && data.config && Array.isArray(data.config.edges) ? data.config.edges : EMPTY_EDGES;
  const layers = topology && Array.isArray(topology.layers) ? topology.layers : null;

  const visibleEdges = useMemo(() => {
    const edgeMap = new Map();
    edges.forEach((edge) => {
      if (!edge || !edge.from || !edge.to) return;
      const key = `${edge.from}->${edge.to}`;
      if (!edgeMap.has(key)) edgeMap.set(key, edge);
    });
    return Array.from(edgeMap.values());
  }, [edges]);

  // Layered Layout for Mobile
  const layeredLayout = useMemo(() => {
    if (!layers) return null;
    const maxNodes = layers.reduce((max, layer) => Math.max(max, Array.isArray(layer.nodes) ? layer.nodes.length : 0), 0);
    const layerSpan = (layers.length - 1) * LAYER_VIEWPORT.defaultLayerGap;
    const width = (LAYER_VIEWPORT.paddingX * 2) + layerSpan + LAYER_VIEWPORT.nodeWidth;
    const height = LAYER_VIEWPORT.paddingTop + LAYER_VIEWPORT.paddingBottom + (maxNodes * LAYER_VIEWPORT.nodeHeight) + (Math.max(0, maxNodes - 1) * LAYER_VIEWPORT.nodeGap);
    const nodeMap = new Map();

    layers.forEach((layer, layerIndex) => {
      const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];
      const columnHeight = (nodes.length * LAYER_VIEWPORT.nodeHeight) + (Math.max(0, nodes.length - 1) * LAYER_VIEWPORT.nodeGap);
      const firstY = LAYER_VIEWPORT.paddingTop + ((height - LAYER_VIEWPORT.paddingTop - LAYER_VIEWPORT.paddingBottom - columnHeight) / 2);
      const x = LAYER_VIEWPORT.paddingX + (layerIndex * LAYER_VIEWPORT.defaultLayerGap);

      nodes.forEach((nodeId, nodeIndex) => {
        nodeMap.set(nodeId, {
          id: nodeId,
          layerIndex,
          x,
          y: firstY + (nodeIndex * (LAYER_VIEWPORT.nodeHeight + LAYER_VIEWPORT.nodeGap)),
          width: LAYER_VIEWPORT.nodeWidth,
          height: LAYER_VIEWPORT.nodeHeight
        });
      });
    });

    return { width, height, nodeMap };
  }, [layers]);

  // 2D Map Layout for Desktop
  const mapLayout = useMemo(() => {
    if (!layers) return null;
    const regionNodes = new Map();
    const activeRegions = new Set();
    const explicitlyMappedNodes = new Set();

    layers.forEach((layer, layerIndex) => {
      const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];
      nodes.forEach((nodeId) => {
        explicitlyMappedNodes.add(nodeId);
        const name = data?.agents?.[nodeId]?.name || config?.node_metadata?.[nodeId]?.name || nodeId;
        const flag = data?.agents?.[nodeId]?.flag || config?.node_metadata?.[nodeId]?.flag || '';
        let matchedRegion = null;
        
        for (const region of GEO_REGIONS) {
          if (region.regex.test(name) || region.regex.test(nodeId) || (flag && region.regex.test(flag))) {
            matchedRegion = region;
            break;
          }
        }
        
        if (!matchedRegion) {
          let hash = 0;
          for (let i = 0; i < nodeId.length; i++) hash = nodeId.charCodeAt(i) + ((hash << 5) - hash);
          matchedRegion = { id: 'unknown', x: 500 + Math.abs(hash % 200), y: 200 + Math.abs(hash % 200) };
        }

        const cluster = regionNodes.get(matchedRegion.id) || [];
        cluster.push({ nodeId, region: matchedRegion, layerIndex });
        regionNodes.set(matchedRegion.id, cluster);
        activeRegions.add(matchedRegion.id);
      });
    });

    const nodeMap = new Map();
    regionNodes.forEach((cluster, regionId) => {
      const total = cluster.length;
      cluster.forEach((item, index) => {
        const angle = total === 1 ? 0 : (index / total) * 2 * Math.PI;
        const radius = total === 1 ? 0 : Math.min(70, 24 + total * 8);
        const x = item.region.x + Math.cos(angle) * radius;
        const y = item.region.y + Math.sin(angle) * radius;
        nodeMap.set(item.nodeId, {
          x: Math.max(20, Math.min(mapWidth - 100, x)),
          y: Math.max(20, Math.min(mapHeight - 60, y)),
          width: 36,
          height: 32,
          regionId
        });
      });
    });

    const regionNamesMap = new Map();
    if (data.agents) {
      Object.keys(data.agents).forEach(nodeId => {
        const name = data.agents[nodeId].name || config?.node_metadata?.[nodeId]?.name || nodeId;
        const flag = data.agents[nodeId].flag || config?.node_metadata?.[nodeId]?.flag || '';
        let matchedRegion = null;
        for (const region of GEO_REGIONS) {
          if (region.regex.test(name) || region.regex.test(nodeId) || (flag && region.regex.test(flag))) {
            matchedRegion = region;
            break;
          }
        }
        if (matchedRegion && matchedRegion.id !== 'unknown') {
          activeRegions.add(matchedRegion.id);
          const names = regionNamesMap.get(matchedRegion.id) || [];
          names.push(name);
          regionNamesMap.set(matchedRegion.id, names);
        }
      });
    }

    return { width: mapWidth, height: mapHeight, nodeMap, activeRegions: Array.from(activeRegions), regionNamesMap };
  }, [layers, data, config, GEO_REGIONS]);

  if (!data || !data.agents) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-secondary)' }}>加载拓扑数据中...</div>;
  }

  if (!layers || visibleEdges.length === 0) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-secondary)' }}>暂无可用拓扑配置</div>;
  }

  const effectiveActiveNodeId = hoveredNodeId || activeNodeId;
  const activeEdges = effectiveActiveNodeId
    ? visibleEdges.filter((edge) => edge.from === effectiveActiveNodeId || edge.to === effectiveActiveNodeId)
    : visibleEdges;
  const activeEdgeKeys = new Set(activeEdges.map((edge) => `${edge.from}->${edge.to}`));
  const connectedNodeIds = new Set();
  activeEdges.forEach((edge) => {
    connectedNodeIds.add(edge.from);
    connectedNodeIds.add(edge.to);
  });

  const spotlightEdge = hoveredAlertEdge
    ? visibleEdges.find((e) => `${e.from}->${e.to}` === hoveredAlertEdge || hoveredAlertEdge.key === `${e.from}->${e.to}`)
    : null;

  const currentHoveredEdge = hoveredAlertEdge
    ? visibleEdges.find((e) => `${e.from}->${e.to}` === (hoveredAlertEdge.key || hoveredAlertEdge))
    : hoveredEdge;

  const currentPinnedEdge = pinnedEdgeKey
    ? visibleEdges.find((e) => `${e.from}->${e.to}` === pinnedEdgeKey)
    : null;

  const selectedEdge = currentHoveredEdge || currentPinnedEdge;

  const issueEdges = useMemo(() => {
    return visibleEdges.filter((edge) => {
      const key = `${edge.from}->${edge.to}`;
      const state = getLatencyState(data.latencies?.[key]);
      return state === 'warning' || state === 'critical';
    });
  }, [visibleEdges, data.latencies]);

  // Compute worst outgoing latencies for 2D map node badges
  const worstOutgoingByNode = new Map();
  visibleEdges.forEach((edge) => {
    const key = `${edge.from}->${edge.to}`;
    const latency = data.latencies?.[key];
    if (!latency) return;
    const state = getLatencyState(latency);
    const existing = worstOutgoingByNode.get(edge.from);
    const score = (lat) => (lat?.ping === 'fail' ? 10000 : lat?.ping || 0);
    if (!existing || score(latency) > score(existing.latency)) {
      worstOutgoingByNode.set(edge.from, { edge, key, latency, state, routeCount: (existing?.routeCount || 0) + 1 });
    }
  });

  const showEdgeTooltip = (event, edge, key, latency, state) => {
    const rect = event.currentTarget.closest('.route-matrix-shell').getBoundingClientRect();
    setHoveredEdge({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top - 50,
      key: key || `${edge.from}->${edge.to}`,
      from: edge.from,
      to: edge.to,
      route: `${getNodeLabel(edge.from, data.agents[edge.from], config)} → ${getNodeLabel(edge.to, data.agents[edge.to], config)}`,
      latency,
      state,
      showTooltip: true
    });
  };

  const handleNodeClick = (nodeId) => {
    setPinnedEdgeKey(null);
    if (activeNodeId === nodeId) {
      setActiveNodeId(null);
      return;
    }
    setActiveNodeId(nodeId);
    if (isRealUuid(nodeId) && data.agents[nodeId] && onNodeDetail) {
      onNodeDetail(data.agents[nodeId]);
    }
  };

  const handleEdgeClick = (edgeKey) => {
    setActiveNodeId(null);
    setPinnedEdgeKey((current) => (current === edgeKey ? null : edgeKey));
  };

  const clearNodeFocus = () => {
    setActiveNodeId(null);
    setHoveredEdge(null);
    setPinnedEdgeKey(null);
  };

  return (
    <div className="route-matrix-shell" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div 
        className="route-matrix-scroll custom-scrollbar"
        style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        {/* MOBILE VIEW: Layered Matrix View */}
        {isMobile && layeredLayout && (
          <svg
            className="route-matrix-canvas"
            viewBox={`0 0 ${layeredLayout.width} ${layeredLayout.height}`}
            style={{ width: '100%', maxWidth: `${layeredLayout.width}px`, height: 'auto', minHeight: '380px' }}
            onClick={clearNodeFocus}
          >
            <defs>
              <marker id="arrow-healthy" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(16, 185, 129, 0.8)" /></marker>
              <marker id="arrow-warning" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(245, 158, 11, 0.8)" /></marker>
              <marker id="arrow-critical" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(239, 68, 68, 0.8)" /></marker>
              <marker id="arrow-unknown" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(255, 255, 255, 0.3)" /></marker>
            </defs>

            {/* Layer Headers */}
            <g className="route-svg-headers">
              {layers.map((layer, index) => {
                const x = LAYER_VIEWPORT.paddingX + (index * LAYER_VIEWPORT.defaultLayerGap) + (LAYER_VIEWPORT.nodeWidth / 2);
                return (
                  <text
                    key={`layer-hdr-${index}`}
                    x={x}
                    y={LAYER_VIEWPORT.paddingTop - 18}
                    textAnchor="middle"
                    fill="var(--text-secondary)"
                    style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}
                  >
                    {layer.name || `第 ${index + 1} 层`}
                  </text>
                );
              })}
            </g>

            {/* Route Edges */}
            <g className="route-svg-edges">
              {visibleEdges.map((edge) => {
                const fromNode = layeredLayout.nodeMap.get(edge.from);
                const toNode = layeredLayout.nodeMap.get(edge.to);
                if (!fromNode || !toNode) return null;

                const edgeKey = `${edge.from}->${edge.to}`;
                const latency = data.latencies?.[edgeKey];
                const state = getLatencyState(latency);
                const isPinned = pinnedEdgeKey === edgeKey;
                const isHovered = (hoveredEdge && `${hoveredEdge.from}->${hoveredEdge.to}` === edgeKey) || (hoveredAlertEdge === edgeKey || hoveredAlertEdge?.key === edgeKey);
                const isSelected = isPinned || isHovered;
                const isDimmed = (effectiveActiveNodeId && !activeEdgeKeys.has(edgeKey)) || (pinnedEdgeKey && !isPinned);

                const x1 = fromNode.x + fromNode.width;
                const y1 = fromNode.y + (fromNode.height / 2);
                const x2 = toNode.x;
                const y2 = toNode.y + (toNode.height / 2);

                const path = getBezierPath(x1, y1, x2, y2);
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;

                return (
                  <g
                    key={`layered-edge-${edgeKey}`}
                    className={`route-svg-edge-group route-edge-${state} ${isSelected ? 'is-selected' : ''}`}
                    style={{ opacity: isDimmed ? 0.15 : 1, transition: 'opacity 0.25s' }}
                    onClick={(e) => { e.stopPropagation(); handleEdgeClick(edgeKey); }}
                    onMouseEnter={() => setHoveredEdge(edge)}
                    onMouseLeave={() => setHoveredEdge(null)}
                  >
                    <path d={path} fill="none" stroke="transparent" strokeWidth="20" style={{ cursor: 'pointer' }} />
                    <path className="route-edge-path" d={path} markerEnd={`url(#arrow-${state})`} />
                    <path className="route-edge-flow" d={path} />

                    {edge.latencyTask && (
                      <g transform={`translate(${midX}, ${midY})`} style={{ cursor: 'pointer' }}>
                        <rect
                          x="-28" y="-9" width="56" height="18" rx="9"
                          fill="rgba(15, 20, 30, 0.9)"
                          stroke={state === 'healthy' ? 'rgba(16, 185, 129, 0.5)' : state === 'warning' ? 'rgba(245, 158, 11, 0.5)' : state === 'critical' ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255, 255, 255, 0.15)'}
                          strokeWidth="1"
                        />
                        <text
                          x="0" y="4" textAnchor="middle"
                          fill={state === 'healthy' ? '#10b981' : state === 'warning' ? '#f59e0b' : state === 'critical' ? '#ef4444' : '#a1a1aa'}
                          style={{ fontSize: '10px', fontWeight: 600, fontFamily: 'monospace' }}
                        >
                          {getLatencyLabel(latency)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Layered Nodes */}
            <g className="route-svg-nodes">
              {layers.map((layer) => {
                const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];
                return nodes.map((nodeId) => {
                  const nodePos = layeredLayout.nodeMap.get(nodeId);
                  if (!nodePos) return null;

                  const isReal = isRealUuid(nodeId);
                  const stats = isReal ? data.agents[nodeId] : null;
                  const rawName = getNodeLabel(nodeId, stats, config);
                  const label = trimNodeLabel(rawName);
                  const flag = stats?.flag || config?.node_metadata?.[nodeId]?.flag || (isReal ? '🌐' : '⚡');
                  const isOnline = isReal ? stats?.status === 'online' : true;
                  const isActive = effectiveActiveNodeId === nodeId;
                  const isConnected = connectedNodeIds.has(nodeId);
                  const isDimmed = effectiveActiveNodeId && !isActive && !isConnected;
                  const cpu = stats?.cpu || 0;
                  const ram = stats?.ram_total ? Math.round((stats.ram_used / stats.ram_total) * 100) : 0;

                  return (
                    <g
                      key={`layered-node-${nodeId}`}
                      className={`route-svg-node ${isActive ? 'is-active' : ''}`}
                      transform={`translate(${nodePos.x}, ${nodePos.y})`}
                      style={{ cursor: 'pointer', opacity: isDimmed ? 0.25 : 1, transition: 'all 0.25s' }}
                      onClick={(e) => { e.stopPropagation(); handleNodeClick(nodeId); }}
                    >
                      <rect
                        x="0" y="0" width={nodePos.width} height={nodePos.height} rx="10"
                        fill={isActive ? 'rgba(20, 30, 50, 0.95)' : 'rgba(15, 20, 32, 0.85)'}
                        stroke={isActive ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.12)'}
                        strokeWidth={isActive ? 2 : 1}
                      />
                      <g transform="translate(10, 20)">
                        <text x="0" y="0" style={{ fontSize: '13px' }}>{flag}</text>
                        <circle cx="20" cy="-4" r="3" fill={isOnline ? '#10b981' : '#ef4444'} />
                        <text x="30" y="0" fill="#ffffff" style={{ fontSize: '11px', fontWeight: 600 }}>{label}</text>
                      </g>
                      {isReal && isOnline ? (
                        <g transform="translate(10, 42)">
                          <text x="0" y="0" fill="var(--text-secondary)" style={{ fontSize: '9px', fontFamily: 'monospace' }}>
                            CPU <tspan fill="#fff">{cpu}%</tspan> | RAM <tspan fill="#fff">{ram}%</tspan>
                          </text>
                        </g>
                      ) : isReal && !isOnline ? (
                        <g transform="translate(10, 42)">
                          <text x="0" y="0" fill="#ef4444" style={{ fontSize: '9px', fontWeight: 600 }}>节点离线</text>
                        </g>
                      ) : (
                        <g transform="translate(10, 42)">
                          <text x="0" y="0" fill="var(--text-muted)" style={{ fontSize: '9px' }}>目标服务</text>
                        </g>
                      )}
                    </g>
                  );
                });
              })}
            </g>
          </svg>
        )}

        {/* DESKTOP VIEW: Full 2D Map View with Spotlights & Hover Badges */}
        {!isMobile && mapLayout && (
          <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '520px' }}>
            <ComposableMap projection={mapProjection} width={mapLayout.width} height={mapLayout.height} style={{ width: '100%', height: '100%' }}>
              <ZoomableGroup zoom={1} maxZoom={5} translateExtent={[[0, 0], [mapLayout.width, mapLayout.height]]}>
                <Geographies geography={topoData}>
                  {({ geographies }) => geographies.map((geo) => {
                    const countryName = geo.properties.name;
                    const activeRegion = GEO_REGIONS.find(r => r.country === countryName && mapLayout.activeRegions.includes(r.id));
                    const isHighlighted = !!activeRegion;
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={isHighlighted ? activeRegion.color : 'rgba(255,255,255,0.06)'}
                        stroke={isHighlighted ? activeRegion.glow : 'rgba(255,255,255,0.18)'}
                        strokeWidth={isHighlighted ? 1.2 : 0.5}
                        style={{
                          default: { outline: 'none', filter: isHighlighted ? `drop-shadow(0 0 16px ${activeRegion.glow})` : 'none', opacity: isHighlighted ? 0.7 : 1 },
                          hover: { outline: 'none', fill: isHighlighted ? activeRegion.color : 'rgba(255,255,255,0.12)' },
                          pressed: { outline: 'none' }
                        }}
                        onMouseEnter={(e) => {
                          if (isHighlighted) {
                            const rect = e.currentTarget.closest('.route-matrix-shell').getBoundingClientRect();
                            setHoveredMapRegion({
                              x: e.clientX - rect.left,
                              y: e.clientY - rect.top - 40,
                              label: activeRegion.label || activeRegion.country,
                              nodes: mapLayout.regionNamesMap?.get(activeRegion.id) || []
                            });
                          }
                        }}
                        onMouseMove={(e) => {
                          if (isHighlighted && hoveredMapRegion) {
                            const rect = e.currentTarget.closest('.route-matrix-shell').getBoundingClientRect();
                            setHoveredMapRegion(prev => ({ ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top - 40 }));
                          }
                        }}
                        onMouseLeave={() => setHoveredMapRegion(null)}
                      />
                    );
                  })}
                </Geographies>

                <defs>
                  <marker id="arrow-healthy-map" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(16, 185, 129, 0.8)" /></marker>
                  <marker id="arrow-warning-map" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(245, 158, 11, 0.8)" /></marker>
                  <marker id="arrow-critical-map" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(239, 68, 68, 0.8)" /></marker>
                  <marker id="arrow-unknown-map" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(255, 255, 255, 0.3)" /></marker>
                </defs>

                {/* Glowing Map Regions */}
                <g className="route-geo-regions" style={{ pointerEvents: 'none' }}>
                  {GEO_REGIONS.map(region => {
                    if (region.color === 'transparent' || !mapLayout.activeRegions.includes(region.id)) return null;
                    return (
                      <ellipse 
                        key={`region-${region.id}`} 
                        cx={region.x + 18} 
                        cy={region.y + 24} 
                        rx="90" 
                        ry="60" 
                        fill={region.glow} 
                        style={{ filter: 'blur(40px)', opacity: 0.25 }} 
                      />
                    );
                  })}
                </g>

                {/* Map Edges */}
                <g className="route-svg-edges">
                  {visibleEdges.map((edge) => {
                    const fromNode = mapLayout.nodeMap.get(edge.from);
                    const toNode = mapLayout.nodeMap.get(edge.to);
                    if (!fromNode || !toNode) return null;

                    const edgeKey = `${edge.from}->${edge.to}`;
                    const latency = data.latencies?.[edgeKey];
                    const state = getLatencyState(latency);
                    const isPinned = pinnedEdgeKey === edgeKey;
                    
                    const isEdgeDirectHover = hoveredEdge && (hoveredEdge.key === edgeKey || `${hoveredEdge.from}->${hoveredEdge.to}` === edgeKey);
                    const isAlertHoverSpotlight = hoveredAlertEdge && (hoveredAlertEdge === edgeKey || hoveredAlertEdge?.key === edgeKey);
                    const isListHoverSpotlight = hoveredNodeId && (edge.from === hoveredNodeId || edge.to === hoveredNodeId);
                    const isNodeFocusSpotlight = activeNodeId && (edge.from === activeNodeId || edge.to === activeNodeId);
                    
                    const isSpotlight = isEdgeDirectHover || isAlertHoverSpotlight || isListHoverSpotlight || isNodeFocusSpotlight || isPinned;
                    const hasActiveFilter = !!(hoveredEdge || hoveredAlertEdge || hoveredNodeId || activeNodeId || pinnedEdgeKey);
                    const isDimmed = hasActiveFilter && !isSpotlight;

                    const x1 = fromNode.x + 18;
                    const y1 = fromNode.y + 16;
                    const x2 = toNode.x + 18;
                    const y2 = toNode.y + 16;
                    const path = getMapArcPath(x1, y1, x2, y2);

                    return (
                      <g
                        key={`map-edge-${edgeKey}`}
                        className={`route-edge route-edge-${state} ${isSpotlight ? 'is-spotlight' : ''}`}
                        style={{
                          opacity: isSpotlight ? 1 : (isDimmed ? 0.08 : 0.85),
                          filter: isAlertHoverSpotlight
                            ? 'drop-shadow(0 0 10px var(--critical))'
                            : (isEdgeDirectHover || isListHoverSpotlight
                              ? 'drop-shadow(0 0 10px var(--accent-cyan))'
                              : undefined),
                          transition: 'all 0.2s ease'
                        }}
                        onClick={(e) => { e.stopPropagation(); handleEdgeClick(edgeKey); }}
                        onMouseEnter={(event) => showEdgeTooltip(event, edge, edgeKey, latency, state)}
                        onMouseMove={(event) => showEdgeTooltip(event, edge, edgeKey, latency, state)}
                        onMouseLeave={() => setHoveredEdge(null)}
                      >
                        <path d={path} fill="none" stroke="transparent" strokeWidth="20" style={{ cursor: 'pointer' }} />
                        <path className="route-edge-path" d={path} markerEnd={`url(#arrow-${state}-map)`} />
                        <path className="route-edge-flow" d={path} />
                      </g>
                    );
                  })}
                </g>

                {/* Worst Latency Badges on Nodes */}
                <g className="route-node-worst-badges">
                  {Array.from(worstOutgoingByNode.entries()).map(([nodeId, worst]) => {
                    const rect = mapLayout.nodeMap.get(nodeId);
                    if (!rect) return null;
                    const value = worst.latency.ping === 'fail' ? 'FAIL' : `${worst.latency.ping}ms`;
                    const text = worst.routeCount > 1 ? `MAX ${value}` : value;
                    const width = Math.max(48, (text.length * 6) + 16);
                    const x = rect.x + 18 - (width / 2);
                    const y = rect.y + 50;
                    return (
                      <g
                        key={`worst-${nodeId}`}
                        className={`route-node-worst-badge ${worst.state} ${pinnedEdgeKey === worst.key ? 'is-pinned' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setPinnedEdgeKey(current => current === worst.key ? null : worst.key); }}
                      >
                        <rect x={x} y={y} width={width} height="18" rx="4" />
                        <text x={x + (width / 2)} y={y + 12}>{text}</text>
                      </g>
                    );
                  })}
                </g>

                {/* Map Nodes */}
                <g className="route-svg-nodes">
                  {layers.flatMap((layer, layerIndex) => {
                    const theme = LAYER_THEMES[layerIndex] || 'default';
                    const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];
                    return nodes.map((nodeId) => {
                      const rect = mapLayout.nodeMap.get(nodeId);
                      if (!rect) return null;

                      const stats = data.agents?.[nodeId];
                      const isReal = isRealUuid(nodeId);
                      const rawName = getNodeLabel(nodeId, stats, config);
                      const label = trimNodeLabel(rawName);
                      const isOnline = stats ? stats.status !== 'offline' : true;
                      
                      const isListHoverSpotlight = hoveredNodeId === nodeId;
                      const isAlertHoverSpotlight = hoveredAlertEdge && (
                        (typeof hoveredAlertEdge === 'string' && (hoveredAlertEdge.startsWith(`${nodeId}->`) || hoveredAlertEdge.endsWith(`->${nodeId}`))) ||
                        (hoveredAlertEdge?.key && (hoveredAlertEdge.key.startsWith(`${nodeId}->`) || hoveredAlertEdge.key.endsWith(`->${nodeId}`)))
                      );
                      const isEdgeHoverSpotlight = hoveredEdge && (hoveredEdge.from === nodeId || hoveredEdge.to === nodeId);
                      const isNodeActive = activeNodeId === nodeId;
                      const isConnectedToActiveNode = activeNodeId && activeEdges.some(e => e.from === nodeId || e.to === nodeId);
                      
                      const isNodeHighlighted = isListHoverSpotlight || isAlertHoverSpotlight || isEdgeHoverSpotlight || isNodeActive;
                      const hasActiveFilter = !!(hoveredNodeId || hoveredAlertEdge || hoveredEdge || activeNodeId);
                      const isNodeDimmed = hasActiveFilter && !isNodeHighlighted && !isConnectedToActiveNode;

                      return (
                        <g
                          key={`matrix-node-${nodeId}`}
                          className={`route-svg-node route-layer-${theme} ${isNodeActive ? 'is-active' : ''}`}
                          style={{
                            opacity: isNodeDimmed ? 0.2 : 1,
                            filter: isNodeHighlighted ? (isAlertHoverSpotlight ? 'drop-shadow(0 0 14px var(--critical))' : 'drop-shadow(0 0 14px var(--accent-cyan))') : 'none',
                            transform: isNodeHighlighted ? 'scale(1.15)' : 'scale(1)',
                            transformOrigin: `${rect.x + rect.width / 2}px ${rect.y + rect.height / 2}px`,
                            transition: 'all 0.2s ease',
                            cursor: 'pointer'
                          }}
                          onClick={(e) => { e.stopPropagation(); handleNodeClick(nodeId); }}
                        >
                          {!isReal ? (
                            <>
                              <rect className="route-svg-node-box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="8" fill="rgba(20,25,35,0.9)" stroke="rgba(255,255,255,0.2)" />
                              <g transform={`translate(${rect.x + 10}, ${rect.y + 8})`}>
                                <Cloud size={16} color="var(--accent-purple)" />
                              </g>
                            </>
                          ) : (
                            <>
                              {/* Server Rack Body */}
                              <rect className="route-svg-node-box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="4" />
                              
                              {/* Blades */}
                              <rect className="route-svg-node-blade" x={rect.x + 3} y={rect.y + 5} width={rect.width - 6} height="4" rx="1" fill="rgba(255,255,255,0.15)" />
                              <rect className="route-svg-node-blade" x={rect.x + 3} y={rect.y + 14} width={rect.width - 6} height="4" rx="1" fill="rgba(255,255,255,0.15)" />
                              <rect className="route-svg-node-blade" x={rect.x + 3} y={rect.y + 23} width={rect.width - 6} height="4" rx="1" fill="rgba(255,255,255,0.15)" />

                              {/* Active LEDs */}
                              <circle cx={rect.x + rect.width - 5} cy={rect.y + 7} r="1" fill="var(--healthy)" opacity={isOnline ? 0.9 : 0.2} />
                              <circle cx={rect.x + rect.width - 5} cy={rect.y + 16} r="1" fill="var(--healthy)" opacity={isOnline ? 0.9 : 0.2} />
                              <circle cx={rect.x + rect.width - 5} cy={rect.y + 25} r="1" fill="var(--healthy)" opacity={isOnline ? 0.9 : 0.2} />
                            </>
                          )}
                          
                          {/* Floating Label */}
                          <text className="route-svg-node-name" x={rect.x + rect.width / 2} y={rect.y - 10}>{label}</text>
                          
                          {/* Status Badge */}
                          {isReal && (
                            <g transform={`translate(${rect.x + rect.width - 4}, ${rect.y + rect.height - 4})`} className="route-svg-node-status-group">
                              <circle className={`route-svg-node-status ${isOnline ? 'online' : 'offline'}`} cx="0" cy="0" r="7" />
                              {isOnline ? (
                                <path d="M-2.5,0.5 L-1,2 L2.5,-1.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              ) : (
                                <path d="M-2,-2 L2,2 M-2,2 L2,-2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                              )}
                            </g>
                          )}
                        </g>
                      );
                    });
                  })}
                </g>
              </ZoomableGroup>
            </ComposableMap>
          </div>
        )}
      </div>

      {/* Hover Edge Tooltip on 2D Map */}
      {hoveredEdge?.x !== undefined && hoveredEdge.showTooltip && (
        <div className={`route-tooltip route-tooltip-${hoveredEdge.state}`} style={{ left: hoveredEdge.x, top: hoveredEdge.y }}>
          <span>{hoveredEdge.route}</span>
          <strong>{getLatencyLabel(hoveredEdge.latency)}</strong>
          <small>{hoveredEdge.latency?.ping === 'fail' ? '探测失败' : `丢包 ${hoveredEdge.latency?.loss || 0}%`}</small>
        </div>
      )}

      {/* Hover Map Region Tooltip on 2D Map */}
      {hoveredMapRegion && (
        <div className="route-tooltip route-tooltip-healthy" style={{ left: hoveredMapRegion.x, top: hoveredMapRegion.y, pointerEvents: 'none', zIndex: 100 }}>
          <span>{hoveredMapRegion.label} 在线节点</span>
          <strong>{hoveredMapRegion.nodes.length} 个</strong>
          <small style={{ display: 'block', maxWidth: '200px', whiteSpace: 'normal', wordBreak: 'break-all' }}>
            {hoveredMapRegion.nodes.join(', ').slice(0, 100)}{hoveredMapRegion.nodes.join(', ').length > 100 ? '...' : ''}
          </small>
        </div>
      )}

      {/* Focus & Edge Detail Bottom Bar */}
      {(selectedEdge || effectiveActiveNodeId) && (
        <div
          className="topology-focus-bar"
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 20, 32, 0.92)',
            border: '1px solid var(--border-light)',
            backdropFilter: 'blur(16px)',
            borderRadius: '16px',
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            zIndex: 40,
            maxWidth: '90%'
          }}
        >
          {selectedEdge ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#fff' }}>
                <span style={{ fontWeight: 600 }}>{getNodeLabel(selectedEdge.from, data.agents[selectedEdge.from], config)}</span>
                <ArrowRight size={14} color="var(--accent-cyan)" />
                <span style={{ fontWeight: 600 }}>{getNodeLabel(selectedEdge.to, data.agents[selectedEdge.to], config)}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                延迟: <strong style={{ color: getLatencyState(data.latencies?.[`${selectedEdge.from}->${selectedEdge.to}`]) === 'healthy' ? '#10b981' : '#f59e0b' }}>
                  {getLatencyLabel(data.latencies?.[`${selectedEdge.from}->${selectedEdge.to}`])}
                </strong>
              </div>
            </>
          ) : data.agents?.[effectiveActiveNodeId] ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#fff' }}>
                <span style={{ fontSize: '16px' }}>{data.agents[effectiveActiveNodeId].flag}</span>
                <span style={{ fontWeight: 600 }}>{data.agents[effectiveActiveNodeId].name}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                CPU: <strong>{data.agents[effectiveActiveNodeId].cpu}%</strong> | RAM: <strong>{data.agents[effectiveActiveNodeId].ram_used}MB</strong>
              </div>
            </>
          ) : (
            <div style={{ fontSize: '13px', color: '#fff', fontWeight: 600 }}>
              {getNodeLabel(effectiveActiveNodeId, null, config)}
            </div>
          )}

          <button
            onClick={clearNodeFocus}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: '4px' }}
            title="关闭 (ESC)"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Portal for Bottom-Right Issue Tray */}
      {(() => {
        if (!portalTarget || activeNodeId || issueEdges.length === 0) return null;
        
        return createPortal(
          <div className="glass-panel" style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '260px', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning)', fontWeight: 600 }}>
                异常线路 ({issueEdges.length})
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>悬停聚焦</span>
            </div>
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
              {issueEdges.map((edge) => {
                const key = `${edge.from}->${edge.to}`;
                const latency = data.latencies?.[key];
                const state = getLatencyState(latency);
                const isPinned = pinnedEdgeKey === key;
                const isCritical = state === 'critical';
                
                return (
                  <div
                    key={key}
                    className={`issue-route-item ${isPinned ? 'is-pinned' : ''}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: isCritical ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                      borderLeft: `2px solid ${isCritical ? 'var(--critical)' : 'var(--warning)'}`,
                      borderRadius: '0 8px 8px 0',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      border: isPinned ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                      boxShadow: isCritical ? 'inset 0 0 12px rgba(239, 68, 68, 0.02)' : 'none'
                    }}
                    onMouseEnter={() => setHoveredEdge({ key, state })}
                    onMouseLeave={() => setHoveredEdge(null)}
                    onClick={() => setPinnedEdgeKey((current) => current === key ? null : key)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', minWidth: 0 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: isCritical ? 'var(--critical)' : 'var(--warning)', flexShrink: 0 }} />
                      <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {getNodeLabel(edge.from, data.agents[edge.from], config)} ➔ {getNodeLabel(edge.to, data.agents[edge.to], config)}
                      </span>
                    </div>
                    <strong style={{ color: isCritical ? 'var(--critical)' : 'var(--warning)', fontSize: '11px', fontFamily: 'monospace', flexShrink: 0, marginLeft: '8px' }}>
                      {getLatencyLabel(latency)}
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>,
          portalTarget
        );
      })()}
    </div>
  );
};

export default SegmentTopology;
