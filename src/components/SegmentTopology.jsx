import React from 'react';
import TopologyNode from './TopologyNode';
import { Globe } from 'lucide-react';

const SegmentTopology = ({ data, onNodeClick }) => {
  const getLatencyClass = (latency) => {
    if (latency === 'fail') return 'critical';
    if (latency < 50) return 'healthy';
    if (latency < 150) return 'warning';
    return 'critical';
  };

  const routes = data.config && data.config.topology_routes ? data.config.topology_routes : [];

  if (routes.length === 0) {
    return <div style={{color: 'var(--text-secondary)'}}>No routing topology configured. Add your real UUIDs to your config to see the map.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {routes.map((route, routeIndex) => (
        <div key={route.id || routeIndex} className="route-row">
          {route.name && <div className="route-badge">{route.name}</div>}
          <div className="topology-container">
            {route.nodes.map((nodeId, index) => {
              const isLastNode = index === route.nodes.length - 1;
              const stats = data.agents[nodeId];
              
              // Find latency to next node (if available from external targets)
              let latency = null;
              if (!isLastNode) {
                const nextNodeId = route.nodes[index + 1];
                latency = data.latencies && data.latencies[`${nodeId}->${nextNodeId}`];
              }

              return (
                <React.Fragment key={`${route.id || routeIndex}-${nodeId}-${index}`}>
                  {/* The Node */}
                  <div className="node-column">
                    <TopologyNode 
                      nodeId={nodeId}
                      stats={stats}
                      onClick={stats ? () => onNodeClick(stats) : undefined}
                    />
                  </div>

                  {/* The Connection Line */}
                  {!isLastNode && (
                    <div className="latency-line">
                      {latency !== undefined && latency !== null && (
                        <div className={`latency-value ${getLatencyClass(latency.ping)}`}>
                          {latency.ping === 'fail' ? 'Loss' : `${latency.ping} ms`}
                          {latency.loss > 0 && (
                            <span style={{ marginLeft: '4px', opacity: 0.8, color: latency.loss > 5 ? 'var(--accent-rose)' : 'inherit' }}>
                              ({latency.loss}%)
                            </span>
                          )}
                        </div>
                      )}
                      {/* Flowing particles */}
                      <div className="data-particle" style={{ animationDuration: '1.5s' }}></div>
                      <div className="data-particle" style={{ animationDuration: '1.5s', animationDelay: '0.75s' }}></div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SegmentTopology;
