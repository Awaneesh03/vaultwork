#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { pathToFileURL } from 'node:url'
import { registerTools } from './tools.ts'

/**
 * The Vaultwork MCP server (M18.1) — read-only.
 *
 * Claude Desktop spawns this process and speaks to it over stdio. Note what is
 * absent and is meant to stay absent: no port is opened, no socket is bound, no
 * HTTP transport is imported, and nothing here can reach Vaultwork's database.
 * The server's entire world is one JSON file that the desktop app publishes.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'vaultwork', version: '0.1.0' },
    {
      instructions:
        'Read-only access to a local snapshot of the user’s Vaultwork workspace (tasks, projects, habits, focus). Every result carries generatedAt and a stale flag; say so when the data is stale. There are no tools to create or change anything.',
    },
  )
  registerTools(server)
  return server
}

async function main(): Promise<void> {
  const server = createMcpServer()
  await server.connect(new StdioServerTransport())
}

// Only when run as a program. Imported by the tests, which drive it in memory.
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    // stderr, never stdout: stdout is the protocol channel.
    console.error('vaultwork-mcp failed to start:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
