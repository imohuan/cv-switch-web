#!/bin/bash
# CC Switch Web - Startup Script
# Starts both backend (Express) and frontend (Vite dev server)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[CC Switch Web] Starting services...${NC}"

# Start backend
echo -e "${BLUE}[CC Switch Web] Starting backend on port 3120...${NC}"
cd "$SCRIPT_DIR/backend"
npx tsx src/index.ts &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 2

# Start frontend
echo -e "${BLUE}[CC Switch Web] Starting frontend on port 5210...${NC}"
cd "$SCRIPT_DIR/frontend"
npx vite --host 0.0.0.0 --port 5210 &
FRONTEND_PID=$!

echo -e "${GREEN}[CC Switch Web] Backend: http://localhost:3120${NC}"
echo -e "${GREEN}[CC Switch Web] Frontend: http://localhost:5210${NC}"
echo -e "${GREEN}[CC Switch Web] Press Ctrl+C to stop${NC}"

# Cleanup on exit
cleanup() {
  echo -e "\n${BLUE}[CC Switch Web] Shutting down...${NC}"
  kill $FRONTEND_PID 2>/dev/null || true
  kill $BACKEND_PID 2>/dev/null || true
  wait
  echo -e "${GREEN}[CC Switch Web] Stopped.${NC}"
}

trap cleanup EXIT INT TERM

# Wait for either process to exit
wait
