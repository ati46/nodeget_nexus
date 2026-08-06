# AGENTS.md - NodeGet Nexus Dashboard

**Project Context**: Real-time cyberpunk monitoring dashboard for NodeGet. WebSocket JSON-RPC for live CPU/RAM/network + topology graph + latency tasks. Config via KV (preferred) or static JSON. Strict token auth, hybrid fallback, dynamic discovery.

## Tech Stack
- React 19, Vite, Redux Toolkit, Recharts, lucide-react, TypeScript types
- WS RPC client (src/apiClient.js)
- Oxlint + build pipeline
- CSS: custom cyberpunk/glassmorphism vars

**Architecture**: Hexagonal/Ports-and-Adapters. API adapter isolated; core (components, transformers) depends only on interfaces.

## Core Architecture Decisions
- **API Layer (Ports)**: WSRPCClient handles WS JSON-RPC (msgId matching, auto-reconnect on close, token injection, UUID validation to prevent backend crashes).
- **Data Flow**: Initial KV + static fetch → polling loop (2s dynamic, 20s latency) → transformData → UI components.
- **State**: MetadataMap, history24h, remoteConfig (hybrid merge).
- **UI**: SegmentTopology, NodeCard, modals, global panels. All data-driven, no hardcoded routes beyond config.
- **Resilience**: Try/catch everywhere, initError UI, partial data fallback, no blocking awaits in render.

## Key Principles (Global Architect Rules)
1. 以直击核心为荣，以空洞客套为耻 — Direct error handling, minimal UI bloat.
2. 以干货结构为荣，以散漫废话为耻 — Clear polling intervals, documented RPC calls.
3. 以极限推演为荣，以盲目乐观为耻 — Assumed WS failures, token expiry, KV timeouts; reconnect + fallback.
4. 以深度逻辑为荣，以浅尝辄止为耻 — Full chain: KV → metadata → topology → latency → render.
5. 以事实核查为荣，以凭空猜测为耻 — UUID regex, permission checks, config merge logic explicit.
6. 以枯燥稳健为荣，以花哨炫技为耻 — Conservative polling, observable logs, static fallback.
7. 以主动证伪为荣，以盲从执行为耻 — Architecture review: assume backend can return malformed data or slow KV.
8. 以客观智囊为荣，以情绪抚慰为耻 — No hype; focus on production reliability for monitoring dashboard.

## Failure & Idempotency Rules
- Every RPC call validates token; partial failures recoverable.
- Polling safe to repeat (no duplicates in state).
- Config merge: KV wins, static supplements latency_tasks.
- Observability: Console for errors, loading skeleton, 24h history for charts.
- Extreme paths: Invalid UUID, no layers, token-less init → graceful degradation to error UI.

## Implementation Discipline
- Changes must cover: concurrency (Promise.all safe), boundaries (WS close handling), edge (empty UUID list).
- Always add [CAUTION] for any state mutation or external call.
- Build/deploy: `npm run build` → static dist/ to server root.
- Security: Read-only token enforced at call site; no write paths.

## Future Extensions
- Add bidirectional control? New ports for commands.
- Multi-site? Extend edges definition.
- More charts? Extend Recharts usage in panels.
- Config compression: support `mode: "full_mesh"` or `mode: "selective"` presets to further reduce KV size.

**Author**: Grok Architect (tailored to this project).  
**Status**: Project root AGENTS.md created following global rules. Use relative paths in code.

