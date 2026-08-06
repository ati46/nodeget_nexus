# NodeGet Nexus Dashboard

NodeGet Nexus Dashboard 是一款面向 NodeGet 的实时线路监控大盘。它通过 WebSocket JSON-RPC 拉取服务器动态监控、节点元数据和拨测任务结果，并用从左到右的分层拓扑矩阵展示链路连通性与延迟。

## 核心特性

- **实时监控**：通过 NodeGet WebSocket JSON-RPC 获取 CPU、内存、网络、磁盘、系统负载等动态数据。
- **分层线路拓扑**：按接入层、中转层、落地层、目标层横向排列，适合展示运营商入口、转发节点、落地节点和目标服务。
- **单 SVG 拓扑画布**：节点、连线、箭头、延迟标签在同一个 SVG 坐标系内渲染，避免 HTML/SVG 混排造成的错位和裁切。
- **线路延迟常驻展示**：线路上直接显示 `xxms`、`xxms / loss%`、`100% loss` 或 `-- ms`。
- **KV 动态配置**：优先读取 NodeGet KV：`frontend_topology_theme.config`；失败时回退到 `public/config.json`。
- **标签节点兼容**：节点 ID 可以是真实 NodeGet UUID，也可以是 `联通`、`移动`、`cf`、`ytb` 这类纯展示标签。

## 本地开发

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5175
```

构建部署：

```bash
npm run build
```

构建产物在 `dist/`，可部署到任意静态 Web 服务。
首次使用时，编辑 `public/config.json` 填入你自己的只读 WebSocket 地址和 token。仓库中的配置仅是脱敏示例，不包含任何可用凭据。

演示模式无需后端连接：启动开发服务器后访问 `http://127.0.0.1:5175/?demo=1`。

## 配置与安全

- 不要把真实 token、密码、私钥、`.env` 文件或生产节点信息提交到 Git。
- `public/config.json` 只保留占位配置；生产部署前请在本地替换，或通过部署流程注入配置。
- token 必须使用只读权限，并在泄露后立即撤销和轮换。
- 如果凭据曾经进入 Git 历史，仅修改当前文件还不够；推送前必须清理历史，或重新初始化一个不含旧历史的仓库。

## 配置来源

启动顺序：

1. 读取 `public/config.json`，初始化 API 地址和 token。
2. 使用当前 API token 尝试读取 NodeGet KV：
   - 命名空间：`frontend_topology_theme`
   - 键：`config`
3. KV 中存在有效 `edges` 时，KV 配置优先；否则使用 `public/config.json`。

## 推荐配置格式

```json
{
  "api_url": "wss://ng.example.com/nodeget/rpc",
  "api_token": "READ_ONLY_TOKEN",
  "topology": {
    "layers": [
      { "name": "接入层", "nodes": ["联通", "移动", "电信"] },
      { "name": "中转层", "nodes": ["中转1", "中转2"] },
      { "name": "落地层", "nodes": ["落地1", "落地2", "落地3"] },
      { "name": "目标层", "nodes": ["cf", "ytb"] }
    ]
  },
  "edges": [
    { "from": "联通", "to": "中转1", "latencyTask": "tcping-unicom-transit1" },
    { "from": "联通", "to": "中转2", "latencyTask": "tcping-unicom-transit2" },
    { "from": "移动", "to": "中转1", "latencyTask": "tcping-mobile-transit1" },
    { "from": "电信", "to": "中转2", "latencyTask": "tcping-telecom-transit2" },
    { "from": "中转1", "to": "落地1", "latencyTask": "tcping-transit1-landing1" },
    { "from": "中转1", "to": "落地2", "latencyTask": "tcping-transit1-landing2" },
    { "from": "中转2", "to": "落地2", "latencyTask": "tcping-transit2-landing2" },
    { "from": "中转2", "to": "落地3", "latencyTask": "tcping-transit2-landing3" },
    { "from": "落地1", "to": "cf", "latencyTask": "tcping-landing1-cf" },
    { "from": "落地2", "to": "ytb", "latencyTask": "tcping-landing2-ytb" }
  ]
}
```

### 字段说明

- `topology.layers`：决定拓扑列顺序和每列节点顺序。第一层在最左侧，最后一层在最右侧。
- `edges`：决定实际连线。只会渲染 `from` 和 `to` 都存在于 `topology.layers[].nodes` 中的边。
- `edges[].latencyTask`：该线路对应的 NodeGet task 名。前端会自动展开为 `latency_tasks["from->to"]`。
- `latency_tasks`：仍兼容旧写法。如果同时存在，显式 `latency_tasks` 优先级最高。
- 真实 UUID 节点：会参与 Agent 元数据、静态数据、动态数据查询，并显示在线状态点。
- 非 UUID 标签节点：只用于拓扑展示，不会发送到 Agent/Task UUID 查询接口。

## 延迟显示规则

线路标签含义：

- `32ms`：最近拨测成功，延迟为 32ms。
- `158ms / 13%`：最近拨测存在丢包，显示延迟和丢包率。
- `100% loss`：拨测失败或丢包超过阈值。
- `-- ms`：线路配置了 `latencyTask`，但当前没有拿到可用结果；常见原因是 task 名不匹配、权限不足、任务没有最近数据，或线路两端都是非 UUID 标签节点。
- 无标签：该 `edge` 没有配置 `latencyTask`，只作为静态拓扑线展示。

颜色规则：

- 绿色：健康线路。
- 黄色：高延迟或轻度丢包。
- 红色：失败或严重丢包。
- 灰色：未获取到延迟数据。

## UUID 与标签节点边界

前端会严格过滤 UUID，避免 NodeGet 后端收到非法 UUID：

- UUID 示例：`11111111-1111-4111-8111-111111111111`（占位值）
- 标签示例：`联通`、`移动`、`电信`、`cf`、`ytb`

如果你希望某条线展示真实拨测延迟，建议该线至少一端使用真实 NodeGet UUID，并确保 `latencyTask` 指向该 UUID 上可查询到的 task。

## Token 权限

建议使用只读 token，并授予：

1. **DynamicMonitoring Read**：读取 CPU、内存、网络、磁盘等动态数据。
2. **Agent Read**：读取 Agent 静态信息和在线状态。
3. **KV Read**：读取 `frontend_topology_theme.config`，以及各节点 namespace 下的 `metadata_name`、`metadata_region`。
4. **Task Read**：读取 Ping/TCPing 历史任务结果，用于线路延迟。

## 代码结构

- `src/App.jsx`：配置加载、KV fallback、UUID 过滤、拨测任务映射合并、轮询入口。
- `src/apiClient.js`：NodeGet WebSocket JSON-RPC 客户端和各类 read-only RPC adapter。
- `src/dataTransformer.js`：后端数据到前端状态树的转换。
- `src/demoData.js`：生成不依赖后端的演示数据。
- `src/components/SegmentTopology.jsx`：单 SVG 分层线路拓扑。
- `src/index.css`：全局视觉样式和拓扑 SVG 样式。
- `public/config.json`：脱敏的示例 fallback 配置，部署前需要替换为实际配置。

## 验证命令

```bash
npm run build
npm run lint
```

`lint` 当前可能输出既有 unused warning；只要退出码为 0，构建链路可继续。

*Powered by NodeGet JSON-RPC & Hybrid Auto-Discovery*
