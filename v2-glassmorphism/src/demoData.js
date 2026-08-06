const NAMES = [['Shanghai Edge 01','CN'],['Shanghai Edge 02','CN'],['Shanghai Edge 03','CN'],['Los Angeles WAC','US'],['Los Angeles BV','US'],['Seattle DR','US']];
const seeded = (i,min,max) => Math.round(min + (max-min)*(((i+1)*47%97)/97));
const history = (source, faulty=false) => Array.from({length:144},(_,i) => {
  const success=!(faulty&&i%19===0);
  return {timestamp:Date.now()-((143-i)*600000),success,latency:success?Math.max(7,Math.round(38+source*16+Math.sin((i+source*4)/9)*9+(faulty&&i>112&&i<126?128:0))):null};
});
export const buildDemoDashboard = (config) => {
  const ids=Array.from(new Set(config.edges.flatMap((e)=>[e.from,e.to]).filter((id)=>/^[0-9a-f-]{36}$/i.test(id))));
  const agents={};
  ids.forEach((id,i)=>{
    const [name,flag]=NAMES[i]||[`Node ${i+1}`,'GL']; const offline=i===4;
    agents[id]={id,name,flag,status:offline?'offline':'online',os:i%2?'Debian 12 · KVM':'Ubuntu 24.04 · KVM',cpuBrand:`${i%3===0?4:2} 核 · AMD EPYC`,cpu:offline?0:seeded(i,12,78),cpu_history:Array.from({length:20},(_,p)=>({value:offline?0:seeded(i+p,8,82)})),ram_used:offline?0:seeded(i,840,2940),ram_total:4096,swap_used:0,swap_total:0,disk_used:seeded(i,12000,42000),disk_total:81920,net_rx_speed:offline?0:seeded(i,140000,12000000),net_tx_speed:offline?0:seeded(i+2,90000,7000000),net_rx_total:seeded(i,2,18)*1024**3,net_tx_total:seeded(i+1,1,12)*1024**3,connections:offline?0:seeded(i,18,186),processes:offline?0:seeded(i,88,242),uptime:offline?'未知':`${seeded(i,2,28)}天 ${seeded(i,1,18)}时`,last_update:offline?'12 分钟前':'刚刚',load:offline?0:(seeded(i,10,180)/100).toFixed(2)};
  });
  const latencies={},history24h={},tasks=new Set();
  config.edges.forEach((edge,i)=>{const key=`${edge.from}->${edge.to}`;if(!latencies[key])latencies[key]=edge.to===ids[4]?{ping:'fail',loss:100}:i%7===3?{ping:178,loss:8}:{ping:seeded(i,8,92),loss:i%5===0?2:0};if(edge.latencyTask&&!tasks.has(edge.latencyTask)){tasks.add(edge.latencyTask);history24h[edge.latencyTask]=history(tasks.size-1,tasks.size===2);}});
  const list=Object.values(agents),online=list.filter((n)=>n.status==='online').length,rx=list.reduce((s,n)=>s+n.net_rx_speed,0),tx=list.reduce((s,n)=>s+n.net_tx_speed,0);
  return {data:{agents,latencies,config,global:{health:Math.round(online/Math.max(1,list.length)*100),onlineCount:online,totalCount:list.length,rx_speed:rx,tx_speed:tx,rx_total:list.reduce((s,n)=>s+n.net_rx_total,0),tx_total:list.reduce((s,n)=>s+n.net_tx_total,0),history:Array.from({length:20},(_,i)=>({time:`10:${String(i*3).padStart(2,'0')}`,rx:42+Math.sin(i/2.2)*14+i,tx:21+Math.cos(i/2.8)*8+i/2}))}},history24h};
};
