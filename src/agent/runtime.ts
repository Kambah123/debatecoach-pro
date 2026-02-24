import { Config } from '../config/schema.js';
import { Logger } from '../utils/logger.js';
import { MemoryManager } from '../memory/manager.js';
import { ToolRegistry } from '../tools/registry.js';
import { LLMClient } from './client.js';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result: any;
  error?: string;
}

export interface AgentResponse {
  content: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  iterations: number;
  tokensUsed: number;
}

export class AgentRuntime {
  private logger: Logger;
  private llm: LLMClient;
  private memory: MemoryManager;
  private tools: ToolRegistry;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger('AgentRuntime');
    this.llm = new LLMClient(config);
    this.memory = new MemoryManager(config);
    this.tools = new ToolRegistry(config);
  }

  async initialize(): Promise<void> {
    await this.memory.initialize();
    await this.tools.initialize();
    this.logger.info('Agent runtime initialized');
  }

  async processMessage(
    userId: string,
    message: string,
    context?: Record<string, any>
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    // Build conversation history
    const history = await this.memory.getConversationHistory(userId, 10);

    // Get relevant tools for this message
    const relevantTools = await this.tools.getRelevantTools(message);

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(context);

    // Agentic loop
    let iterations = 0;
    const maxIterations = this.config.agent.maxIterations;
    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message }
    ];

    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    let finalContent = '';
    let tokensUsed = 0;

    while (iterations < maxIterations) {
      iterations++;

      // Get LLM response
      const response = await this.llm.chat(messages, relevantTools);
      tokensUsed += response.tokensUsed;

      if (response.content) {
        finalContent = response.content;
      }

      // Check if tool calls are needed
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      for (const call of response.toolCalls) {
        toolCalls.push(call);

        const result = await this.tools.execute(call.name, call.arguments);
        toolResults.push({
          toolCallId: call.id,
          success: result.success,
          result: result.data,
          error: result.error
        });

        // Add to messages for next iteration
        messages.push({
          role: 'assistant',
          content: '',
          toolCalls: [call]
        });

        messages.push({
          role: 'tool',
          content: JSON.stringify(result)
        });
      }

      // Check if we should continue
      if (iterations >= maxIterations) {
        finalContent += "\n\n[I reached the maximum number of tool calls. Let me summarize what I found.]";
        break;
      }
    }

    // Store in memory
    await this.memory.addMessage(userId, 'user', message);
    await this.memory.addMessage(userId, 'assistant', finalContent);

    // Check if compaction is needed
    await this.memory.checkCompaction(userId);

    const duration = Date.now() - startTime;
    this.logger.info(`Processed message in ${duration}ms, ${iterations} iterations, ${tokensUsed} tokens`);

    return {
      content: finalContent,
      toolCalls,
      toolResults,
      iterations,
      tokensUsed
    };
  }

  private buildSystemPrompt(context?: Record<string, any>): string {
    const walletAddress = context?.walletAddress || 'Not connected';
    const balance = context?.balance || 0;

    return `You are **Solaire**, an autonomous AI agent for Solana blockchain operations.

**Your Capabilities:**
- Execute Solana transactions (send SOL/SPL tokens, swap via Jupiter)
- Check balances and portfolio values
- Provide market data and token information
- Manage DAO treasuries and multi-sig operations
- Schedule recurring payments and tasks
- Remember user preferences and transaction history

**Current Context:**
- Wallet: ${walletAddress}
- Balance: ${balance} SOL
- Network: Solana Mainnet

**Guidelines:**
1. Always confirm transaction details before executing
2. Explain blockchain operations in simple terms
3. Warn about high slippage or price impact
4. Never expose private keys or sensitive data
5. If unsure, ask for clarification rather than guessing

**Response Style:**
- Professional yet friendly
- Concise but informative
- Use emojis sparingly for clarity
- Always include transaction signatures when available

When executing tools, think step by step and verify each action.`;
  }

  async shutdown(): Promise<void> {
    await this.memory.close();
    this.logger.info('Agent runtime shutdown');
  }
}
