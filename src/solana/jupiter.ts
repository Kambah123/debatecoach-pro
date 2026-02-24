import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Config } from '../config/schema.js';
import { Logger } from '../utils/logger.js';

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  otherAmountThreshold: number;
  swapMode: string;
  slippageBps: number;
  platformFee: number | null;
  priceImpactPct: number;
  routePlan: any[];
  contextSlot: number;
  timeTaken: number;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  explorerUrl?: string;
  error?: string;
}

export class JupiterService {
  private connection: Connection;
  private logger: Logger;
  private referralKey?: string;

  constructor(private config: Config) {
    this.connection = new Connection(config.solana.rpcUrl);
    this.logger = new Logger('JupiterService');
    this.referralKey = config.solana.jupiterReferralKey;
  }

  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 50
  ): Promise<SwapQuote | null> {
    try {
      // Convert amount to raw amount (assuming 9 decimals for SOL, would need adjustment)
      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.status}`);
      }

      const quote = await response.json();
      return quote;
    } catch (error) {
      this.logger.error('Failed to get Jupiter quote:', error);
      return null;
    }
  }

  async executeSwap(
    quote: SwapQuote,
    userPublicKey: string,
    wrapUnwrapSOL: boolean = true
  ): Promise<SwapResult> {
    try {
      // Get swap transaction from Jupiter
      const swapUrl = 'https://quote-api.jup.ag/v6/swap';

      const body: any = {
        quoteResponse: quote,
        userPublicKey,
        wrapUnwrapSOL,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      };

      if (this.referralKey) {
        body.referralAccount = this.referralKey;
        body.referralFeeBps = 20; // 0.2%
      }

      const response = await fetch(swapUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Jupiter swap API error: ${response.status}`);
      }

      const { swapTransaction } = await response.json();

      // Deserialize and sign transaction
      const transaction = VersionedTransaction.deserialize(
        Buffer.from(swapTransaction, 'base64')
      );

      // Note: In actual implementation, this would be signed by the wallet service
      // This is a simplified version

      return {
        success: true,
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
        priceImpact: quote.priceImpactPct,
        signature: 'placeholder', // Would be actual signature
        explorerUrl: `https://explorer.solana.com/tx/placeholder`
      };
    } catch (error: any) {
      this.logger.error('Jupiter swap failed:', error);
      return {
        success: false,
        inputAmount: 0,
        outputAmount: 0,
        priceImpact: 0,
        error: error.message
      };
    }
  }

  async getTokenList(): Promise<any[]> {
    try {
      const response = await fetch('https://token.jup.ag/all');
      return await response.json();
    } catch (error) {
      this.logger.error('Failed to get token list:', error);
      return [];
    }
  }

  async getPrice(tokenMint: string): Promise<number | null> {
    try {
      const response = await fetch(`https://price.jup.ag/v4/price?ids=${tokenMint}`);
      const data = await response.json();
      return data.data[tokenMint]?.price || null;
    } catch (error) {
      this.logger.error('Failed to get price:', error);
      return null;
    }
  }
}
