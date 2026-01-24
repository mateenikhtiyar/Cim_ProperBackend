const { MongoClient } = require('mongodb');

// MongoDB connection string from .env
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cimamplify';

async function diagnoseRequestAccepted() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const dealsCollection = db.collection('deals');
    const buyersCollection = db.collection('buyers');
    
    // Find the specific buyers mentioned
    const targetEmails = [
      'bkingsriter@pinecrestcap.com',
      'leigh.lommen@winterfellinvestments.com', 
      'dustin.graham@ddgintl.com',
      'investments@sundial.io'
    ];
    
    const buyers = await buyersCollection.find({
      email: { $in: targetEmails }
    }).toArray();
    
    console.log('\n--- Target Buyers ---');
    const buyerMap = {};
    buyers.forEach(buyer => {
      buyerMap[buyer._id.toString()] = buyer;
      console.log(`${buyer.fullName} (${buyer.email}) - ID: ${buyer._id}`);
    });
    
    // Find marketplace deals and check invitation status for these buyers
    console.log('\n--- Checking Marketplace Deals ---');
    const marketplaceDeals = await dealsCollection.find({
      isPublic: true,
      invitationStatus: { $exists: true }
    }).toArray();
    
    console.log(`Found ${marketplaceDeals.length} marketplace deals`);
    
    let foundIssues = 0;
    for (const deal of marketplaceDeals) {
      for (const [buyerId, invitation] of Object.entries(deal.invitationStatus || {})) {
        if (buyerMap[buyerId]) {
          const buyer = buyerMap[buyerId];
          console.log(`\nDeal: ${deal.title}`);
          console.log(`Buyer: ${buyer.fullName} (${buyer.email})`);
          console.log(`Status: ${invitation.response}`);
          console.log(`Notes: ${invitation.notes || 'No notes'}`);
          console.log(`Decision by: ${invitation.decisionBy || 'Not set'}`);
          console.log(`Responded at: ${invitation.respondedAt || 'Not set'}`);
          
          // Check if this buyer should be active but isn't
          if (invitation.response !== 'accepted') {
            console.log(`❌ ISSUE: Buyer should be active but status is: ${invitation.response}`);
            foundIssues++;
          }
        }
      }
    }
    
    console.log(`\n--- Summary ---`);
    console.log(`Found ${foundIssues} buyers that need to be fixed`);
    
    if (foundIssues > 0) {
      console.log('\nWould you like to fix these? Creating fix script...');
      
      // Now fix them
      for (const deal of marketplaceDeals) {
        let needsUpdate = false;
        const updates = {};
        
        for (const [buyerId, invitation] of Object.entries(deal.invitationStatus || {})) {
          if (buyerMap[buyerId] && invitation.response !== 'accepted') {
            console.log(`Fixing ${buyerMap[buyerId].fullName} in deal "${deal.title}"`);
            updates[`invitationStatus.${buyerId}.response`] = 'accepted';
            updates[`invitationStatus.${buyerId}.respondedAt`] = new Date();
            updates[`invitationStatus.${buyerId}.decisionBy`] = 'admin';
            updates[`invitationStatus.${buyerId}.notes`] = 'Request accepted - moved to active by admin';
            needsUpdate = true;
          }
        }
        
        if (needsUpdate) {
          updates['timeline.updatedAt'] = new Date();
          
          // Also ensure they're in interestedBuyers array
          const buyerIdsToAdd = Object.keys(updates)
            .filter(key => key.includes('invitationStatus') && key.includes('response'))
            .map(key => key.split('.')[1]);
          
          await dealsCollection.updateOne(
            { _id: deal._id },
            { 
              $set: updates,
              $addToSet: { 
                interestedBuyers: { $each: buyerIdsToAdd },
                everActiveBuyers: { $each: buyerIdsToAdd }
              }
            }
          );
          
          console.log(`✅ Fixed deal: ${deal.title}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the diagnosis and fix
diagnoseRequestAccepted();