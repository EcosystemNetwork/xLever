#!/bin/bash
# xLever Trading Skill — Setup
# Installs Python dependencies needed for the xlever_cli.py helper.

set -e

echo "Installing xLever trading skill dependencies..."

pip install eth-account 2>/dev/null || pip3 install eth-account 2>/dev/null

echo ""
echo "Setup complete! To use the skill:"
echo ""
echo "  1. Set your wallet private key:"
echo "     export XLEVER_PRIVATE_KEY=0xYourPrivateKeyHere"
echo ""
echo "  2. Test with a risk check:"
echo "     python3 $(dirname "$0")/xlever_cli.py risk"
echo ""
echo "  3. Check your policy mode:"
echo "     python3 $(dirname "$0")/xlever_cli.py mode"
echo ""
echo "  4. Copy the skill to your OpenClaw workspace:"
echo "     cp -r $(dirname "$0") ~/.openclaw/workspace/skills/xlever-trading"
echo ""
echo "  5. Copy the heartbeat checklist:"
echo "     cp $(dirname "$0")/HEARTBEAT.md ~/.openclaw/workspace/HEARTBEAT.md"
echo ""
echo "  6. Restart OpenClaw and try: 'what is my risk state?'"
echo ""
echo "  Policy modes: safe | target | manual (default)"
echo "  Set mode:     python3 $(dirname "$0")/xlever_cli.py mode --set safe"
echo ""
