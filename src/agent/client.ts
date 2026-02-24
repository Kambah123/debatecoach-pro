import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Config, LLMProvider } from '../config/schema.js';
import { Logger } from '../utils/logger.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface LLMResponse {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
  }>;
  tokensUsed: number;
}

export class LLMClient {
  private provider: LLMProvider;
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private google?: GoogleGenerativeAI;
  private config: Config;
  private logger: Logger;

  constructor(config: Config) {
    this.config = config;
    this.provider = config.agent.provider;
    this.logger = new Logger('LLMClient');

    this.initializeClients();
  }

  private initializeClients(): void {
    switch (this.provider) {
      case 'openai':
        this.openai = new OpenAI({ apiKey: this.config.agent.apiKey });
        break;
      case 'anthropic':
        this.anthropic = new Anthropic({ apiKey: this.config.agent.apiKey });
        break;
      case 'google':
        this.google = new GoogleGenerativeAI(this.config.agent.apiKey);
        break;
      case 'groq':
        this.openai = new OpenAI({
          apiKey: this.config.agent.apiKey,
          baseURL: 'https://api.groq.com/openai/v1'
        });
        break;
      case 'openrouter':
        this.openai = new OpenAI({
          apiKey: this.config.agent.apiKey,
          baseURL: 'https://openrouter.ai/api/v1'
        });
        break;
    }
  }

  async chat(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    switch (this.provider) {
      case 'openai':
      case 'groq':
      case 'openrouter':
        return this.chatOpenAI(messages, tools);
      case 'anthropic':
        return this.chatAnthropic(messages, tools);
      case 'google':
        return this.chatGoogle(messages, tools);
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  private async chatOpenAI(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    const formattedTools = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));

    const response = await this.openai!.chat.completions.create({
      model: this.config.agent.model,
      messages: messages as any,
      tools: formattedTools,
      tool_choice: 'auto',
      temperature: this.config.agent.temperature,
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    })) || [];

    return {
      content: choice.message.content || '',
      toolCalls,
      tokensUsed: response.usage?.total_tokens || 0
    };
  }

  private async chatAnthropic(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    // Convert messages to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content
      }));

    const response = await this.anthropic!.messages.create({
      model: this.config.agent.model,
      max_tokens: 4096,
      system: systemMessage?.content,
      messages: conversationMessages,
      tools: tools?.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      })),
      temperature: this.config.agent.temperature,
    });

    const toolCalls = response.content
      .filter((c: any) => c.type === 'tool_use')
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        arguments: c.input
      }));

    const textContent = response.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');

    return {
      content: textContent,
      toolCalls,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens
    };
  }

  private async chatGoogle(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    const model = this.google!.getGenerativeModel({ model: this.config.agent.model });

    // Convert to Gemini format
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({ history });
    const lastMessage = messages[messages.length - 1];

    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    return {
      content: response.text(),
      toolCalls: [], // Gemini tool calling is more complex, simplified here
      tokensUsed: 0 // Gemini doesn't return token counts easily
    };
  }
}
