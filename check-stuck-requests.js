const { MongoClient } = require('mongodb');

async function checkStuckRequests() {
  const uri = 'mongodb+srv://johnm_db_user:IL1YPAAzFB8TRUIt@cimamplify.ogypnuw.mongodb.net/';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(); // Uses default database
    const collection = db.collection('deals');

    console.log('🔍 Checking for stuck marketplace requests...\n');

    // Query for stuck requests
    const stuckDeals = await collection.aggregate([
      {
        $match: {
          isPublic: true,
          status: { $ne: 'completed' }
        }
      },
      {
        $addFields: {
          stuckRequests: {
            $filter: {
              input: { $objectToArray: '$invitationStatus' },
              cond: { $eq: ['$$this.v.response', 'requested'] }
            }
          }
        }
      },
      {
        $match: {
          'stuckRequests.0': { $exists: true }
        }
      },
      {
        $project: {
          title: 1,
          stuckRequests: {
            $map: {
              input: '$stuckRequests',
              as: 'req',
              in: {
                buyerId: '$$req.k',
                invitedAt: '$$req.v.invitedAt'
              }
            }
          },
          stuckCount: { $size: '$stuckRequests' }
        }
      }
    ]).toArray();

    // Summary count
    const summary = await collection.aggregate([
      {
        $match: {
          isPublic: true,
          status: { $ne: 'completed' }
        }
      },
      {
        $addFields: {
          stuckRequests: {
            $filter: {
              input: { $objectToArray: '$invitationStatus' },
              cond: { $eq: ['$$this.v.response', 'requested'] }
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          totalDealsWithStuckRequests: {
            $sum: {
              $cond: [{ $gt: [{ $size: '$stuckRequests' }, 0] }, 1, 0]
            }
          },
          totalStuckRequests: {
            $sum: { $size: '$stuckRequests' }
          }
        }
      }
    ]).toArray();

    console.log('📊 SUMMARY:');
    if (summary.length > 0) {
      console.log(`   Total deals with stuck requests: ${summary[0].totalDealsWithStuckRequests}`);
      console.log(`   Total stuck requests: ${summary[0].totalStuckRequests}\n`);
    } else {
      console.log('   No stuck requests found! ✅\n');
    }

    if (stuckDeals.length > 0) {
      console.log('📋 DETAILS:');
      stuckDeals.forEach((deal, index) => {
        console.log(`   ${index + 1}. Deal: "${deal.title}"`);
        console.log(`      ID: ${deal._id}`);
        console.log(`      Stuck requests: ${deal.stuckCount}`);
        deal.stuckRequests.forEach((req, i) => {
          console.log(`         ${i + 1}. Buyer ID: ${req.buyerId}`);
          console.log(`            Invited: ${req.invitedAt}`);
        });
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

checkStuckRequests();