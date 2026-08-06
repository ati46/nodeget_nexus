import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Globe2, Server, X } from 'lucide-react';

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

const getNodeLabel = (nodeId, stats) => {
  if (stats && stats.name) return stats.name;
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
  const distance = Math.max(32, x2 - x1);
  const curve = Math.min(76, distance * 0.44);
  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
};

const SegmentTopology = ({ data, onNodeDetail }) => {
  const [activeNodeId, setActiveNodeId] = useState(null);
  const [hoveredEdge, setHoveredEdge] = useState(null);
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

    const maxNodes = layers.reduce((max, layer) => Math.max(max, Array.isArray(layer.nodes) ? layer.nodes.length : 0), 0);
    const layerSpan = Array.from(
      { length: Math.max(0, layers.length - 1) },
      (_, gapIndex) => VIEWPORT.layerGaps[gapIndex] || VIEWPORT.defaultLayerGap
    ).reduce((total, gap) => total + gap, 0);
    const width = (VIEWPORT.paddingX * 2) + layerSpan + VIEWPORT.nodeWidth;
    const height = VIEWPORT.paddingTop + VIEWPORT.paddingBottom + (maxNodes * VIEWPORT.nodeHeight) + (Math.max(0, maxNodes - 1) * VIEWPORT.nodeGap);
    const nodeMap = new Map();

    layers.forEach((layer, layerIndex) => {
      const nodes = Array.isArray(layer.nodes) ? layer.nodes : [];
      const columnHeight = (nodes.length * VIEWPORT.nodeHeight) + (Math.max(0, nodes.length - 1) * VIEWPORT.nodeGap);
      const firstY = VIEWPORT.paddingTop + ((height - VIEWPORT.paddingTop - VIEWPORT.paddingBottom - columnHeight) / 2);
      const x = getLayerX(layerIndex);

      nodes.forEach((nodeId, nodeIndex) => {
        nodeMap.set(nodeId, {
          id: nodeId,
          layerIndex,
          x,
          y: firstY + (nodeIndex * (VIEWPORT.nodeHeight + VIEWPORT.nodeGap)),
          width: VIEWPORT.nodeWidth,
          height: VIEWPORT.nodeHeight
        });
      });
    });

    return { width, height, nodeMap };
  }, [layers]);

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
      route: `${getNodeLabel(edge.from, data.agents[edge.from])} → ${getNodeLabel(edge.to, data.agents[edge.to])}`,
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
      <div className="route-matrix-scroll custom-scrollbar">
        <svg
          className="route-matrix-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          role="img"
          aria-label="Routing topology"
        >
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
          </defs>
          {layers.map((layer, layerIndex) => {
            const theme = LAYER_THEMES[layerIndex] || 'default';
            const labelX = getLayerX(layerIndex);

            return (
              <g key={`matrix-layer-${layerIndex}`} className={`route-svg-layer route-layer-${theme}`}>
                <line className="route-svg-layer-rail" x1={labelX - 18} y1="0" x2={labelX - 18} y2={layout.height} />
                <text className="route-svg-layer-label" x={labelX + (VIEWPORT.nodeWidth / 2)} y="34">
                  {layer.name || `Layer ${layerIndex + 1}`}
                </text>
                <line className="route-svg-layer-rule" x1={labelX + 18} y1="44" x2={labelX + VIEWPORT.nodeWidth - 18} y2="44" />
              </g>
            );
          })}

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
              const x1 = from.x + from.width;
              const y1 = from.y + (from.height / 2);
              const x2 = to.x;
              const y2 = to.y + (to.height / 2);
              const label = getLatencyLabel(latency);
              const labelWidth = Math.max(44, (label.length * 7) + 16);
              const issueSlot = issueSlots.get(key);
              const labelX = ((x1 + x2 - 8) / 2) - (labelWidth / 2);
              const labelY = ((y1 + y2) / 2) - 10 + (issueSlot ? (issueSlot.index - ((issueSlot.count - 1) / 2)) * 16 : 0);
              const showPersistentLabel = label && !activeNodeId && !denseIssueMode && (state === 'warning' || state === 'critical');
              const path = getLinePath(x1, y1, x2 - 8, y2);

              return (
                <g key={`${key}-${edgeIndex}`} className={`route-edge route-edge-${state} ${isFocusDimmed ? 'is-focus-dimmed' : ''} ${isHoverDimmed ? 'is-hover-dimmed' : ''} ${isSpotlight ? 'is-spotlight' : ''}`}>
                  <path className="route-edge-path" d={path} />
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
                    aria-label={`${getNodeLabel(edge.from, data.agents[edge.from])} 到 ${getNodeLabel(edge.to, data.agents[edge.to])}，${label || '无延迟数据'}`}
                  />
                  <polygon className="route-edge-arrow" points={`${x2 - 8},${y2 - 4} ${x2},${y2} ${x2 - 8},${y2 + 4}`} />
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
              const x = rect.x + ((rect.width - width) / 2);
              const y = rect.y - 25;
              return (
                <g
                  key={`worst-${nodeId}`}
                  className={`route-node-worst-badge ${worst.state} ${pinnedEdgeKey === worst.key ? 'is-pinned' : ''}`}
                  role="button"
                  tabIndex="0"
                  aria-label={`${getNodeLabel(nodeId, data.agents[nodeId])} 最差下游 ${text}`}
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
                const isVirtual = !isUuid;
                const isOnline = stats && stats.status !== 'offline';
                const isActive = activeNodeId === nodeId;
                const isEdgeEndpoint = spotlightEdge && (spotlightEdge.from === nodeId || spotlightEdge.to === nodeId);
                const isInactive = activeNodeId && activeNodeId !== nodeId && !activeEdges.some((edge) => edge.from === nodeId || edge.to === nodeId);
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
                    role="button"
                    tabIndex="0"
                    aria-label={label}
                    aria-pressed={isActive}
                    onClick={() => handleNodeClick(nodeId)}
                    onKeyDown={(event) => handleNodeKeyDown(event, nodeId)}
                  >
                    <rect className="route-svg-node-box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="7" />
                    {isVirtual ? (
                      <Globe2 className="route-svg-node-icon" x={iconX} y={iconY} size={15} />
                    ) : (
                      <Server className="route-svg-node-icon" x={iconX} y={iconY} size={15} />
                    )}
                    <text className="route-svg-node-name" x={textX} y={textY}>{trimNodeLabel(label)}</text>
                    {isUuid && (
                      <circle className={`route-svg-node-status ${isOnline ? 'online' : 'offline'}`} cx={statusX} cy={statusY} r="3.5" />
                    )}
                  </g>
                );
              });
            })}
          </g>
        </svg>
      </div>
      {hoveredEdge?.x !== undefined && hoveredEdge.showTooltip && (
        <div className={`route-tooltip route-tooltip-${hoveredEdge.state}`} style={{ left: hoveredEdge.x, top: hoveredEdge.y }}>
          <span>{hoveredEdge.route}</span>
          <strong>{getLatencyLabel(hoveredEdge.latency)}</strong>
          <small>{hoveredEdge.latency?.ping === 'fail' ? '探测失败' : `丢包 ${hoveredEdge.latency?.loss || 0}%`}</small>
        </div>
      )}
      {!activeNodeId && denseIssueMode && (
        <section className="route-issue-tray" aria-label="异常线路">
          <header>
            <div><span>异常线路</span><small>悬停查看路径，点击固定高亮</small></div>
            <b>{issueEdges.length}</b>
          </header>
          <div className="route-issue-grid">
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
                  <span>{getNodeLabel(edge.from, data.agents[edge.from])} → {getNodeLabel(edge.to, data.agents[edge.to])}</span>
                  <strong>{getLatencyLabel(latency)}</strong>
                </button>
              );
            })}
          </div>
        </section>
      )}
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
                  <span>{getNodeLabel(edge.from, data.agents[edge.from])} → {getNodeLabel(edge.to, data.agents[edge.to])}</span>
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
