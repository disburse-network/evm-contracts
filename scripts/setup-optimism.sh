#!/bin/bash

# Setup script for real Optimism mainnet transactions

echo "🚀 Setting up environment for real Optimism mainnet transactions"
echo ""

# Set environment variables
export SRC_CHAIN_RPC=https://optimism.publicnode.com
export DST_CHAIN_RPC=https://bsc-dataseed1.binance.org
export SRC_CHAIN_CREATE_FORK=false
export DST_CHAIN_CREATE_FORK=true

echo "✅ Environment variables set:"
echo "   SRC_CHAIN_RPC: $SRC_CHAIN_RPC"
echo "   DST_CHAIN_RPC: $DST_CHAIN_RPC"
echo "   SRC_CHAIN_CREATE_FORK: $SRC_CHAIN_CREATE_FORK"
echo "   DST_CHAIN_CREATE_FORK: $DST_CHAIN_CREATE_FORK"
echo "   OPTIMISM_PRIVATE_KEY: [HIDDEN]"
echo "   OPTIMISM_RESOLVER_PRIVATE_KEY: [HIDDEN]"
echo ""
echo "📋 The test will deploy contracts on Optimism mainnet on-the-fly"
echo ""

echo "⚠️  WARNING: This will execute real transactions on Optimism mainnet!"
echo "   Make sure your wallets have sufficient USDC and ETH for gas fees."
echo ""

read -p "Do you want to proceed with real transactions? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Running tests with real Optimism transactions..."
    pnpm test
else
    echo "Setup cancelled. You can run 'pnpm test' manually when ready."
fi 