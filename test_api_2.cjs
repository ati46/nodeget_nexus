const WebSocket = require('ws');

const url = 'wss://ng.vcxz.cc/nodeget/rpc';
const token = 'PEiBojorhk66LJrH:tf1YURvpH5VehAnHLRW4g9zSs5H0rUIs';

const ws = new WebSocket(url);
let msgId = 1;

ws.on('open', () => {
  console.log('Connected to WS');
  
  // Test UUID fetch
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'agent-uuid_list_all',
    params: { token },
    id: msgId++
  }));
});

ws.on('message', (data) => {
  const res = JSON.parse(data.toString());
  console.log('Response ID:', res.id);
  
  if (res.error) {
    console.error('Error:', res.error);
    return;
  }
  
  console.log('Result:', JSON.stringify(res.result, null, 2));

  if (res.id === 1) { // agent-uuid_list_all response
    let uuids = [];
    if (Array.isArray(res.result)) uuids = res.result;
    else if (res.result && res.result.uuids) uuids = res.result.uuids;
    else if (res.result) uuids = Object.keys(res.result);

    console.log('Found UUIDs:', uuids);
    
    // Fetch metadata_region for each UUID
    uuids.forEach((uuid) => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'kv_get_value',
        params: { token, namespace: uuid, key: 'metadata_region' },
        id: msgId++
      }));
    });
  } else if (res.id === 2) {
    // done
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
});
