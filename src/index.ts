#!/usr/bin/env node
import { loadConfig, SOLAIRE_HOME } from './config/loader.js';
import { AgentRuntime } from './agent/runtime.js';
import { TelegramHandler } from './telegram/handler.js';
import { WalletService } from './solana/wallet.js';
import { Logger } from './utils/logger.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const logger = new Logger('Main');

async function main() {
  try {
    // Ensure directories exist
    if (!existsSync(SOLAIRE_HOME)) {
      mkdirSync(SOLAIRE_HOME, { recursive: true });
    }
    if (!existsSync('logs')) {
      mkdirSync('logs', { recursive: true });
    }

    logger.info('🌞 Starting Solaire...');
    logger.info(`Home directory: ${SOLAIRE_HOME}`);

    // Load configuration
    const config = loadConfig();
    logger.info(`Using LLM: ${config.agent.provider} / ${config.agent.model}`);

    // Initialize services
    const wallet = new WalletService(config);
    logger.info(`Wallet address: ${wallet.getAddress()}`);

    const agent = new AgentRuntime(config);
    await agent.initialize();
    logger.info('Agent runtime initialized');

    const telegram = new TelegramHandler(config, agent, wallet);
    await telegram.initialize();
    logger.info('Telegram handler initialized');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await telegram.shutdown();
      await agent.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    logger.info('✅ Solaire is running!');
    logger.info('Press Ctrl+C to stop');

    // Keep alive
    setInterval(() => {}, 1000);

  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
