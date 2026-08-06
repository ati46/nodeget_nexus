import React from 'react';
import { Activity, ArrowDown, ArrowUp, CircleAlert, Database, Route, Server } from 'lucide-react';
import { formatBytes, formatSpeed } from '../dataTransformer';

const Metric = ({ icon: Icon, label, value, detail, tone = 'neutral' }) => {
  const text = String(value);
  const parts = text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+(.+)$/);

  return (
    <article className={`metric-cell ${tone}`}>
      <div className="metric-icon"><Icon size={17} /></div>
      <div className="metric-content">
        <span className="metric-label">{label}</span>
        <strong className="metric-value" title={text}>
          <span>{parts ? parts[1] : text}</span>
          {parts && <em>{parts[2]}</em>}
        </strong>
        <small className="metric-detail">{detail}</small>
      </div>
    </article>
  );
};

const GlobalNetworkPanel = ({ global, routeSummary }) => {
  if (!global) return null;
  const offline = Math.max(0, global.totalCount - global.onlineCount);
  const observedRoutes = routeSummary.healthy + routeSummary.warning + routeSummary.critical;
  return (
    <section className="metrics-strip" aria-label="全局运行状态">
      <Metric icon={Activity} label="整体健康度" value={`${global.health}%`} detail={offline ? `${offline} 个节点离线` : '全部节点在线'} tone={global.health < 90 ? 'warning' : 'healthy'} />
      <Metric icon={Server} label="Agent" value={`${global.onlineCount} / ${global.totalCount}`} detail="在线 / 总数" />
      <Metric icon={ArrowDown} label="实时入站" value={formatSpeed(global.rx_speed)} detail="全节点汇总" tone="route" />
      <Metric icon={ArrowUp} label="实时出站" value={formatSpeed(global.tx_speed)} detail="全节点汇总" />
      <Metric icon={Database} label="已用总流量" value={formatBytes((global.rx_total || 0) + (global.tx_total || 0))} detail={`入 ${formatBytes(global.rx_total || 0)} · 出 ${formatBytes(global.tx_total || 0)}`} tone="route" />
      <Metric icon={Route} label="可观测线路" value={observedRoutes} detail={`${routeSummary.unknown} 条无数据`} />
      <Metric icon={CircleAlert} label="异常线路" value={routeSummary.warning + routeSummary.critical} detail={`${routeSummary.critical} 条故障`} tone={routeSummary.critical ? 'critical' : routeSummary.warning ? 'warning' : 'healthy'} />
    </section>
  );
};

export default GlobalNetworkPanel;
