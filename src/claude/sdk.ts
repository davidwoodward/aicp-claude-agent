import { query, listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { SDKSessionInfo, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// ─── Types ───────────────────────────────────────────────────────

export interface ExecutionMessage {
  role: 'assistant' | 'result';
  content: string;
  stats?: ExecutionStats;
}

export interface ExecutionStats {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  num_turns: number;
  duration_ms: number;
}

export interface ContextInfo {
  inputTokens: number;
  contextWindow: number;
}

export interface ToolEvent {
  type: 'tool_start' | 'tool_progress' | 'tool_end';
  toolName: string;
  toolUseId?: string;
  elapsedSeconds?: number;
}

export interface ExecuteOptions {
  cwd?: string;
  resumeSessionId?: string;
  onProgress?: (text: string) => void;
  onContextUpdate?: (info: ContextInfo) => void;
  onToolEvent?: (event: ToolEvent) => void;
}

// ─── Session listing ─────────────────────────────────────────────

export { SDKSessionInfo };

export async function listRecentSessions(cwd?: string, limit = 20): Promise<SDKSessionInfo[]> {
  const sessions = await listSessions({
    dir: cwd || process.cwd(),
    limit,
  });

  // Sort by most recent first
  return sessions.sort((a, b) => b.lastModified - a.lastModified);
}

// ─── Prompt execution ────────────────────────────────────────────

export async function* executePrompt(
  text: string,
  opts: ExecuteOptions = {},
): AsyncGenerator<ExecutionMessage> {
  const q = query({
    prompt: text,
    options: {
      cwd: opts.cwd || process.cwd(),
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      ...(opts.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
    },
  });

  yield* processMessages(q, opts.onProgress, opts.onContextUpdate, opts.onToolEvent);
}

// ─── Shared message processing ───────────────────────────────────

async function* processMessages(
  stream: AsyncGenerator<SDKMessage, void>,
  onProgress?: (text: string) => void,
  onContextUpdate?: (info: ContextInfo) => void,
  onToolEvent?: (event: ToolEvent) => void,
): AsyncGenerator<ExecutionMessage> {
  let activeToolId: string | undefined;

  for await (const message of stream) {
    if (message.type === 'stream_event') {
      const event = (message as any).event;
      if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
        onProgress?.(event.delta.text);
      } else if (event?.type === 'content_block_start' && event?.content_block?.type === 'tool_use') {
        const toolName = event.content_block.name || 'unknown';
        activeToolId = event.content_block.id;
        onToolEvent?.({ type: 'tool_start', toolName, toolUseId: activeToolId });
      } else if (event?.type === 'content_block_stop' && activeToolId) {
        onToolEvent?.({ type: 'tool_end', toolName: '', toolUseId: activeToolId });
        activeToolId = undefined;
      }
    } else if (message.type === 'tool_progress') {
      const msg = message as any;
      onToolEvent?.({
        type: 'tool_progress',
        toolName: msg.tool_name || '',
        elapsedSeconds: msg.elapsed_time_seconds,
      });
    } else if (message.type === 'assistant') {
      const msg = message as any;
      const content = msg.message?.content;

      // Extract usage for context tracking
      if (onContextUpdate && msg.message?.usage) {
        const usage = msg.message.usage;
        if (usage.input_tokens) {
          onContextUpdate({
            inputTokens: usage.input_tokens,
            contextWindow: 0, // Will be set from result message
          });
        }
      }

      if (Array.isArray(content)) {
        // Emit tool events from assistant content blocks (fallback for non-streaming)
        for (const block of content) {
          if (block.type === 'tool_use') {
            onToolEvent?.({ type: 'tool_start', toolName: block.name, toolUseId: block.id });
          }
        }

        const textParts = content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text as string);
        if (textParts.length > 0) {
          yield { role: 'assistant', content: textParts.join('\n') };
        }
      }
    } else if (message.type === 'result') {
      const msg = message as any;

      // Extract context window from modelUsage
      if (onContextUpdate && msg.modelUsage) {
        const models = Object.values(msg.modelUsage) as any[];
        if (models.length > 0) {
          const model = models[0];
          onContextUpdate({
            inputTokens: model.inputTokens || 0,
            contextWindow: model.contextWindow || 0,
          });
        }
      }

      if ('result' in message) {
        yield {
          role: 'result',
          content: msg.result,
          stats: {
            input_tokens: msg.usage?.input_tokens || 0,
            output_tokens: msg.usage?.output_tokens || 0,
            cost_usd: msg.total_cost_usd || 0,
            num_turns: msg.num_turns || 0,
            duration_ms: msg.duration_ms || 0,
          },
        };
      }
    }
  }
}
