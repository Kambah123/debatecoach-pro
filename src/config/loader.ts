import { parse } from 'yaml';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ConfigSchema, Config } from './schema.js';
import dotenv from 'dotenv';

dotenv.config();

const SOLAIRE_HOME = process.env.SOLAIRE_HOME || join(homedir(), '.solaire');

export function loadConfig(): Config {
  const configPath = join(SOLAIRE_HOME, 'config.yaml');

  let fileConfig = {};
  if (existsSync(configPath)) {
    const file = readFileSync(configPath, 'utf-8');
    fileConfig = parse(file) || {};
  }

  // Merge with environment variables (env takes precedence)
  const config = {
    agent: {
      provider: process.env.DEFAULT_PROVIDER || fileConfig.agent?.provider || 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || fileConfig.agent?.apiKey,
      model: process.env.DEFAULT_MODEL || fileConfig.agent?.model || 'claude-3-5-sonnet-20241022',
      utilityModel: process.env.UTILITY_MODEL || fileConfig.agent?.utilityModel || 'claude-3-5-haiku-20241022',
      maxIterations: fileConfig.agent?.maxIterations || 5,
      temperature: fileConfig.agent?.temperature || 0.7,
    },
    telegram: {
      apiId: parseInt(process.env.TELEGRAM_API_ID || '0') || fileConfig.telegram?.apiId,
      apiHash: process.env.TELEGRAM_API_HASH || fileConfig.telegram?.apiHash,
      phone: process.env.TELEGRAM_PHONE || fileConfig.telegram?.phone,
      sessionString: process.env.TELEGRAM_SESSION_STRING || fileConfig.telegram?.sessionString,
      dmPolicy: process.env.TELEGRAM_DM_POLICY || fileConfig.telegram?.dmPolicy || 'open',
      groupPolicy: process.env.TELEGRAM_GROUP_POLICY || fileConfig.telegram?.groupPolicy || 'allowlist',
      requireMention: fileConfig.telegram?.requireMention ?? true,
      adminIds: fileConfig.telegram?.adminIds || [parseInt(process.env.ADMIN_USER_ID || '0')].filter(Boolean),
      debounceMs: fileConfig.telegram?.debounceMs || 1500,
      botToken: process.env.BOT_TOKEN || fileConfig.telegram?.botToken,
      botUsername: process.env.BOT_USERNAME || fileConfig.telegram?.botUsername,
    },
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL || fileConfig.solana?.rpcUrl || 'https://api.mainnet-beta.solana.com',
      privateKey: process.env.SOLANA_PRIVATE_KEY || fileConfig.solana?.privateKey,
      heliusApiKey: process.env.HELIUS_API_KEY || fileConfig.solana?.heliusApiKey,
      jupiterReferralKey: process.env.JUPITER_REFERRAL_KEY || fileConfig.solana?.jupiterReferralKey,
      commitment: fileConfig.solana?.commitment || 'confirmed',
    },
    memory: {
      databaseUrl: process.env.DATABASE_URL || fileConfig.memory?.databaseUrl || `file:${SOLAIRE_HOME}/solaire.db`,
      vectorDimension: fileConfig.memory?.vectorDimension || 384,
      maxContextTokens: fileConfig.memory?.maxContextTokens || 8000,
      compactionThreshold: fileConfig.memory?.compactionThreshold || 6000,
    },
    webui: {
      enabled: process.env.WEBUI_ENABLED === 'true' || fileConfig.webui?.enabled || false,
      port: parseInt(process.env.WEBUI_PORT || '0') || fileConfig.webui?.port || 7777,
      host: process.env.WEBUI_HOST || fileConfig.webui?.host || '127.0.0.1',
      token: process.env.WEBUI_TOKEN || fileConfig.webui?.token,
    },
    features: {
      swapsEnabled: fileConfig.features?.swapsEnabled ?? true,
      paymentsEnabled: fileConfig.features?.paymentsEnabled ?? true,
      daoToolsEnabled: fileConfig.features?.daoToolsEnabled ?? true,
      scheduledTasksEnabled: fileConfig.features?.scheduledTasksEnabled ?? true,
      webSearchEnabled: fileConfig.features?.webSearchEnabled ?? false,
    },
  };

  return ConfigSchema.parse(config);
}

export { SOLAIRE_HOME };
