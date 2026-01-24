const { MongoClient } = require('mongodb');

// MongoDB connection string from .env
const MONGO_URI = 'mongodb+srv://johnm_db_user:IL1YPAAzFB8TRUIt@cimamplify.ogypnuw.mongodb.net/';

async function updateMarketplaceDeals() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const dealsCollection = db.collection('deals');
    
    // First, find deals with pending invitations to see what will be affected
    console.log('\n--- Finding deals with pending invitations ---');
    const pendingDeals = await dealsCollection.find({
      "invitationStatus": { $exists: true }
    }, {
      projection: { title: 1, invitationStatus: 1 }
    }).toArray();
    
    console.log(`Found ${pendingDeals.length} deals with invitation status`);
    
    // Count how many have pending responses
    let pendingCount = 0;
    pendingDeals.forEach(deal => {
      if (deal.invitationStatus) {
        Object.values(deal.invitationStatus).forEach(status => {
          if (status.response === 'pending') {
            pendingCount++;
          }
        });
      }
    });
    
    console.log(`Found ${pendingCount} pending buyer invitations to update`);
    
    if (pendingCount === 0) {
      console.log('No pending invitations found. Exiting.');
      return;
    }
    
    // Update deals from pending to accepted (active)
    console.log('\n--- Updating pending to active ---');
    const result = await dealsCollection.updateMany(
      {
        "invitationStatus": { $exists: true }
      },
      [
        {
          $set: {
            "invitationStatus": {
              $arrayToObject: {
                $map: {
                  input: { $objectToArray: "$invitationStatus" },
                  as: "item",
                  in: {
                    k: "$$item.k",
                    v: {
                      $mergeObjects: [
                        "$$item.v",
                        {
                          $cond: [
                            { $eq: ["$$item.v.response", "pending"] },
                            {
                              response: "accepted",
                              respondedAt: new Date(),
                              decisionBy: "admin",
                              notes: "Bulk updated from pending to active"
                            },
                            {}
                          ]
                        }
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
    
    console.log(`✅ Updated ${result.modifiedCount} deals`);
    console.log('✅ Successfully updated marketplace deals from pending to active');
    
  } catch (error) {
    console.error('❌ Error updating deals:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the update
updateMarketplaceDeals();