#!/bin/bash

echo "🌞 Solaire Installer"
echo "===================="

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Node.js 20+ required. Found: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create directories
mkdir -p logs data

# Build
echo "🔨 Building..."
npm run build

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and fill in your keys"
echo "2. Run: npm run setup"
echo "3. Start: npm start"
echo ""
echo "For help: npm start -- --help"
