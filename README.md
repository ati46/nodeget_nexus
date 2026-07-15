# NodeGet Nexus Dashboard

NodeGet Nexus Dashboard 是一款专为 [NodeGet](https://nodeget.com) 设计的现代、高性能、全动态的赛博朋克风格实时监控大盘。

它通过建立 WebSocket (WSS) 全双工长连接，实时获取服务器的 CPU、内存、网络负载，并能以动态拓扑图的形式直观展示节点间的网络连通性与拨测延迟。

---

## ✨ 核心特性

- **🚀 零延迟全双工通信**：基于 WebSocket JSON-RPC 的底层通信引擎，所有资源状态毫秒级实时推送。
- **☁️ 云端 KV 动态配置**：拓扑图和拨测任务映射不再硬编码，全面支持从 NodeGet 后端的 KV 存储动态下发，实现修改即生效。
- **🗺️ 直观的网络拓扑流**：可自由定义节点链路（如 `Client -> 中转节点 -> 落地节点 -> Internet`），实时展示链路的 Ping 延迟和丢包率。
- **🛡️ 严格的安全与防呆机制**：支持极高细粒度的 Token 权限控制；内置多重回退和报错拦截逻辑，保证页面稳定运行。
- **🎨 赛博朋克极客美学**：全局沉浸式暗黑风格、磨砂玻璃拟态面板（Glassmorphism）、动态连线光效与数据呼吸动效。

---

## 🛠️ 安装与部署

### 环境要求
- Node.js (建议 v18+)
- NPM 或 Yarn

### 1. 克隆与安装依赖
```bash
git clone https://github.com/your-username/nodeget-monitor.git
cd nodeget-monitor
npm install
```

### 2. 编译打包
```bash
npm run build
```
编译成功后，所有可供部署的静态文件都会生成在 `dist` 目录下。

### 3. 部署到 Web 服务器
将 `dist` 目录下的所有文件上传/复制到你的 Nginx、Caddy 或任何静态网页托管服务器的根目录下即可。

---

## ⚙️ 配置说明 (极简版与云端版)

大盘在启动时，会尝试优先从 **NodeGet KV 存储** 拉取配置；如果拉取失败，则会回退使用 `public/config.json` 中的本地占位配置。

### 方式一：云端 KV 动态配置 (强烈推荐)

在 NodeGet 后台的 **KV 管理** 中，创建一个如下结构的键值对：
- **命名空间 (Namespace)**：`frontend_topology_theme`
- **键 (Key)**：`config`
- **值 (Value)**：填入如下 JSON 格式内容：

```json
{
  "api_url": "wss://你的_nodeget_后端地址/nodeget/rpc",
  "api_token": "你的_ReadOnly_API_Token",
  "topology_routes": [
    {
      "id": "route-1",
      "nodes": ["client", "中转节点UUID", "落地节点UUID", "internet"]
    }
  ],
  "latency_tasks": {
    "中转节点UUID->落地节点UUID": "你的tcping任务名",
    "落地节点UUID->internet": "你的ping任务名"
  }
}
```

### 方式二：本地静态配置

如果你不想使用 KV 存储，请直接修改源码根目录下的 `public/config.json` 文件，填入与上述相同的 JSON 结构，然后执行 `npm run build`。

---

## 🔑 Token 权限配置指南

为了大盘能正常获取实时数据和渲染节点名字，你必须在 NodeGet 后台为刚才填入的 `api_token` 赋予**严格的只读权限**。

请在 Token 的权限模板中，确保勾选以下四类权限（非常重要，少一个都会导致数据缺失）：

1. **`DynamicMonitoring` Read**
   - 权限作用：获取实时的 CPU、内存、网络入站出站流量数据。
2. **`Agent` Read**
   - 权限作用：调用 `agent_query` 接口获取各节点的系统版本、CPU型号、在线状态。
3. **`KV` Read**
   - 读取目标 1：`config`（用于从 `frontend_topology_theme` 读取拓扑配置）
   - 读取目标 2：`metadata_*` 或 `*`（前端需要读取每台机器的 `metadata_name` 来将 UUID 映射为人类可读的机器别名，例如 `lazycat-jp`）
4. **`Task` Read**
   - 权限作用：调用 `task_query` 获取节点间的 Ping/TCPing 历史拨测数据。
   - **注意**：大盘底层会自动查询 `ping` 和 `tcp_ping` 类型的任务，建议将 Task 的目标范围设为通配符 `*`，以免因为权限限死而无法拉取历史记录。

---

## 🤝 贡献与二次开发

本项目基于 React + Vite 构建，所有数据通信封装在 `src/apiClient.js` 中，UI 组件存放于 `src/components/` 目录。
如果你希望扩展功能（如增加双向控制终端、报警弹窗等），可以直接修改对应组件并提 PR。

*Powered by NodeGet JSON-RPC & Hybrid Auto-Discovery*
