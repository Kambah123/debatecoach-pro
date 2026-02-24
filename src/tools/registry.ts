import { Config } from '../config/schema.js';
import { Logger } from '../utils/logger.js';
import { WalletService } from '../solana/wallet.js';
import { JupiterService } from '../solana/jupiter.js';

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: Record<string, any>) => Promise<ToolResult>;
  category: string;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private logger: Logger;
  private wallet?: WalletService;
  private jupiter?: JupiterService;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger('ToolRegistry');
  }

  async initialize(): Promise<void> {
    this.wallet = new WalletService(this.config);
    this.jupiter = new JupiterService(this.config);

    this.registerCoreTools();
    this.registerSolanaTools();
    this.registerJupiterTools();
    this.registerDAOTools();

    this.logger.info(`Registered ${this.tools.size} tools`);
  }

  private registerCoreTools(): void {
    this.register({
      name: 'get_time',
      description: 'Get current time in various formats',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Timezone (e.g., Africa/Lagos)' }
        }
      },
      category: 'core',
      execute: async (args) => {
        const timezone = args.timezone || 'Africa/Lagos';
        return {
          success: true,
          data: { time: new Date().toISOString(), timezone }
        };
      }
    });

    this.register({
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to evaluate' }
        },
        required: ['expression']
      },
      category: 'core',
      execute: async (args) => {
        try {
          const result = Function('"use strict"; return (' + args.expression + ')')();
          return { success: true, data: { result } };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }
    });
  }

  private registerSolanaTools(): void {
    this.register({
      name: 'get_wallet_balance',
      description: 'Get SOL and SPL token balances for the agent wallet',
      parameters: { type: 'object', properties: {} },
      category: 'wallet',
      execute: async () => {
        try {
          const info = await this.wallet!.getBalance();
          return { success: true, data: info };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }
    });

    this.register({
      name: 'send_sol',
      description: 'Send SOL to another address',
      parameters: {
        type: 'object',
        properties: {
          toAddress: { type: 'string', description: 'Recipient Solana address' },
          amount: { type: 'number', description: 'Amount of SOL to send' }
        },
        required: ['toAddress', 'amount']
      },
      category: 'wallet',
      execute: async (args) => {
        const result = await this.wallet!.sendSOL(args.toAddress, args.amount);
        return { success: result.success, data: result, error: result.error };
      }
    });

    this.register({
      name: 'send_token',
      description: 'Send SPL tokens (USDC, BONK, etc.) to another address',
      parameters: {
        type: 'object',
        properties: {
          mintAddress: { type: 'string', description: 'Token mint address' },
          toAddress: { type: 'string', description: 'Recipient address' },
          amount: { type: 'number', description: 'Token amount' }
        },
        required: ['mintAddress', 'toAddress', 'amount']
      },
      category: 'wallet',
      execute: async (args) => {
        const result = await this.wallet!.sendSPLToken(
          args.mintAddress,
          args.toAddress,
          args.amount
        );
        return { success: result.success, data: result, error: result.error };
      }
    });

    this.register({
      name: 'validate_address',
      description: 'Check if a Solana address is valid',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Address to validate' }
        },
        required: ['address']
      },
      category: 'wallet',
      execute: async (args) => {
        const isValid = this.wallet!.validateAddress(args.address);
        return { success: true, data: { isValid, address: args.address } };
      }
    });
  }

  private registerJupiterTools(): void {
    this.register({
      name: 'get_swap_quote',
      description: 'Get a swap quote from Jupiter DEX',
      parameters: {
        type: 'object',
        properties: {
          inputMint: { type: 'string', description: 'Input token mint' },
          outputMint: { type: 'string', description: 'Output token mint' },
          amount: { type: 'number', description: 'Input amount' },
          slippageBps: { type: 'number', description: 'Slippage in basis points', default: 50 }
        },
        required: ['inputMint', 'outputMint', 'amount']
      },
      category: 'dex',
      execute: async (args) => {
        const quote = await this.jupiter!.getQuote(
          args.inputMint,
          args.outputMint,
          args.amount,
          args.slippageBps
        );
        return { success: !!quote, data: quote };
      }
    });

    this.register({
      name: 'get_token_price',
      description: 'Get current price of a token in USD',
      parameters: {
        type: 'object',
        properties: {
          mintAddress: { type: 'string', description: 'Token mint address' }
        },
        required: ['mintAddress']
      },
      category: 'dex',
      execute: async (args) => {
        const price = await this.jupiter!.getPrice(args.mintAddress);
        return { success: !!price, data: { price, mint: args.mintAddress } };
      }
    });
  }

  private registerDAOTools(): void {
    this.register({
      name: 'create_payment_proposal',
      description: 'Create a DAO treasury payment proposal',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'Recipient address' },
          amount: { type: 'number', description: 'Amount in SOL' },
          description: { type: 'string', description: 'Purpose of payment' }
        },
        required: ['recipient', 'amount', 'description']
      },
      category: 'dao',
      execute: async (args) => {
        return {
          success: true,
          data: {
            proposalId: `prop_${Date.now()}`,
            status: 'pending_votes',
            ...args
          }
        };
      }
    });

    this.register({
      name: 'schedule_recurring_payment',
      description: 'Schedule a recurring payment (e.g., payroll)',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string', description: 'Recipient address' },
          amount: { type: 'number', description: 'Amount per payment' },
          frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
          startDate: { type: 'string', description: 'ISO date string' }
        },
        required: ['recipient', 'amount', 'frequency']
      },
      category: 'dao',
      execute: async (args) => {
        return {
          success: true,
          data: {
            scheduleId: `sched_${Date.now()}`,
            nextPayment: args.startDate || new Date().toISOString(),
            ...args
          }
        };
      }
    });
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  async getRelevantTools(query: string): Promise<Tool[]> {
    const keywords = query.toLowerCase().split(' ');
    const relevant = this.getAll().filter(tool => {
      const text = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
      return keywords.some(k => text.includes(k));
    });
    return relevant.slice(0, 10);
  }

  async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool ${name} not found` };
    }
    try {
      return await tool.execute(args);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
