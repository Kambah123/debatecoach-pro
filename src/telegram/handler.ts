import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessageEvent } from 'telegram/events/index.js';
import { Config } from '../config/schema.js';
import { Logger } from '../utils/logger.js';
import { AgentRuntime } from '../agent/runtime.js';
import { WalletService } from '../solana/wallet.js';

export class TelegramHandler {
  private client: TelegramClient;
  private logger: Logger;
  private agent: AgentRuntime;
  private wallet: WalletService;
  private config: Config;
  private messageQueue: Map<string, Array<{ text: string; time: number }>> = new Map();

  constructor(config: Config, agent: AgentRuntime, wallet: WalletService) {
    this.config = config;
    this.agent = agent;
    this.wallet = wallet;
    this.logger = new Logger('TelegramHandler');

    const session = new StringSession(config.telegram.sessionString || '');
    this.client = new TelegramClient(
      session,
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 5,
      }
    );
  }

  async initialize(): Promise<void> {
    await this.client.start({
      phoneNumber: this.config.telegram.phone,
      phoneCode: async () => {
        // In production, prompt user or use saved session
        this.logger.info('Waiting for phone code...');
        return '';
      },
      onError: (err) => this.logger.error('Telegram error:', err),
    });

    // Save session string for future use
    const sessionString = this.client.session.save() as unknown as string;
    this.logger.info('Session string (save this):', sessionString.substring(0, 20) + '...');

    // Add event handlers
    this.client.addEventHandler(
      (event) => this.handleMessage(event),
      new NewMessageEvent({})
    );

    this.logger.info('Telegram handler initialized');
  }

  private async handleMessage(event: NewMessageEvent): Promise<void> {
    try {
      const message = event.message;
      const chat = await message.getChat();
      const sender = await message.getSender();

      // Skip if no message text
      if (!message.text) return;

      const chatId = chat.id.toString();
      const userId = sender?.id.toString() || 'unknown';
      const text = message.text;

      // Check policies
      if (!this.shouldProcessMessage(chat, sender, text)) {
        return;
      }

      // Debounce group messages
      if (chat.className === 'Channel' || chat.className === 'Chat') {
        await this.debounceGroupMessage(chatId, text, async (batchedText) => {
          await this.processUserMessage(userId, batchedText, chatId);
        });
      } else {
        // Direct message - process immediately
        await this.processUserMessage(userId, text, chatId);
      }
    } catch (error) {
      this.logger.error('Error handling message:', error);
    }
  }

  private shouldProcessMessage(chat: any, sender: any, text: string): boolean {
    // Check if sender is admin
    const senderId = parseInt(sender?.id?.toString() || '0');
    const isAdmin = this.config.telegram.adminIds.includes(senderId);

    // Check DM policy
    if (chat.className === 'User') {
      switch (this.config.telegram.dmPolicy) {
        case 'disabled':
          return false;
        case 'allowlist':
          return isAdmin;
        case 'pairing':
          // Would check if user is paired
          return true;
        case 'open':
        default:
          return true;
      }
    }

    // Check group policy
    if (chat.className === 'Channel' || chat.className === 'Chat') {
      switch (this.config.telegram.groupPolicy) {
        case 'disabled':
          return false;
        case 'allowlist':
          return isAdmin;
        case 'open':
        default:
          // Check for mention if required
          if (this.config.telegram.requireMention) {
            const me = this.client.getMe();
            const username = (me as any)?.username || 'solaire';
            return text.includes(`@${username}`) || text.toLowerCase().includes('solaire');
          }
          return true;
      }
    }

    return false;
  }

  private async debounceGroupMessage(
    chatId: string,
    text: string,
    callback: (text: string) => Promise<void>
  ): Promise<void> {
    // Add to queue
    if (!this.messageQueue.has(chatId)) {
      this.messageQueue.set(chatId, []);
    }

    const queue = this.messageQueue.get(chatId)!;
    queue.push({ text, time: Date.now() });

    // Wait for debounce period
    await new Promise(resolve => setTimeout(resolve, this.config.telegram.debounceMs));

    // Process if this is still the latest message
    const currentQueue = this.messageQueue.get(chatId);
    if (currentQueue && currentQueue[currentQueue.length - 1].text === text) {
      const batched = currentQueue.map(m => m.text).join('\n');
      this.messageQueue.delete(chatId);
      await callback(batched);
    }
  }

  private async processUserMessage(
    userId: string,
    text: string,
    chatId: string
  ): Promise<void> {
    this.logger.info(`Processing message from ${userId}: ${text.substring(0, 50)}...`);

    // Handle admin commands
    if (text.startsWith('/')) {
      const handled = await this.handleCommand(userId, text, chatId);
      if (handled) return;
    }

    // Get wallet context
    const walletInfo = await this.wallet.getBalance().catch(() => null);

    // Process through agent
    const response = await this.agent.processMessage(userId, text, {
      walletAddress: walletInfo?.address,
      balance: walletInfo?.balance,
    });

    // Send response
    await this.sendMessage(chatId, response.content);
  }

  private async handleCommand(
    userId: string,
    text: string,
    chatId: string
  ): Promise<boolean> {
    const senderId = parseInt(userId);
    const isAdmin = this.config.telegram.adminIds.includes(senderId);

    const [command, ...args] = text.slice(1).split(' ');

    switch (command.toLowerCase()) {
      case 'ping':
        await this.sendMessage(chatId, '🟢 Pong! Solaire is alive.');
        return true;

      case 'status':
        const walletInfo = await this.wallet.getBalance().catch(() => null);
        const status = `
🤖 **Solaire Status**

**Agent:** Online
**Model:** ${this.config.agent.model}
**Wallet:** ${walletInfo ? walletInfo.address.slice(0, 8) + '...' : 'Not connected'}
**Balance:** ${walletInfo ? walletInfo.balance.toFixed(4) : 0} SOL
**Network:** Mainnet
        `.trim();
        await this.sendMessage(chatId, status);
        return true;

      case 'wallet':
        const info = await this.wallet.getBalance();
        const tokens = info.tokens.map(t => 
          `• ${t.symbol}: ${t.amount.toFixed(4)}${t.usdValue ? ` ($${t.usdValue.toFixed(2)})` : ''}`
        ).join('\n') || 'No tokens';

        await this.sendMessage(chatId, `
💳 **Wallet:** \`${info.address}\`

**SOL Balance:** ${info.balance.toFixed(4)} SOL

**Tokens:**
${tokens}
        `.trim());
        return true;

      case 'help':
        await this.sendMessage(chatId, `
🆘 **Solaire Commands**

**User Commands:**
/ping - Check if bot is alive
/status - Show system status
/wallet - Show wallet info
/help - Show this help

**Admin Commands:**
/model <name> - Switch LLM model
/policy <dm|group> <value> - Change policies
/pause - Pause the agent
/resume - Resume the agent
/stop - Emergency shutdown
        `.trim());
        return true;

      // Admin-only commands
      case 'model':
        if (!isAdmin) return false;
        await this.sendMessage(chatId, `Model switching not implemented yet`);
        return true;

      case 'pause':
        if (!isAdmin) return false;
        await this.sendMessage(chatId, '⏸️ Agent paused');
        return true;

      case 'stop':
        if (!isAdmin) return false;
        await this.sendMessage(chatId, '🛑 Shutting down...');
        process.exit(0);

      default:
        return false;
    }
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      await this.client.sendMessage(chatId, { message: text, parseMode: 'markdown' });
    } catch (error) {
      this.logger.error('Failed to send message:', error);
    }
  }

  async shutdown(): Promise<void> {
    await this.client.disconnect();
    this.logger.info('Telegram handler shutdown');
  }
}
