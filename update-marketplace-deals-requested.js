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
    
    // Find marketplace deals with "requested" invitations
    console.log('\n--- Finding marketplace deals with "requested" invitations ---');
    const marketplaceDeals = await dealsCollection.find({
      "isPublic": true, // Only marketplace deals
      "invitationStatus": { $exists: true }
    }, {
      projection: { title: 1, invitationStatus: 1, isPublic: 1 }
    }).toArray();
    
    console.log(`Found ${marketplaceDeals.length} marketplace deals`);
    
    // Count how many have "requested" responses
    let requestedCount = 0;
    marketplaceDeals.forEach(deal => {
      if (deal.invitationStatus) {
        Object.values(deal.invitationStatus).forEach(status => {
          if (status.response === 'requested') {
            requestedCount++;
          }
        });
      }
    });
    
    console.log(`Found ${requestedCount} "requested" buyer invitations in marketplace deals to update`);
    
    if (requestedCount === 0) {
      console.log('No "requested" invitations found in marketplace deals. Exiting.');
      return;
    }
    
    // Update marketplace deals from "requested" to "accepted" (active)
    console.log('\n--- Updating marketplace deals from "requested" to "accepted" ---');
    const result = await dealsCollection.updateMany(
      {
        "isPublic": true, // Only marketplace deals
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
                            { $eq: ["$$item.v.response", "requested"] },
                            {
                              response: "accepted",
                              respondedAt: new Date(),
                              decisionBy: "admin",
                              notes: "Marketplace request accepted - bulk update"
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
    
    console.log(`✅ Updated ${result.modifiedCount} marketplace deals`);
    console.log('✅ Successfully updated marketplace deals from "requested" to "accepted" (active)');
    
  } catch (error) {
    console.error('❌ Error updating deals:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the update
updateMarketplaceDeals();