// Manual test script for email functionality
const fetch = require('node-fetch');
require('dotenv').config();

const API_BASE = process.env.BACKEND_URL || 'http://localhost:3001';

async function testEmailFunctionality() {
  console.log('=== MANUAL EMAIL TESTING ===\n');

  // You need to get an admin token first by logging in
  console.log('1. First, get an admin token by logging in:');
  console.log(`   POST ${API_BASE}/auth/admin/login`);
  console.log('   Body: { "email": "admin@example.com", "password": "your-password" }\n');

  console.log('2. Then use the token to test these endpoints:\n');

  // Test endpoints
  const testEndpoints = [
    {
      name: 'Test Profile Completion Reminder',
      method: 'POST',
      url: `${API_BASE}/admin/test/profile-completion-reminder`,
      description: 'Triggers profile completion reminder emails for eligible buyers'
    },
    {
      name: 'Get Incomplete Profile Buyers',
      method: 'GET', 
      url: `${API_BASE}/admin/buyers/incomplete-profiles`,
      description: 'Returns list of buyers with incomplete profiles'
    }
  ];

  testEndpoints.forEach((endpoint, index) => {
    console.log(`${index + 3}. ${endpoint.name}:`);
    console.log(`   ${endpoint.method} ${endpoint.url}`);
    console.log(`   Description: ${endpoint.description}`);
    console.log(`   Headers: { "Authorization": "Bearer YOUR_ADMIN_TOKEN" }\n`);
  });

  console.log('Example curl commands:');
  console.log('# Get admin token');
  console.log(`curl -X POST ${API_BASE}/auth/admin/login \\`);
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"email":"admin@example.com","password":"your-password"}\'\n');

  console.log('# Test profile completion reminder');
  console.log(`curl -X POST ${API_BASE}/admin/test/profile-completion-reminder \\`);
  console.log('  -H "Authorization: Bearer YOUR_TOKEN_HERE"\n');

  console.log('# Get incomplete profiles');
  console.log(`curl -X GET ${API_BASE}/admin/buyers/incomplete-profiles \\`);
  console.log('  -H "Authorization: Bearer YOUR_TOKEN_HERE"\n');

  console.log('=== DEBUGGING CHECKLIST ===');
  console.log('1. Check environment variables in .env file:');
  console.log('   - EMAIL_USER (Gmail address)');
  console.log('   - EMAIL_PASS (Gmail app password)');
  console.log('   - BACKEND_URL');
  console.log('   - FRONTEND_URL\n');

  console.log('2. Check server logs for cron job execution');
  console.log('3. Check database for buyers with incomplete profiles');
  console.log('4. Verify email credentials work with Gmail\n');

  console.log('Run this to debug database state:');
  console.log('node debug-email-issues.js\n');
}

testEmailFunctionality();