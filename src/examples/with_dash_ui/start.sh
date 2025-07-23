#!/bin/bash

# BreezeQ Dashboard Example Startup Script
# This script installs dependencies and starts the complete dashboard example

set -e

echo "🚀 Starting BreezeQ Dashboard Example"
echo "====================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the src/examples/with_dash_ui directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
if command -v pnpm >/dev/null 2>&1; then
    pnpm install
else
    echo "⚠️  pnpm not found, using npm instead..."
    npm install
fi

echo ""
echo "✅ Dependencies installed successfully"
echo ""

# Check if tsx is available
if ! command -v tsx >/dev/null 2>&1 && ! npx tsx --version >/dev/null 2>&1; then
    echo "❌ Error: tsx is required but not found. Please install it:"
    echo "   npm install -g tsx"
    echo "   or"
    echo "   pnpm add -g tsx"
    exit 1
fi

echo "🎯 Starting all services..."
echo "📊 Dashboard will be available at: http://localhost:3000"
echo "🔧 Use Ctrl+C to stop all services"
echo ""

# Start the application
if command -v pnpm >/dev/null 2>&1; then
    exec pnpm start
else
    exec npm start
fi
