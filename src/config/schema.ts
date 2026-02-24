import { z } from 'zod';

export const LLMProviderSchema = z.enum([
  'openai',
  'anthropic', 
  'google',
  'groq',
  'openrouter'
]);

export const TelegramPolicySchema = z.enum([
  'open',
  'allowlist',
  'pairing',
  'disabled'
]);

export const ConfigSchema = z.object({
  agent: z.object({
    provider: LLMProviderSchema,
    apiKey: z.string(),
    model: z.string(),
    utilityModel: z.string(),
    maxIterations: z.number().default(5),
    temperature: z.number().default(0.7),
  }),

  telegram: z.object({
    apiId: z.number(),
    apiHash: z.string(),
    phone: z.string(),
    sessionString: z.string().optional(),
    dmPolicy: TelegramPolicySchema.default('open'),
    groupPolicy: TelegramPolicySchema.default('allowlist'),
    requireMention: z.boolean().default(true),
    adminIds: z.array(z.number()),
    debounceMs: z.number().default(1500),
    botToken: z.string().optional(),
    botUsername: z.string().optional(),
  }),

  solana: z.object({
    rpcUrl: z.string(),
    privateKey: z.string(), // Base58
    heliusApiKey: z.string().optional(),
    jupiterReferralKey: z.string().optional(),
    commitment: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
  }),

  memory: z.object({
    databaseUrl: z.string(),
    vectorDimension: z.number().default(384),
    maxContextTokens: z.number().default(8000),
    compactionThreshold: z.number().default(6000),
  }),

  webui: z.object({
    enabled: z.boolean().default(false),
    port: z.number().default(7777),
    host: z.string().default('127.0.0.1'),
    token: z.string().optional(),
  }),

  features: z.object({
    swapsEnabled: z.boolean().default(true),
    paymentsEnabled: z.boolean().default(true),
    daoToolsEnabled: z.boolean().default(true),
    scheduledTasksEnabled: z.boolean().default(true),
    webSearchEnabled: z.boolean().default(false),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type LLMProvider = z.infer<typeof LLMProviderSchema>;
