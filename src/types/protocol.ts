// Strict WebSocket protocol types — matches aicp-app backend contract

export type AgentStatus = 'idle' | 'busy' | 'offline';
export type MessageRole = 'user' | 'claude';

// ─── Agent → Backend ────────────────────────────────────────────────

export interface RegisterMessage {
  type: 'register';
  agent_id: string;
  project_id: string;
  machine_name: string;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface StatusMessage {
  type: 'status';
  status: AgentStatus;
}

export interface MessageMessage {
  type: 'message';
  session_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface ExecutionCompleteMessage {
  type: 'execution_complete';
  prompt_id: string;
  session_id: string;
  token_usage?: { input_tokens?: number; output_tokens?: number };
}

export type AgentToBackendMessage =
  | RegisterMessage
  | HeartbeatMessage
  | StatusMessage
  | MessageMessage
  | ExecutionCompleteMessage;

// ─── Backend → Agent ────────────────────────────────────────────────

export interface RegisteredMessage {
  type: 'registered';
  agent_id: string;
}

export interface HeartbeatAckMessage {
  type: 'heartbeat_ack';
}

export interface ExecutePromptMessage {
  type: 'execute_prompt';
  prompt_id: string;
  text: string;
}

export interface ErrorMessage {
  type: 'error';
  error: string;
}

export type BackendToAgentMessage =
  | RegisteredMessage
  | HeartbeatAckMessage
  | ExecutePromptMessage
  | ErrorMessage;
