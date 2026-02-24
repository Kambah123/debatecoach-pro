# 🌞 Solaire - Autonomous AI Agent for Solana

**Light-speed automation for Solana communities**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-blue)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

Solaire is an autonomous AI agent that operates as a real Telegram user (not a bot) to make Solana blockchain operations accessible through natural language. Built for the Superteam Nigeria Grant.

## ✨ Features

- **🔐 Self-Custody Wallet**: Full Solana wallet with SPL token support
- **💱 Jupiter Integration**: Best-rate swaps with slippage protection
- **🧠 Persistent Memory**: Remembers conversations and user preferences
- **🏦 DAO Tools**: Treasury management, payroll, proposals
- **⚡ Fast**: Sub-second Solana finality
- **🛡️ Secure**: Policy-based access, encrypted keys, input sanitization

## 🚀 Quick Start

```bash
# Install globally
npm install -g solaire

# Run interactive setup
solaire setup

# Start the agent
solaire start
```

## 🏗️ Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Telegram   │────▶│    Agent    │────▶│   Solana    │
│   (GramJS)  │◀────│   Runtime   │◀────│   Wallet    │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │    Tools    │
                    │  ┌───────┐  │
                    │  │Wallet │  │
                    │  │Jupiter│  │
                    │  │ DAO   │  │
                    │  └───────┘  │
                    └─────────────┘
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Blockchain | @solana/web3.js, @solana/spl-token |
| Telegram | GramJS (MTProto) |
| LLM | OpenAI, Anthropic, Google, Groq |
| Database | better-sqlite3 + sqlite-vec |
| Language | TypeScript 5.7, Node.js 20+ |

## 📚 Documentation

- [Getting Started](docs/GETTING_STARTED.md)
- [Configuration](docs/CONFIGURATION.md)
- [Plugin Development](docs/PLUGINS.md)
- [API Reference](docs/API.md)

## 🤝 Grant Alignment

This project is built for the **Superteam Nigeria Solana Foundation Grant**:

- ✅ **Developer Tooling**: Natural language interface for Solana
- ✅ **DAO Tooling**: Treasury and payroll management
- ✅ **Payments**: P2P transfers and commerce integration
- ✅ **Decentralization**: Self-custody, open source

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Superteam Nigeria for the grant opportunity
- Solana Foundation for ecosystem support
- Jupiter for DEX aggregation
- Teleton for architectural inspiration

---

**Built with 💚 in Nigeria for the world**
