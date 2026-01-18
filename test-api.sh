#!/bin/bash

# Test script for the SIP Optimization API

BASE_URL="http://localhost:3000/api"

echo "Testing API endpoints..."
echo ""

# Test health endpoint
echo "1. Testing GET /api/health"
curl -s "$BASE_URL/health" | jq .
echo ""
echo ""

# Test Method 1 info
echo "2. Testing GET /api/plan/method1"
curl -s "$BASE_URL/plan/method1" | jq .
echo ""
echo ""

# Test Method 1 with example data
echo "3. Testing POST /api/plan/method1"
curl -s -X POST "$BASE_URL/plan/method1" \
  -H "Content-Type: application/json" \
  -d @example-request.json | jq . | head -50
echo ""
echo ""

echo "Done! Check the output above for results."
