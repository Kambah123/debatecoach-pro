#!/bin/bash
# DebateCoach Pro - Google Cloud Run Deployment Script
# Usage: ./deploy.sh [PROJECT_ID]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${1:-$GOOGLE_CLOUD_PROJECT}
REGION="us-central1"
BACKEND_SERVICE="debatecoach-backend"
FRONTEND_SERVICE="debatecoach-frontend"

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: PROJECT_ID not provided${NC}"
    echo "Usage: ./deploy.sh [PROJECT_ID]"
    echo "Or set GOOGLE_CLOUD_PROJECT environment variable"
    exit 1
fi

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}DebateCoach Pro - Cloud Run Deployment${NC}"
echo -e "${BLUE}Project: $PROJECT_ID${NC}"
echo -e "${BLUE}Region: $REGION${NC}"
echo -e "${BLUE}=======================================${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI not found${NC}"
    echo "Please install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
echo -e "\n${YELLOW}Checking gcloud authentication...${NC}"
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo -e "${RED}Error: Not authenticated with gcloud${NC}"
    echo "Run: gcloud auth login"
    exit 1
fi

# Set project
echo -e "\n${YELLOW}Setting project to $PROJECT_ID...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "\n${YELLOW}Enabling required APIs...${NC}"
gcloud services enable run.googleapis.com
#gcloud services enable secretmanager.googleapis.com
#gcloud services enable cloudbuild.googleapis.com
#gcloud services enable logging.googleapis.com

# Check for Gemini API Key
echo -e "\n${YELLOW}Checking for Gemini API Key...${NC}"
if [ -z "$GEMINI_API_KEY" ]; then
    echo -e "${YELLOW}Warning: GEMINI_API_KEY environment variable not set${NC}"
    echo "The deployment will use a placeholder. Set it with:"
    echo "export GEMINI_API_KEY=your_api_key_here"
fi

# =============================================================================
# Deploy Backend
# =============================================================================
echo -e "\n${BLUE}=======================================${NC}"
echo -e "${BLUE}Deploying Backend Service${NC}"
echo -e "${BLUE}=======================================${NC}"

cd backend

echo -e "\n${YELLOW}Building backend container...${NC}"
gcloud builds submit --tag gcr.io/$PROJECT_ID/$BACKEND_SERVICE

echo -e "\n${YELLOW}Deploying backend to Cloud Run...${NC}"
gcloud run deploy $BACKEND_SERVICE \
    --image gcr.io/$PROJECT_ID/$BACKEND_SERVICE \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 2Gi \
    --cpu 2 \
    --max-instances 10 \
    --timeout 3600 \
    --session-affinity \
    --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,LOG_LEVEL=INFO" \
    --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY:-placeholder}" \
    --port 8080

BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region $REGION --format 'value(status.url)')
echo -e "${GREEN}Backend deployed: $BACKEND_URL${NC}"

cd ..

# =============================================================================
# Deploy Frontend
# =============================================================================
echo -e "\n${BLUE}=======================================${NC}"
echo -e "${BLUE}Deploying Frontend Service${NC}"
echo -e "${BLUE}=======================================${NC}"

cd frontend

# Update environment variable for build
echo -e "\n${YELLOW}Setting backend URL for frontend build...${NC}"
export VITE_BACKEND_URL=$BACKEND_URL

echo -e "\n${YELLOW}Building frontend container...${NC}"
gcloud builds submit --tag gcr.io/$PROJECT_ID/$FRONTEND_SERVICE

echo -e "\n${YELLOW}Deploying frontend to Cloud Run...${NC}"
gcloud run deploy $FRONTEND_SERVICE \
    --image gcr.io/$PROJECT_ID/$FRONTEND_SERVICE \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --max-instances 5 \
    --timeout 300 \
    --port 8080

FRONTEND_URL=$(gcloud run services describe $FRONTEND_SERVICE --region $REGION --format 'value(status.url)')
echo -e "${GREEN}Frontend deployed: $FRONTEND_URL${NC}"

cd ..

# =============================================================================
# Deployment Summary
# =============================================================================
echo -e "\n${GREEN}=======================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}=======================================${NC}"
echo -e "\n${BLUE}Services:${NC}"
echo -e "  Backend:  ${GREEN}$BACKEND_URL${NC}"
echo -e "  Frontend: ${GREEN}$FRONTEND_URL${NC}"
echo -e "\n${BLUE}Health Check:${NC}"
echo -e "  ${GREEN}$BACKEND_URL/health${NC}"
echo -e "\n${BLUE}API Endpoints:${NC}"
echo -e "  ${GREEN}$BACKEND_URL/personas${NC}"
echo -e "  ${GREEN}$BACKEND_URL/ws/debate${NC}"
echo -e "\n${YELLOW}Note: WebSocket connections use wss:// protocol${NC}"
echo -e "\n${GREEN}=======================================${NC}"

# Save deployment info
mkdir -p deploy-info
cat > deploy-info/latest.txt << EOF
Deployment Date: $(date)
Project: $PROJECT_ID
Region: $REGION
Backend: $BACKEND_URL
Frontend: $FRONTEND_URL
EOF

echo -e "Deployment info saved to deploy-info/latest.txt"
