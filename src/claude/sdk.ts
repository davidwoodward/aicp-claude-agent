import { query } from '@anthropic-ai/claude-agent-sdk';

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

export interface ExecuteOptions {
  cwd?: string;
  onProgress?: (text: string) => void;
}

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
    },
  });

  for await (const message of q) {
    if (message.type === 'stream_event') {
      // Streaming text delta — display only, not captured to backend
      const event = (message as any).event;
      if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
        opts.onProgress?.(event.delta.text);
      }
    } else if (message.type === 'assistant') {
      const content = (message as any).message?.content;
      if (Array.isArray(content)) {
        // Show tool usage in terminal
        for (const block of content) {
          if (block.type === 'tool_use') {
            opts.onProgress?.(`\n  ⚡ ${block.name}\n`);
          }
        }

        // Yield clean text for backend capture
        const textParts = content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text as string);
        if (textParts.length > 0) {
          yield { role: 'assistant', content: textParts.join('\n') };
        }
      }
    } else if (message.type === 'result' && 'result' in message) {
      const msg = message as any;
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
