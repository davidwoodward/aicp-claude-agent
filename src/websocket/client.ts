import WebSocket from 'ws';
import { config } from '../config';
import {
  AgentToBackendMessage,
  BackendToAgentMessage,
} from '../types/protocol';

type MessageHandler = (msg: BackendToAgentMessage) => void;

const HEARTBEAT_INTERVAL = 10_000;
const INITIAL_RECONNECT_DELAY = 1_000;
const MAX_RECONNECT_DELAY = 30_000;

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let intentionalClose = false;

const messageHandlers: MessageHandler[] = [];

export function connect(): void {
  openSocket();
}

export function disconnect(): void {
  intentionalClose = true;
  cleanup();
  if (ws) {
    ws.close(1000, 'agent shutting down');
    ws = null;
  }
}

export function sendMessage(msg: AgentToBackendMessage): void {
  send(msg);
}

export function onMessage(handler: MessageHandler): void {
  messageHandlers.push(handler);
}

// ─── Internal ───────────────────────────────────────────────────────

function openSocket(): void {
  if (ws) return;

  intentionalClose = false;
  const wsUrl = new URL(config.backendUrl);
  wsUrl.searchParams.set('token', config.apiKey);
  ws = new WebSocket(wsUrl.toString());

  ws.on('open', () => {
    console.log(`[ws] connected to ${config.backendUrl}`);
    reconnectDelay = INITIAL_RECONNECT_DELAY;

    send({
      type: 'register',
      agent_id: config.agentId,
      project_id: config.projectId,
      machine_name: config.machineName,
    });
  });

  ws.on('message', (data: WebSocket.Data) => {
    let msg: BackendToAgentMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.error('[ws] received non-JSON message');
      return;
    }

    if (msg.type === 'error') {
      console.error(`[ws] server error: ${msg.error}`);
    }

    if (msg.type === 'registered') {
      startHeartbeat();
    }

    for (const handler of messageHandlers) {
      handler(msg);
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    console.log(`[ws] disconnected (code=${code}, reason=${reason.toString()})`);
    cleanup();

    if (!intentionalClose) {
      scheduleReconnect();
    }
  });

  ws.on('error', (err: Error) => {
    console.error(`[ws] error: ${err.message}`);
  });
}

function send(msg: AgentToBackendMessage): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[ws] cannot send, not connected');
    return;
  }
  ws.send(JSON.stringify(msg));
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send({ type: 'heartbeat' });
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function cleanup(): void {
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws = null;
}

function scheduleReconnect(): void {
  console.log(`[ws] reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}
