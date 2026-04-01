#!/bin/bash
# xLever AI Trading Agent - Production Installation Script
# Run as root: sudo bash install.sh

set -e

echo "=========================================="
echo "xLever AI Trading Agent - Installation"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/xlever"
VENV_DIR="$INSTALL_DIR/venv"
LOG_DIR="/var/log/xlever"
SERVICE_USER="xlever"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (sudo bash install.sh)${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Creating system user...${NC}"
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /bin/false $SERVICE_USER
    echo -e "${GREEN}Created user: $SERVICE_USER${NC}"
else
    echo -e "${GREEN}User $SERVICE_USER already exists${NC}"
fi

echo -e "${YELLOW}Step 2: Creating directories...${NC}"
mkdir -p $INSTALL_DIR
mkdir -p $LOG_DIR
chown -R $SERVICE_USER:$SERVICE_USER $INSTALL_DIR
chown -R $SERVICE_USER:$SERVICE_USER $LOG_DIR
echo -e "${GREEN}Created $INSTALL_DIR and $LOG_DIR${NC}"

echo -e "${YELLOW}Step 3: Installing Python dependencies...${NC}"
apt-get update
apt-get install -y python3 python3-pip python3-venv
echo -e "${GREEN}Python installed${NC}"

echo -e "${YELLOW}Step 4: Creating virtual environment...${NC}"
python3 -m venv $VENV_DIR
source $VENV_DIR/bin/activate
pip install --upgrade pip
echo -e "${GREEN}Virtual environment created${NC}"

echo -e "${YELLOW}Step 5: Copying agent files...${NC}"
# Copy agent directory (run this from the repo root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_SRC="$(dirname "$SCRIPT_DIR")"
cp -r "$AGENT_SRC"/* $INSTALL_DIR/agent/ 2>/dev/null || {
    echo -e "${YELLOW}Please copy agent files manually to $INSTALL_DIR/agent/${NC}"
}

echo -e "${YELLOW}Step 6: Installing agent package...${NC}"
if [ -d "$INSTALL_DIR/agent" ]; then
    pip install -e "$INSTALL_DIR/agent"
    echo -e "${GREEN}Agent package installed${NC}"
else
    echo -e "${RED}Agent directory not found. Please copy files first.${NC}"
fi

echo -e "${YELLOW}Step 7: Setting up configuration...${NC}"
if [ ! -f "$INSTALL_DIR/agent/.env" ]; then
    if [ -f "$INSTALL_DIR/agent/.env.example" ]; then
        cp "$INSTALL_DIR/agent/.env.example" "$INSTALL_DIR/agent/.env"
        chmod 600 "$INSTALL_DIR/agent/.env"
        chown $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR/agent/.env"
        echo -e "${YELLOW}Created .env from example. Please edit: $INSTALL_DIR/agent/.env${NC}"
    fi
else
    echo -e "${GREEN}.env already exists${NC}"
fi

echo -e "${YELLOW}Step 8: Installing systemd services...${NC}"
cp "$SCRIPT_DIR/xlever-agent.service" /etc/systemd/system/
cp "$SCRIPT_DIR/xlever-api.service" /etc/systemd/system/
systemctl daemon-reload
echo -e "${GREEN}Systemd services installed${NC}"

echo -e "${YELLOW}Step 9: Setting permissions...${NC}"
chown -R $SERVICE_USER:$SERVICE_USER $INSTALL_DIR
chmod 755 $INSTALL_DIR
chmod -R 755 $VENV_DIR/bin
echo -e "${GREEN}Permissions set${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}Installation Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit configuration:"
echo "   sudo nano $INSTALL_DIR/agent/.env"
echo ""
echo "2. Start the agent:"
echo "   sudo systemctl start xlever-agent"
echo ""
echo "3. Start the API server:"
echo "   sudo systemctl start xlever-api"
echo ""
echo "4. Enable on boot:"
echo "   sudo systemctl enable xlever-agent xlever-api"
echo ""
echo "5. Check status:"
echo "   sudo systemctl status xlever-agent"
echo "   sudo systemctl status xlever-api"
echo ""
echo "6. View logs:"
echo "   sudo journalctl -u xlever-agent -f"
echo "   sudo tail -f $LOG_DIR/agent.log"
echo ""
echo -e "${YELLOW}IMPORTANT: Edit .env with your real API keys before starting!${NC}"
