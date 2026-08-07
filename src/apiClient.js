class WSRPCClient {
  constructor(url, token) {
    let wsUrl = url;
    if (wsUrl.startsWith('http://')) wsUrl = wsUrl.replace('http://', 'ws://');
    else if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
    else if (wsUrl.startsWith('/')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}${wsUrl}`;
    }

    this.url = wsUrl.endsWith('/') ? wsUrl.slice(0, -1) : wsUrl;
    this.token = token;
    this.ws = null;
    this.pending = new Map();
    this.msgId = 0;
    this.isConnected = false;
    this.connectionPromise = null;
  }

  connect() {
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnected = true;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id !== undefined && this.pending.has(data.id)) {
              const { resolve: res, reject: rej } = this.pending.get(data.id);
              this.pending.delete(data.id);
              
              if (data.error) {
                rej(new Error(`RPC Error: ${data.error.message || JSON.stringify(data.error)}`));
              } else {
                res(data.result);
              }
            }
          } catch (e) {
            console.error("[RPC Error] Failed to parse WSS message:", e);
          }
        };

        this.ws.onerror = (err) => {
          console.error("WSS Error:", err);
          if (!this.isConnected) reject(new Error("WebSocket connection failed. Ensure api_url is correct."));
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.connectionPromise = null;
          this.pending.forEach(({reject}) => reject(new Error("WebSocket closed")));
          this.pending.clear();
        };
      } catch (e) {
        reject(e);
      }
    });
    return this.connectionPromise;
  }

  async call(method, params = {}) {
    if (!this.token) {
      throw new Error('AUTH_ERROR: Missing token');
    }

    if (!this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      this.msgId++;
      const currentId = this.msgId;

      const payload = {
        jsonrpc: '2.0',
        method: method,
        params: {
          token: this.token,
          ...params
        },
        id: currentId
      };

      this.pending.set(currentId, { resolve, reject });

      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        this.pending.delete(currentId);
        reject(e);
      }
    });
  }
}

let rpcClient = null;

// Initialize from config.json
export const initApi = (url, token) => {
  rpcClient = new WSRPCClient(url || '/', token);
};

// Generic JSON-RPC Wrapper
const rpcCall = async (method, params = {}) => {
  if (!rpcClient) throw new Error("API not initialized");
  return rpcClient.call(method, params);
};

// Utility to validate full 36-char UUID format
// NodeGet Rust backend requires strict UUID format, otherwise it throws 'Invalid params'
const isValidUuid = (uuid) => {
  if (typeof uuid !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

// 1. Fetch Agent Names from KV
export const fetchAgentMetadata = async (uuids) => {
  const metadataMap = {};
  
  // We fire them concurrently. 
  // NodeGet KV: kv_get_value(namespace, key)
  // According to docs, namespace = uuid for Agent Namespace.
  const promises = uuids.map(async (uuid) => {
    try {
      const nameRes = await rpcCall('kv_get_value', {
        namespace: uuid,
        key: 'metadata_name'
      });
      const flagRes = await rpcCall('kv_get_value', {
        namespace: uuid,
        key: 'metadata_region'
      });
      
      metadataMap[uuid] = {
        name: (nameRes !== null && nameRes !== undefined) ? nameRes : null,
        flag: (flagRes !== null && flagRes !== undefined) ? flagRes : null
      };
    } catch (e) {
      metadataMap[uuid] = { name: null, flag: null };
    }
  });

  await Promise.all(promises);
  return metadataMap;
};

// 2. Fetch Static Data (OS, CPU Brand)
export const fetchStaticData = async (uuids) => {
  if (!uuids || uuids.length === 0) return [];
  
  // Prevent sending fake/short UUIDs to backend which causes RPC 'Invalid params' crash
  const validUuids = uuids.filter(isValidUuid);
  if (validUuids.length === 0) return [];

  try {
    const result = await rpcCall('agent_static_data_multi_last_query', {
      uuids: validUuids,
      fields: ['cpu', 'system']
    });
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object') {
      if (Array.isArray(result.records)) return result.records;
      if (Array.isArray(result.data)) return result.data;
      return Object.entries(result).map(([uuid, val]) => ({ uuid, ...(val || {}) }));
    }
    return [];
  } catch (e) {
    console.warn("fetchStaticData failed:", e);
    return [];
  }
};

// 3. Fetch Dynamic Data (CPU Load, RAM, Network)
export const fetchDynamicData = async (uuids) => {
  if (!uuids || uuids.length === 0) return [];
  
  const validUuids = uuids.filter(isValidUuid);
  if (validUuids.length === 0) return [];

  try {
    const result = await rpcCall('agent_dynamic_data_multi_last_query', {
      uuids: validUuids,
      fields: ['cpu', 'ram', 'network', 'load', 'disk', 'system']
    });
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object') {
      if (Array.isArray(result.records)) return result.records;
      if (Array.isArray(result.data)) return result.data;
      return Object.entries(result).map(([uuid, val]) => ({ uuid, ...(val || {}) }));
    }
    return [];
  } catch (e) {
    console.warn("fetchDynamicData failed:", e);
    return [];
  }
};

// 4. Fetch Frontend Topology Config from KV
export const fetchFrontendConfig = async () => {
  try {
    const res = await rpcCall('kv_get_value', {
      namespace: 'frontend_topology_theme',
      key: 'config'
    });
    if (!res) return null;
    if (typeof res === 'string') {
      try { return JSON.parse(res); } catch (e) { return null; }
    }
    if (typeof res === 'object') return res;
    return null;
  } catch (e) {
    console.warn("No KV config found for frontend_topology_theme, will fallback to config.json");
    return null;
  }
};

// 4.5 Fetch All Agent UUIDs (Dynamic Discovery)
export const fetchAllAgentUuids = async () => {
  try {
    const res = await rpcCall('agent-uuid_list_all', {});
    if (Array.isArray(res)) return res.filter(isValidUuid);
    if (res && Array.isArray(res.uuids)) return res.uuids.filter(isValidUuid);
    if (res && typeof res === 'object') {
      const keys = Object.keys(res);
      return keys.filter(isValidUuid);
    }
    return [];
  } catch (e) {
    console.warn("Failed to fetch all agents dynamically:", e);
    return [];
  }
};

// 5. Fetch Latency from Task Query
export const fetchTaskLatencies = async (latencyMapping) => {
  if (!latencyMapping) return {};
  
  const latencies = {};
  const promises = Object.entries(latencyMapping).map(async ([edge, cronName]) => {
    try {
      const parts = edge.split('->');
      const agentUuid = isValidUuid(parts[0]) ? parts[0] : (isValidUuid(parts[1]) ? parts[1] : null);
      if (!agentUuid) return;

      const fetchByType = async (type) => {
        const res = await rpcCall('task_query', {
          task_data_query: {
            condition: [
              { cron_source: cronName },
              { uuid: agentUuid },
              { limit: 20 },
              { type: type }
            ]
          }
        });
        return Array.isArray(res) ? res : [];
      };

      const [pingRes, tcpPingRes] = await Promise.all([
        fetchByType('ping').catch(() => []),
        fetchByType('tcp_ping').catch(() => [])
      ]);

      const res = [...pingRes, ...tcpPingRes].sort((a, b) => b.timestamp - a.timestamp);
      if (res && res.length > 0) {
        // Filter for last 5 minutes
        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
        const recentTasks = res.filter(r => r.timestamp > fiveMinsAgo);
        
        // If no tasks in last 5 mins, fallback to the latest one
        const tasksToEval = recentTasks.length > 0 ? recentTasks : [res[0]];

        const total = tasksToEval.length;
        const fails = tasksToEval.filter(r => !r.success).length;
        const lossRate = Math.round((fails / total) * 100);

        let maxPing = -1;
        
        tasksToEval.forEach(task => {
          if (task.success && task.task_event_result) {
            const tr = task.task_event_result;
            let val = -1;
            if (tr.ping !== undefined) val = parseFloat(tr.ping);
            else if (tr.tcp_ping !== undefined) val = parseFloat(tr.tcp_ping);
            else if (tr.http_ping !== undefined) val = parseFloat(tr.http_ping);
            
            if (val > maxPing) maxPing = val;
          }
        });

        let pingVal = maxPing !== -1 ? Math.round(maxPing) : 'fail';
        latencies[edge] = { ping: pingVal, loss: lossRate };
      }
    } catch (e) {
      console.warn(`Failed to fetch task latency for ${cronName}:`, e);
    }
  });

  await Promise.all(promises);
  return latencies;
};

// 6. Fetch 24h Task History for Global Chart
export const fetch24hTaskHistory = async (latencyMapping) => {
  if (!latencyMapping) return {};

  const uniqueCrons = Array.from(new Set(Object.values(latencyMapping)));
  if (uniqueCrons.length === 0) return {};

  const now = Date.now();
  const yesterday = now - 24 * 3600 * 1000;
  const historyData = {}; // { "cronName": [ {timestamp, latency, success} ] }

  const promises = uniqueCrons.map(async (cronName) => {
    try {
      const fetchByType = async (type) => {
        const res = await rpcCall('task_query', {
          task_data_query: {
            condition: [
              { cron_source: cronName },
              { timestamp_from_to: [yesterday, now] },
              { limit: 500 },
              { type: type }
            ]
          }
        });
        return Array.isArray(res) ? res : [];
      };

      const [pingRes, tcpPingRes] = await Promise.all([
        fetchByType('ping').catch(() => []),
        fetchByType('tcp_ping').catch(() => [])
      ]);

      const res = [...pingRes, ...tcpPingRes];
      
      const records = [];
      if (res && Array.isArray(res)) {
        res.forEach(item => {
          let latency = null;
          if (item.success && item.task_event_result) {
            const tr = item.task_event_result;
            if (tr.ping !== undefined) latency = parseFloat(tr.ping);
            else if (tr.tcp_ping !== undefined) latency = parseFloat(tr.tcp_ping);
            else if (tr.http_ping !== undefined) latency = parseFloat(tr.http_ping);
          }
          records.push({
            timestamp: item.timestamp,
            latency: latency,
            success: item.success
          });
        });
      }
      historyData[cronName] = records.sort((a, b) => a.timestamp - b.timestamp);
    } catch (e) {
      console.warn(`Failed to fetch 24h history for ${cronName}:`, e);
      historyData[cronName] = [];
    }
  });

  await Promise.all(promises);
  return historyData;
};

// 7. Fetch 24h Task History for a Specific Node
export const fetchNodeTaskHistory = async (uuid) => {
  if (!uuid) return {};

  const now = Date.now();
  const yesterday = now - 24 * 3600 * 1000;
  const historyData = {}; // { "cronName": [ {timestamp, latency, success} ] }

  try {
    const fetchByType = async (type) => {
      const res = await rpcCall('task_query', {
        task_data_query: {
          condition: [
            { uuid: uuid },
            { timestamp_from_to: [yesterday, now] },
            { limit: 3000 },
            { type: type }
          ]
        }
      });
      return Array.isArray(res) ? res : [];
    };

    // Concurrently fetch ping and tcp_ping tasks
    const [pingRes, tcpPingRes] = await Promise.all([
      fetchByType('ping').catch(() => []),
      fetchByType('tcp_ping').catch(() => [])
    ]);

    const combinedRes = [...pingRes, ...tcpPingRes];

    if (combinedRes.length > 0) {
      combinedRes.forEach(item => {
        if (!item.cron_source) return;
        const cronName = item.cron_source;
        if (!historyData[cronName]) historyData[cronName] = [];

        let latency = null;
        if (item.success && item.task_event_result) {
          const tr = item.task_event_result;
          if (tr.ping !== undefined) latency = parseFloat(tr.ping);
          else if (tr.tcp_ping !== undefined) latency = parseFloat(tr.tcp_ping);
          else if (tr.http_ping !== undefined) latency = parseFloat(tr.http_ping);
        }
        
        // Only include ping-related tasks
        if (cronName.toLowerCase().includes('ping')) {
          historyData[cronName].push({
            timestamp: item.timestamp,
            latency: latency,
            success: item.success
          });
        }
      });

      // Sort all arrays
      Object.keys(historyData).forEach(k => {
        historyData[k].sort((a, b) => a.timestamp - b.timestamp);
      });
    }
  } catch (e) {
    console.warn(`Failed to fetch node history for ${uuid}:`, e);
  }

  return historyData;
};
