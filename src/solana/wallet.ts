import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram,
  LAMPORTS_PER_SOL,
  clusterApiUrl 
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  getAccount,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';
import { Config } from '../config/schema.js';
import { Logger } from '../utils/logger.js';

export interface WalletInfo {
  address: string;
  balance: number;
  tokens: TokenBalance[];
}

export interface TokenBalance {
  mint: string;
  symbol: string;
  amount: number;
  decimals: number;
  usdValue?: number;
}

export interface TransferResult {
  success: boolean;
  signature?: string;
  error?: string;
  explorerUrl?: string;
}

export class WalletService {
  private connection: Connection;
  private keypair: Keypair;
  private logger: Logger;
  private heliusApiKey?: string;

  constructor(private config: Config) {
    this.connection = new Connection(
      config.solana.rpcUrl,
      config.solana.commitment
    );
    this.keypair = Keypair.fromSecretKey(bs58.decode(config.solana.privateKey));
    this.logger = new Logger('WalletService');
    this.heliusApiKey = config.solana.heliusApiKey;
  }

  getAddress(): string {
    return this.keypair.publicKey.toBase58();
  }

  async getBalance(): Promise<WalletInfo> {
    try {
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      const tokens = await this.getTokenBalances();

      return {
        address: this.getAddress(),
        balance: balance / LAMPORTS_PER_SOL,
        tokens
      };
    } catch (error) {
      this.logger.error('Failed to get balance:', error);
      throw error;
    }
  }

  private async getTokenBalances(): Promise<TokenBalance[]> {
    try {
      // Use Helius for enriched token data if available
      if (this.heliusApiKey) {
        const response = await fetch(
          `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'helius-test',
              method: 'searchAssets',
              params: {
                ownerAddress: this.getAddress(),
                tokenType: 'fungible',
                displayOptions: {
                  showNativeBalance: true,
                }
              }
            })
          }
        );

        const data = await response.json();
        if (data.result?.items) {
          return data.result.items.map((item: any) => ({
            mint: item.id,
            symbol: item.token_info?.symbol || 'Unknown',
            amount: item.token_info?.balance / Math.pow(10, item.token_info?.decimals || 0),
            decimals: item.token_info?.decimals || 0,
            usdValue: item.token_info?.price_info?.total_price
          }));
        }
      }

      // Fallback to basic SPL token accounts
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        this.keypair.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      return accounts.value.map(acc => {
        const parsed = acc.account.data.parsed.info;
        return {
          mint: parsed.mint,
          symbol: 'Unknown', // Would need token metadata
          amount: parsed.tokenAmount.uiAmount,
          decimals: parsed.tokenAmount.decimals,
        };
      });
    } catch (error) {
      this.logger.error('Failed to get token balances:', error);
      return [];
    }
  }

  async sendSOL(toAddress: string, amount: number): Promise<TransferResult> {
    try {
      const toPubkey = new PublicKey(toAddress);
      const lamports = amount * LAMPORTS_PER_SOL;

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.keypair.publicKey,
          toPubkey,
          lamports,
        })
      );

      const signature = await this.connection.sendTransaction(
        transaction,
        [this.keypair]
      );

      await this.connection.confirmTransaction(signature);

      return {
        success: true,
        signature,
        explorerUrl: `https://explorer.solana.com/tx/${signature}`
      };
    } catch (error: any) {
      this.logger.error('SOL transfer failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendSPLToken(
    mintAddress: string, 
    toAddress: string, 
    amount: number
  ): Promise<TransferResult> {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      const toPubkey = new PublicKey(toAddress);

      // Get sender token account
      const fromTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        this.keypair.publicKey
      );

      // Get or create receiver token account
      const toTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.keypair,
        mintPubkey,
        toPubkey
      );

      // Get mint info for decimals
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);
      const decimals = (mintInfo.value?.data as any)?.parsed?.info?.decimals || 6;
      const rawAmount = amount * Math.pow(10, decimals);

      const transaction = new Transaction().add(
        createTransferInstruction(
          fromTokenAccount,
          toTokenAccount.address,
          this.keypair.publicKey,
          rawAmount
        )
      );

      const signature = await this.connection.sendTransaction(
        transaction,
        [this.keypair]
      );

      await this.connection.confirmTransaction(signature);

      return {
        success: true,
        signature,
        explorerUrl: `https://explorer.solana.com/tx/${signature}`
      };
    } catch (error: any) {
      this.logger.error('SPL token transfer failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async requestAirdrop(amount: number = 1): Promise<TransferResult> {
    try {
      // Only works on devnet
      if (!this.config.solana.rpcUrl.includes('devnet')) {
        return {
          success: false,
          error: 'Airdrop only available on devnet'
        };
      }

      const signature = await this.connection.requestAirdrop(
        this.keypair.publicKey,
        amount * LAMPORTS_PER_SOL
      );

      await this.connection.confirmTransaction(signature);

      return {
        success: true,
        signature,
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  validateAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
}
