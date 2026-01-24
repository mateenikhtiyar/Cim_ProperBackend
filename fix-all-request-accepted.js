const { MongoClient } = require('mongodb');

// MongoDB connection string from .env
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cimamplify';

async function fixAllRequestAcceptedBuyers() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const dealsCollection = db.collection('deals');
    
    // Find all marketplace deals with buyers who have "request accepted" in notes but wrong status
    console.log('\n--- Finding marketplace deals with "request accepted" buyers ---');
    const dealsToFix = await dealsCollection.find({
      isPublic: true, // Marketplace deals only
      invitationStatus: { $exists: true }
    }).toArray();
    
    console.log(`Found ${dealsToFix.length} marketplace deals to check`);
    
    let totalFixed = 0;
    let dealsUpdated = 0;
    
    for (const deal of dealsToFix) {
      let needsUpdate = false;
      const bulkUpdates = [];
      
      // Check each buyer's invitation status
      for (const [buyerId, invitation] of Object.entries(deal.invitationStatus || {})) {
        if (invitation && invitation.notes && 
            invitation.notes.toLowerCase().includes('request accepted') &&
            invitation.response !== 'accepted') {
          
          console.log(`Found buyer to fix: ${buyerId} in deal "${deal.title}"`);
          console.log(`  Current status: ${invitation.response}`);
          console.log(`  Notes: ${invitation.notes}`);
          
          needsUpdate = true;
          totalFixed++;
        }
      }
      
      if (needsUpdate) {
        // Update this deal - fix all buyers with "request accepted" notes
        const result = await dealsCollection.updateOne(
          { _id: deal._id },
          [
            {
              $set: {
                invitationStatus: {
                  $arrayToObject: {
                    $map: {
                      input: { $objectToArray: "$invitationStatus" },
                      as: "item",
                      in: {
                        k: "$$item.k",
                        v: {
                          $cond: [
                            {
                              $and: [
                                { $regexMatch: { input: { $ifNull: ["$$item.v.notes", ""] }, regex: /request accepted/i } },
                                { $ne: ["$$item.v.response", "accepted"] }
                              ]
                            },
                            {
                              $mergeObjects: [
                                "$$item.v",
                                {
                                  response: "accepted",
                                  respondedAt: new Date(),
                                  decisionBy: "admin",
                                  notes: { $concat: [{ $ifNull: ["$$item.v.notes", ""] }, " - Fixed: Moved to active"] }
                                }
                              ]
                            },
                            "$$item.v"
                          ]
                        }
                      }
                    }
                  }
                },
                "timeline.updatedAt": new Date()
              }
            }
          ]
        );
        
        if (result.modifiedCount > 0) {
          dealsUpdated++;
          console.log(`✅ Fixed deal: ${deal.title}`);
        }
      }
    }
    
    console.log(`\n✅ Summary:`);
    console.log(`- Checked ${dealsToFix.length} marketplace deals`);
    console.log(`- Found ${totalFixed} buyers with "request accepted" status to fix`);
    console.log(`- Updated ${dealsUpdated} deals`);
    console.log(`- These buyers should now see their deals in Active tab instead of Pending`);
    
  } catch (error) {
    console.error('❌ Error fixing deals:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the fix
fixAllRequestAcceptedBuyers();