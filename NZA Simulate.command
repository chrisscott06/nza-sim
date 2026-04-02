#!/bin/bash

# ==========================================
#   NZA Simulate — Double-click to launch
# ==========================================

PROJECT_DIR="$HOME/Dev/nza-sim"

# Kill any stale processes on our ports
lsof -ti:8002 | xargs kill -9 2>/dev/null
lsof -ti:5176 | xargs kill -9 2>/dev/null

# Start backend
cd "$PROJECT_DIR"
python3 -m uvicorn api.main:app --host 127.0.0.1 --port 8002 &
BACKEND_PID=$!

# Wait for backend
sleep 3

# Start frontend
cd "$PROJECT_DIR/frontend"
npx vite --host 127.0.0.1 --port 5176 &
FRONTEND_PID=$!

# Wait for frontend
sleep 4

# Open browser
open http://127.0.0.1:5176

echo ""
echo "  NZA Simulate is running."
echo "  Close this window to stop the servers."
echo ""

# Keep running until the window is closed
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
