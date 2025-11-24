// Simple test script to verify the incomplete profiles API
const fetch = require('node-fetch');

async function testIncompleteProfilesAPI() {
  try {
    // You'll need to replace this with a valid admin token
    const token = 'your-admin-token-here';
    
    const response = await fetch('https://api.cimamplify.com/admin/buyers/incomplete-profiles', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Incomplete profiles API response:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('Error testing API:', error.message);
  }
}

// Uncomment to run the test
// testIncompleteProfilesAPI();

console.log('Test script created. Update the token and uncomment the function call to test.');