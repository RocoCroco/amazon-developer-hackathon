import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolDef } from './llm.js';

export interface McpConfig {
  url: string;
  /** Shared demo key (sent as a Bearer token). */
  demoKey?: string;
}

/** What the agent needs from the MCP server; lets tests use a fake. */
export interface McpTools {
  tools: ToolDef[];
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

/** Real MCP client over Streamable HTTP, acting for one household. */
export async function connectMcp(config: McpConfig, householdId: string): Promise<McpTools> {
  const headers: Record<string, string> = { 'x-household-id': householdId };
  if (config.demoKey) headers.authorization = `Bearer ${config.demoKey}`;

  const client = new Client({ name: 'alexa-plus-simulator', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } }),
  );
  const { tools } = await client.listTools();

  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
    async call(name, args) {
      const res = await client.callTool({ name, arguments: args });
      const parts = (res.content as { type: string; text?: string }[]) ?? [];
      return {
        text: parts.map((p) => p.text ?? '').join('\n'),
        isError: res.isError === true,
      };
    },
    close: () => client.close(),
  };
}
