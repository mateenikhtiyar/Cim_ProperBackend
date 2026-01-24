#!/bin/bash

echo "Testing server connectivity..."

# Test direct server
echo "1. Testing direct server on port 3001:"
curl -v http://localhost:3001/deals/health 2>&1 | head -20

echo -e "\n2. Testing through domain:"
curl -v https://api.cimamplify.com/deals/health 2>&1 | head -20

echo -e "\n3. PM2 status:"
pm2 status

echo -e "\n4. Server logs:"
pm2 logs cim-backend --lines 10 --nostream