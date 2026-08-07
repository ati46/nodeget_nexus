import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Globe2, Server, X, User, Cloud } from 'lucide-react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { geoEquirectangular } from 'd3-geo';
import topoData from '../assets/features.json';

const VIRTUAL_NODE_LABELS = {
  client: 'Client',
  internet: 'Internet'
};

const LAYER_THEMES = [
  'access',
  'transit',
  'landing',
  'target'
];

const EMPTY_EDGES = [];

const VIEWPORT = {
  paddingX: 30,
  paddingTop: 78,
  paddingBottom: 58,
  defaultLayerGap: 300,
  layerGaps: [280, 460, 280],
  nodeWidth: 112,
  nodeHeight: 46,
  nodeGap: 58
};

const getLayerX = (layerIndex) => (
  VIEWPORT.paddingX +
  Array.from(
    { length: layerIndex },
    (_, gapIndex) => VIEWPORT.layerGaps[gapIndex] || VIEWPORT.defaultLayerGap
  ).reduce((total, gap) => total + gap, 0)
);

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
  return label.length > 9 ? `${label.slice(0, 8)}...` : label;
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

const getLinePath = (x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx*dx + dy*dy);
  
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  
  // Create a realistic flight-path arc (bows upward on the map)
  const arcHeight = distance * 0.25;
  
  return `M ${x1} ${y1} Q ${midX} ${midY - arcHeight}, ${x2} ${y2}`;
};

const mapWidth = 1600;
const mapHeight = 700;
const mapProjection = geoEquirectangular()
  .scale(250)
  .translate([mapWidth / 2, mapHeight / 2 + 140]);

const RAW_GEO_REGIONS = [
  { id: 'unknown', regex: /.*/, lon: 0, lat: 0, color: 'rgba(255, 255, 255, 0.15)', country: 'Unknown', label: 'Unknown Location', glow: 'rgba(255, 255, 255, 0.5)' }
];

// GEO_REGIONS moved inside component to support dynamic config override

const SegmentTopology = ({ data, onNodeDetail, config, hoveredNodeId, hoveredAlertEdge }) => {
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

  const [activeNodeId, setActiveNodeId] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
  const [hoveredMapRegion, setHoveredMapRegion] = useState(null);
  const [pinnedEdgeKey, setPinnedEdgeKey] = useState(null);

  useEffect(() => {
    if (!activeNodeId && !pinnedEdgeKey) return undefined;
    const clearFocus = (event) => {
      if (event.key === 'Escape') {
        // [CAUTION] Local UI state mutation triggered by a global keyboard listener.
        setActiveNodeId(null);
        setHoveredEdge(null);
        setPinnedEdgeKey(null);
      }
    };
    window.addEventListener('keydown', clearFocus);
    return () => window.removeEventListener('keydown', clearFocus);
  }, [activeNodeId, pinnedEdgeKey]);

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

  const layout = useMemo(() => {
    if (!layers) return null;

    const width = 1600;
    const height = 700;
    const nodeMap = new Map();
    const regionNodes = new Map();
    const activeRegions = new Set();
    const explicitlyMappedNodes = new Set();

    layers.forEach((layer, layerIndex) => {
      const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];
      nodes.forEach((nodeId) => {
        explicitlyMappedNodes.add(nodeId);
        const name = data.agents?.[nodeId]?.name || nodeId;
        let matchedRegion = null;
        
        for (const region of GEO_REGIONS) {
          if (region.regex.test(name) || region.regex.test(nodeId)) {
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

    const regionNamesMap = new Map();
    if (data.agents) {
      Object.keys(data.agents).forEach(nodeId => {
        const name = data.agents[nodeId].name || config?.node_metadata?.[nodeId]?.name || nodeId;
        const flag = data.agents[nodeId].flag || config?.node_metadata?.[nodeId]?.flag || '';
        let matchedRegion = null;
        for (const region of GEO_REGIONS) {
          if (region.regex.test(name) || region.regex.test(nodeId) || region.regex.test(flag)) {
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

    regionNodes.forEach((cluster, regionId) => {
      const { x: centerX, y: centerY } = cluster[0].region;
      
      const nodeWidth = 22;
      const nodeHeight = 32;
      
      // Auto-spread horizontally, sorted by route order (layerIndex)
      // Since data flows Right-to-Left, highest layer index (closest to target) is on the left
      cluster.sort((a, b) => b.layerIndex - a.layerIndex);
      
      const gapX = 28; // Horizontal spacing
      
      const totalWidth = cluster.length * nodeWidth + (cluster.length - 1) * gapX;
      
      let startX = centerX - (totalWidth / 2) + (nodeWidth / 2);
      
      // Visual Coastal Offset: push large clusters inland so they don't fall into the ocean
      if (regionId === 'us-west') startX += 50; // Push LA inland (right)
      if (regionId === 'us-east') startX -= 40; // Push NY inland (left)
      
      const startY = centerY - 10; // Shift entire cluster slightly up

      cluster.forEach((item, index) => {
        // Stagger alternate nodes DOWNWARDS (+Y) so they perfectly duck under the upward-arcing lines
        const staggerY = cluster.length > 1 ? (index % 2 !== 0 ? 32 : 0) : 0;

        
        nodeMap.set(item.nodeId, {
          id: item.nodeId,
          regionId: regionId,
          layerIndex: item.layerIndex,
          x: startX + index * (nodeWidth + gapX) - (nodeWidth / 2),
          y: startY + staggerY - (nodeHeight / 2),
          width: nodeWidth, height: nodeHeight
        });
      });
    });

    return { width, height, nodeMap, activeRegions: Array.from(activeRegions), regionNamesMap };
  }, [layers, data.agents]);

  if (!data || !data.agents) {
    return <div className="topology-empty">Loading dashboard data...</div>;
  }

  if (!layers || visibleEdges.length === 0 || !layout) {
    return <div className="topology-empty">Topology config requires topology.layers and edges.</div>;
  }

  const activeEdges = activeNodeId
    ? visibleEdges.filter((edge) => edge.from === activeNodeId || edge.to === activeNodeId)
    : visibleEdges;
  const activeEdgeKeys = new Set(activeEdges.map((edge) => `${edge.from}->${edge.to}`));
  const activeStats = activeNodeId ? data.agents[activeNodeId] : null;
  const activeLabel = activeNodeId ? getNodeLabel(activeNodeId, activeStats) : '';
  const activeLatencies = activeNodeId
    ? activeEdges
      .map((edge) => data.latencies?.[`${edge.from}->${edge.to}`])
      .filter((latency) => latency && typeof latency.ping === 'number')
    : [];
  const averageLatency = activeLatencies.length
    ? Math.round(activeLatencies.reduce((sum, latency) => sum + latency.ping, 0) / activeLatencies.length)
    : 0;
  const issueCount = activeNodeId
    ? activeEdges.filter((edge) => {
      const state = getLatencyState(data.latencies?.[`${edge.from}->${edge.to}`]);
      return state === 'warning' || state === 'critical';
    }).length
    : 0;

  const spotlightEdgeKey = hoveredEdge?.key || pinnedEdgeKey;
  const spotlightEdge = spotlightEdgeKey
    ? visibleEdges.find((edge) => `${edge.from}->${edge.to}` === spotlightEdgeKey)
    : null;
  const issueSlots = new Map();
  const issueGroups = new Map();
  const issueEdges = visibleEdges.filter((edge) => {
    const state = getLatencyState(data.latencies?.[`${edge.from}->${edge.to}`]);
    return state === 'warning' || state === 'critical';
  });
  const denseIssueMode = issueEdges.length >= 3;
  const outgoingByNode = new Map();
  visibleEdges.forEach((edge) => {
    const key = `${edge.from}->${edge.to}`;
    const measuredLatency = data.latencies?.[key];
    const hasMeasurement = measuredLatency && (typeof measuredLatency.ping === 'number' || measuredLatency.ping === 'fail');
    const latency = hasMeasurement ? measuredLatency : { ping: 0, loss: 0 };
    const group = outgoingByNode.get(edge.from) || [];
    group.push({ edge, key, latency, state: hasMeasurement ? getLatencyState(latency) : 'unknown' });
    outgoingByNode.set(edge.from, group);
  });
  const worstOutgoingByNode = new Map();
  outgoingByNode.forEach((routes, nodeId) => {
    const worst = [...routes].sort((a, b) => {
      const aScore = a.latency.ping === 'fail' ? Number.MAX_SAFE_INTEGER : a.latency.ping;
      const bScore = b.latency.ping === 'fail' ? Number.MAX_SAFE_INTEGER : b.latency.ping;
      return bScore - aScore || (b.latency.loss || 0) - (a.latency.loss || 0);
    })[0];
    worstOutgoingByNode.set(nodeId, { ...worst, routeCount: routes.length });
  });
  visibleEdges.forEach((edge) => {
    const key = `${edge.from}->${edge.to}`;
    const state = getLatencyState(data.latencies?.[key]);
    if (state !== 'warning' && state !== 'critical') return;
    const from = layout.nodeMap.get(edge.from);
    const to = layout.nodeMap.get(edge.to);
    if (!from || !to) return;
    const midpointX = (from.x + from.width + to.x) / 2;
    const midpointY = (from.y + from.height / 2 + to.y + to.height / 2) / 2;
    const collisionBucket = `${Math.round(midpointX / 90)}:${Math.round(midpointY / 28)}`;
    const group = issueGroups.get(collisionBucket) || [];
    group.push(key);
    issueGroups.set(collisionBucket, group);
  });
  issueGroups.forEach((keys) => keys.forEach((key, index) => issueSlots.set(key, { index, count: keys.length })));
  const handleNodeClick = (nodeId) => {
    // [CAUTION] Local UI state mutation only; keep selection idempotent across polling refreshes.
    setActiveNodeId((current) => current === nodeId ? null : nodeId);
    setHoveredEdge(null);
    setPinnedEdgeKey(null);
  };

  const handleNodeKeyDown = (event, nodeId) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleNodeClick(nodeId);
  };

  const showEdgeTooltip = (event, edge, key, latency, state) => {
    const shell = event.currentTarget.closest('.route-matrix-shell').getBoundingClientRect();
    // [CAUTION] Local pointer state only; tooltip position is clamped inside the topology panel.
    setHoveredEdge({
      key,
      x: Math.min(event.clientX - shell.left + 14, shell.width - 220),
      y: event.clientY - shell.top + 14,
      route: `${getNodeLabel(edge.from, data.agents[edge.from], config)} → ${getNodeLabel(edge.to, data.agents[edge.to], config)}`,
      latency,
      state,
      showTooltip: denseIssueMode || state === 'healthy' || state === 'unknown'
    });
  };

  const clearNodeFocus = () => {
    // [CAUTION] Local visual selection only; monitoring data is not mutated.
    setActiveNodeId(null);
    setHoveredEdge(null);
    setPinnedEdgeKey(null);
  };
  return (
    <div className="route-matrix-shell">
      <div 
        className="route-matrix-scroll custom-scrollbar"
        style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
      >
        
        {/* Vector Background Map */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.7 }}>
          <ComposableMap 
            projection={mapProjection} 
            width={layout.width} 
            height={layout.height} 
            style={{ width: '100%', height: '100%' }}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
          >
            <ZoomableGroup zoom={1} maxZoom={5} translateExtent={[[0, 0], [layout.width, layout.height]]}>
              <Geographies geography={topoData}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const countryName = geo.properties.name;
                  const activeRegion = GEO_REGIONS.find(r => r.country === countryName && layout.activeRegions.includes(r.id));
                  const isHighlighted = !!activeRegion;
                  
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={isHighlighted ? activeRegion.color : 'rgba(255,255,255,0.08)'}
                      stroke={isHighlighted ? activeRegion.glow : 'rgba(255,255,255,0.25)'}
                      strokeWidth={isHighlighted ? 1.5 : 0.5}
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
                            nodes: layout.regionNamesMap.get(activeRegion.id) || []
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
                })
              }
            </Geographies>
          <defs>
            <marker id="arrow-healthy" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(16, 185, 129, 0.8)" />
            </marker>
            <marker id="arrow-warning" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(245, 158, 11, 0.8)" />
            </marker>
            <marker id="arrow-critical" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(239, 68, 68, 0.8)" />
            </marker>
            <marker id="arrow-unknown" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(255, 255, 255, 0.3)" />
            </marker>
          </defs>

          {/* Glowing Map Regions */}
          <g className="route-geo-regions" style={{ pointerEvents: 'none' }}>
            {GEO_REGIONS.map(region => {
              if (region.color === 'transparent') return null;
              if (!layout.activeRegions.includes(region.id)) return null;
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

          {/* Route Edges */}
          <g className="route-svg-edges">
            {visibleEdges.map((edge, edgeIndex) => {
              const from = layout.nodeMap.get(edge.from);
              const to = layout.nodeMap.get(edge.to);
              if (!from || !to) return null;

              const key = `${edge.from}->${edge.to}`;
              const latency = data.latencies ? data.latencies[key] : null;
              const state = getLatencyState(latency);
              const isFocusDimmed = activeNodeId && !activeEdgeKeys.has(key);
              const isHoverDimmed = spotlightEdgeKey && spotlightEdgeKey !== key;
              const isSpotlight = spotlightEdgeKey === key;
              
              // Map List Hover Logic
              const isListHoverDimmed = hoveredNodeId && (edge.from !== hoveredNodeId && edge.to !== hoveredNodeId);
              const isListHoverSpotlight = hoveredNodeId && (edge.from === hoveredNodeId || edge.to === hoveredNodeId);
              
              // Alert List Hover Logic
              const isAlertHoverDimmed = hoveredAlertEdge && hoveredAlertEdge.key !== key;
              const isAlertHoverSpotlight = hoveredAlertEdge && hoveredAlertEdge.key === key;
              
              const isDimmed = isFocusDimmed || isHoverDimmed || isListHoverDimmed || isAlertHoverDimmed;
              const isHighlighted = isSpotlight || isListHoverSpotlight || isAlertHoverSpotlight;
              
              const isRightToLeft = from.x > to.x;
              const x1 = isRightToLeft ? from.x : from.x + from.width;
              const y1 = from.y + (from.height / 2);
              const x2 = isRightToLeft ? to.x + to.width : to.x;
              const y2 = to.y + (to.height / 2);
              const label = getLatencyLabel(latency);
              const labelWidth = Math.max(44, (label.length * 7) + 16);
              const issueSlot = issueSlots.get(key);
              const labelX = ((x1 + x2) / 2) - (labelWidth / 2);
              const labelY = ((y1 + y2) / 2) - 10 + (issueSlot ? (issueSlot.index - ((issueSlot.count - 1) / 2)) * 16 : 0);
              const showPersistentLabel = label && !activeNodeId && !denseIssueMode && (state === 'warning' || state === 'critical');
              const path = getLinePath(x1, y1, x2, y2);

              return (
                <g key={`${key}-${edgeIndex}`} className={`route-edge route-edge-${state} ${isDimmed && !isListHoverDimmed && !isAlertHoverDimmed ? 'is-focus-dimmed' : ''} ${isHoverDimmed ? 'is-hover-dimmed' : ''} ${isSpotlight ? 'is-spotlight' : ''}`} style={{ opacity: isDimmed ? 0.1 : (isHighlighted ? 1 : undefined), transition: 'opacity 0.2s ease', strokeWidth: isAlertHoverSpotlight ? '2px' : undefined, filter: isAlertHoverSpotlight ? 'drop-shadow(0 0 6px var(--critical))' : undefined }}>
                  <path className="route-edge-path" d={path} markerEnd={`url(#arrow-${state})`} />
                  <path className="route-edge-flow" d={path} />
                  <path
                    className="route-edge-hit"
                    d={path}
                    onMouseMove={(event) => showEdgeTooltip(event, edge, key, latency, state)}
                    onMouseLeave={() => setHoveredEdge(null)}
                    onFocus={() => setHoveredEdge({ key })}
                    onBlur={() => setHoveredEdge(null)}
                    tabIndex="0"
                    role="button"
                    aria-label={`${getNodeLabel(edge.from, data.agents[edge.from], config)} 到 ${getNodeLabel(edge.to, data.agents[edge.to], config)}，${label || '无延迟数据'}`}
                  />
                  {showPersistentLabel && (
                    <g className="route-edge-label" transform={`translate(${labelX} ${labelY})`}>
                      <rect width={labelWidth} height="20" rx="5" />
                      <text x={labelWidth / 2} y="14">{label}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          <g className="route-node-worst-badges">
            {Array.from(worstOutgoingByNode.entries()).map(([nodeId, worst]) => {
              const rect = layout.nodeMap.get(nodeId);
              if (!rect) return null;
              const value = worst.latency.ping === 'fail' ? 'FAIL' : `${worst.latency.ping}ms`;
              const text = worst.routeCount > 1 ? `MAX ${value}` : value;
              const width = Math.max(48, (text.length * 6) + 16);
              const x = rect.x + 18 - (width / 2);
              const y = rect.y + 60;
              return (
                <g
                  key={`worst-${nodeId}`}
                  className={`route-node-worst-badge ${worst.state} ${pinnedEdgeKey === worst.key ? 'is-pinned' : ''}`}
                  role="button"
                  tabIndex="0"
                  aria-label={`${getNodeLabel(nodeId, data.agents[nodeId], config)} 最差下游 ${text}`}
                  aria-pressed={pinnedEdgeKey === worst.key}
                  onMouseMove={(event) => showEdgeTooltip(event, worst.edge, worst.key, worst.latency, worst.state)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onFocus={() => setHoveredEdge({ key: worst.key })}
                  onBlur={() => setHoveredEdge(null)}
                  onClick={() => setPinnedEdgeKey((current) => current === worst.key ? null : worst.key)}
                >
                  <rect x={x} y={y} width={width} height="18" rx="4" />
                  <text x={x + (width / 2)} y={y + 12}>{text}</text>
                </g>
              );
            })}
          </g>
          <g className="route-svg-nodes">
            {layers.flatMap((layer, layerIndex) => {
              const theme = LAYER_THEMES[layerIndex] || 'default';
              const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];

              return nodes.map((nodeId) => {
                const rect = layout.nodeMap.get(nodeId);
                if (!rect) return null;
                const stats = data.agents[nodeId];
                const label = getNodeLabel(nodeId, stats);
                const isUuid = isRealUuid(nodeId);
                const isVirtual = !isUuid || rect.regionId === 'entry' || rect.regionId === 'target';
                const isOnline = stats && stats.status !== 'offline';
                const isActive = activeNodeId === nodeId;
                const isEdgeEndpoint = spotlightEdge && (spotlightEdge.from === nodeId || spotlightEdge.to === nodeId);
                const isInactive = activeNodeId && activeNodeId !== nodeId && !activeEdges.some((edge) => edge.from === nodeId || edge.to === nodeId);
                
                // Map List Hover Logic
                const isListHoverDimmed = hoveredNodeId && hoveredNodeId !== nodeId && !visibleEdges.some(e => (e.from === hoveredNodeId && e.to === nodeId) || (e.to === hoveredNodeId && e.from === nodeId));
                const isListHoverSpotlight = hoveredNodeId === nodeId;
                
                // Alert List Hover Logic
                const isAlertHoverDimmed = hoveredAlertEdge && !visibleEdges.some(e => hoveredAlertEdge.key === `${e.from}->${e.to}` && (e.from === nodeId || e.to === nodeId));
                const isAlertHoverSpotlight = hoveredAlertEdge && visibleEdges.some(e => hoveredAlertEdge.key === `${e.from}->${e.to}` && (e.from === nodeId || e.to === nodeId));
                
                const isNodeDimmed = isListHoverDimmed || isAlertHoverDimmed;
                const isNodeHighlighted = isListHoverSpotlight || isAlertHoverSpotlight;
                const iconX = rect.x + 13;
                const iconY = rect.y + ((rect.height - 15) / 2);
                const textX = rect.x + (rect.width / 2) + 8;
                const textY = rect.y + (rect.height / 2) + 1;
                const statusX = rect.x + rect.width - 13;
                const statusY = rect.y + (rect.height / 2);

                return (
                  <g
                    key={`matrix-node-${nodeId}`}
                    className={`route-svg-node route-layer-${theme} ${isActive ? 'is-active' : ''} ${isInactive ? 'is-inactive' : ''} ${isEdgeEndpoint ? 'is-edge-endpoint' : ''} ${isVirtual ? 'is-virtual' : ''}`}
                    style={{ opacity: isNodeDimmed ? 0.2 : 1, filter: isNodeHighlighted ? (isAlertHoverSpotlight ? 'drop-shadow(0 0 12px var(--critical))' : 'drop-shadow(0 0 12px var(--accent-cyan))') : 'none', transform: isNodeHighlighted ? 'scale(1.1)' : 'scale(1)', transformOrigin: `${rect.x + rect.width / 2}px ${rect.y + rect.height / 2}px`, transition: 'all 0.2s ease' }}
                    role="button"
                    tabIndex="0"
                    aria-label={label}
                    aria-pressed={isActive}
                    onClick={() => handleNodeClick(nodeId)}
                    onKeyDown={(event) => handleNodeKeyDown(event, nodeId)}
                  >
                    {isVirtual ? (
                      <>
                        <circle className="route-svg-node-box" cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} r="14" />
                        {rect.regionId === 'entry' ? (
                          <User className="route-svg-node-icon" x={rect.x + rect.width / 2 - 8} y={rect.y + rect.height / 2 - 8} size={16} />
                        ) : rect.regionId === 'target' ? (
                          <Cloud className="route-svg-node-icon" x={rect.x + rect.width / 2 - 8} y={rect.y + rect.height / 2 - 8} size={16} />
                        ) : (
                          <Globe2 className="route-svg-node-icon" x={rect.x + rect.width / 2 - 8} y={rect.y + rect.height / 2 - 8} size={16} />
                        )}
                      </>
                    ) : (
                      <>
                        {/* Server Rack Body */}
                        <rect className="route-svg-node-box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="3" />
                        
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
                    <text className="route-svg-node-name" x={rect.x + rect.width / 2} y={rect.y - 12}>{trimNodeLabel(label)}</text>
                    
                    {/* Status Badge */}
                    {isUuid && (
                      <g transform={`translate(${rect.x + rect.width - 4}, ${rect.y + rect.height - 4})`} className="route-svg-node-status-group">
                        <circle className={`route-svg-node-status ${isOnline ? 'online' : 'offline'}`} cx="0" cy="0" r="8" />
                        {isOnline ? (
                          <path d="M-3,0.5 L-1,2.5 L3,-1.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <path d="M-2.5,-2.5 L2.5,2.5 M-2.5,2.5 L2.5,-2.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
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
      </div>
      {hoveredEdge?.x !== undefined && hoveredEdge.showTooltip && (
        <div className={`route-tooltip route-tooltip-${hoveredEdge.state}`} style={{ left: hoveredEdge.x, top: hoveredEdge.y }}>
          <span>{hoveredEdge.route}</span>
          <strong>{getLatencyLabel(hoveredEdge.latency)}</strong>
          <small>{hoveredEdge.latency?.ping === 'fail' ? '探测失败' : `丢包 ${hoveredEdge.latency?.loss || 0}%`}</small>
        </div>
      )}
      {hoveredMapRegion && (
        <div className="route-tooltip route-tooltip-healthy" style={{ left: hoveredMapRegion.x, top: hoveredMapRegion.y, pointerEvents: 'none', zIndex: 100 }}>
          <span>{hoveredMapRegion.label} 在线节点</span>
          <strong>{hoveredMapRegion.nodes.length} 个</strong>
          <small style={{ display: 'block', maxWidth: '200px', whiteSpace: 'normal', wordBreak: 'break-all' }}>
            {hoveredMapRegion.nodes.join(', ').slice(0, 100)}{hoveredMapRegion.nodes.join(', ').length > 100 ? '...' : ''}
          </small>
        </div>
      )}
      {(() => {
        const portalTarget = document.getElementById('issue-tray-portal');
        if (!portalTarget || activeNodeId || !denseIssueMode) return null;
        
        return createPortal(
          <section className="route-issue-tray glass-panel" aria-label="异常线路" style={{ position: 'relative', bottom: 'auto', left: 'auto', right: 'auto', width: '100%', margin: '0', background: 'rgba(255,255,255,0.02)' }}>
            <header>
              <div><span>异常线路</span><small>悬停查看路径</small></div>
              <b>{issueEdges.length}</b>
            </header>
            <div className="route-issue-grid custom-scrollbar" style={{ gridTemplateColumns: '1fr', maxHeight: '250px', overflowY: 'auto' }}>
              {issueEdges.map((edge) => {
                const key = `${edge.from}->${edge.to}`;
                const latency = data.latencies?.[key];
                const state = getLatencyState(latency);
                return (
                  <button
                    type="button"
                    key={key}
                    className={`focus-route-item issue-route-item ${state} ${pinnedEdgeKey === key ? 'is-pinned' : ''}`}
                    onMouseEnter={() => setHoveredEdge({ key })}
                    onMouseLeave={() => setHoveredEdge(null)}
                    onFocus={() => setHoveredEdge({ key })}
                    onBlur={() => setHoveredEdge(null)}
                    onClick={() => setPinnedEdgeKey((current) => current === key ? null : key)}
                    aria-pressed={pinnedEdgeKey === key}
                  >
                    <i aria-hidden="true" />
                    <span>{getNodeLabel(edge.from, data.agents[edge.from], config)} → {getNodeLabel(edge.to, data.agents[edge.to], config)}</span>
                    <strong>{getLatencyLabel(latency)}</strong>
                  </button>
                );
              })}
            </div>
          </section>,
          portalTarget
        );
      })()}
      {activeNodeId && (
        <div className="topology-focus-bar" aria-live="polite">
          <div className="focus-identity">
            <span className="focus-pulse" aria-hidden="true" />
            <div>
              <span>聚焦节点</span>
              <strong>{activeLabel}</strong>
            </div>
          </div>
          <div className="focus-metrics">
            <span><b>{activeEdges.length}</b> 条关联线路</span>
            <span><b>{averageLatency === null ? '--' : `${averageLatency} ms`}</b> 平均延迟</span>
            <span className={issueCount ? 'has-issue' : ''}><b>{issueCount}</b> 条异常</span>
          </div>
          <div className="focus-actions">
            {activeStats ? (
              <button type="button" className="focus-detail-button" onClick={() => onNodeDetail?.(activeStats)}>
                查看节点详情
                <ArrowRight size={15} />
              </button>
            ) : (
              <span className="focus-virtual-note">虚拟入口节点</span>
            )}
            <button type="button" className="focus-clear-button" onClick={clearNodeFocus} aria-label="取消节点聚焦">
              <X size={16} />
            </button>
          </div>
          <div className="focus-route-list" role="list" aria-label={`${activeLabel} 的关联线路`}>
            {activeEdges.map((edge) => {
              const key = `${edge.from}->${edge.to}`;
              const latency = data.latencies?.[key];
              const state = getLatencyState(latency);
              const label = getLatencyLabel(latency);
              return (
                <button
                  type="button"
                  role="listitem"
                  key={key}
                  className={`focus-route-item ${state} ${pinnedEdgeKey === key ? 'is-pinned' : ''}`}
                  onMouseEnter={() => setHoveredEdge({ key })}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onFocus={() => setHoveredEdge({ key })}
                  onBlur={() => setHoveredEdge(null)}
                  onClick={() => setPinnedEdgeKey((current) => current === key ? null : key)}
                  aria-pressed={pinnedEdgeKey === key}
                >
                  <i aria-hidden="true" />
                  <span>{getNodeLabel(edge.from, data.agents[edge.from], config)} → {getNodeLabel(edge.to, data.agents[edge.to], config)}</span>
                  <strong>{label || '无拨测'}</strong>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SegmentTopology;
