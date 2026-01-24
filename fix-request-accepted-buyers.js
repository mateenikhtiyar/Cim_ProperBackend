const { MongoClient } = require('mongodb');

// MongoDB connection string from .env
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cimamplify';

async function fixRequestAcceptedBuyers() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const dealsCollection = db.collection('deals');
    const buyersCollection = db.collection('buyers');
    
    // Target specific buyers with "request accepted" status
    const targetBuyerEmails = [
      'bkingsriter@pinecrestcap.com',
      'leigh.lommen@winterfellinvestments.com', 
      'dustin.graham@ddgintl.com',
      'investments@sundial.io'
    ];
    
    console.log('\n--- Finding target buyers ---');
    const targetBuyers = await buyersCollection.find({
      email: { $in: targetBuyerEmails }
    }).toArray();
    
    console.log(`Found ${targetBuyers.length} target buyers`);
    targetBuyers.forEach(buyer => {
      console.log(`- ${buyer.fullName} (${buyer.email})`);
    });
    
    const buyerIds = targetBuyers.map(buyer => buyer._id.toString());
    
    // Find marketplace deals where these buyers have "request accepted" but are not properly active
    console.log('\n--- Finding deals with request accepted status for target buyers ---');
    const dealsToFix = await dealsCollection.find({
      isPublic: true, // Marketplace deals only
      $or: buyerIds.map(buyerId => ({
        [`invitationStatus.${buyerId}.response`]: { $in: ['requested', 'pending'] },
        [`invitationStatus.${buyerId}.notes`]: { $regex: /request.*accept/i }
      }))
    }).toArray();
    
    console.log(`Found ${dealsToFix.length} deals to fix`);
    
    if (dealsToFix.length === 0) {
      console.log('No deals found with request accepted status for target buyers');
      return;
    }
    
    // Update each deal to properly set these buyers as accepted and add to interestedBuyers
    let updatedCount = 0;
    for (const deal of dealsToFix) {
      let needsUpdate = false;
      const updates = {};
      
      // Check each target buyer in this deal
      for (const buyerId of buyerIds) {
        const invitation = deal.invitationStatus?.[buyerId];
        if (invitation && (invitation.response === 'requested' || invitation.response === 'pending')) {
          // Update invitation status to accepted
          updates[`invitationStatus.${buyerId}.response`] = 'accepted';
          updates[`invitationStatus.${buyerId}.respondedAt`] = new Date();
          updates[`invitationStatus.${buyerId}.decisionBy`] = 'admin';
          updates[`invitationStatus.${buyerId}.notes`] = 'Fixed: Request accepted - moved to active';
          needsUpdate = true;
          
          // Add to interestedBuyers if not already there
          if (!deal.interestedBuyers?.includes(buyerId)) {
            if (!updates.$addToSet) updates.$addToSet = {};
            updates.$addToSet.interestedBuyers = buyerId;
          }
          
          // Add to everActiveBuyers if not already there
          if (!deal.everActiveBuyers?.includes(buyerId)) {
            if (!updates.$addToSet) updates.$addToSet = {};
            updates.$addToSet.everActiveBuyers = buyerId;
          }
        }
      }
      
      if (needsUpdate) {
        updates['timeline.updatedAt'] = new Date();
        
        await dealsCollection.updateOne(
          { _id: deal._id },
          { $set: updates, ...updates.$addToSet ? { $addToSet: updates.$addToSet } : {} }
        );
        updatedCount++;
        console.log(`✅ Fixed deal: ${deal.title}`);
      }
    }
    
    console.log(`\n✅ Successfully fixed ${updatedCount} deals for request accepted buyers`);
    console.log('These buyers should now see their deals in Active tab instead of Pending');
    
  } catch (error) {
    console.error('❌ Error fixing deals:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the fix
fixRequestAcceptedBuyers();