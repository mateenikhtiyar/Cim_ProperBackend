const { MongoClient } = require('mongodb');

async function migrateStuckRequests() {
  const uri = 'mongodb+srv://johnm_db_user:IL1YPAAzFB8TRUIt@cimamplify.ogypnuw.mongodb.net/';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('deals');

    console.log('🔄 Starting migration of stuck marketplace requests...\n');

    // Find and update deals with stuck requests
    const deals = await collection.find({
      isPublic: true,
      status: { $ne: 'completed' },
      'invitationStatus': { $exists: true }
    }).toArray();

    let totalMigrated = 0;
    const migratedDeals = [];

    for (const deal of deals) {
      let dealModified = false;
      const updates = {};

      // Check each invitation status
      for (const [buyerId, status] of Object.entries(deal.invitationStatus || {})) {
        if (status.response === 'requested') {
          // Update the specific buyer's status
          updates[`invitationStatus.${buyerId}.response`] = 'pending';
          updates[`invitationStatus.${buyerId}.respondedAt`] = new Date();
          updates[`invitationStatus.${buyerId}.notes`] = 'Migrated from stuck marketplace request';
          updates[`invitationStatus.${buyerId}.decisionBy`] = 'system';
          
          dealModified = true;
          totalMigrated++;
        }
      }

      if (dealModified) {
        updates['timeline.updatedAt'] = new Date();
        
        await collection.updateOne(
          { _id: deal._id },
          { $set: updates }
        );

        migratedDeals.push({
          dealId: deal._id,
          title: deal.title,
          migratedCount: Object.keys(updates).filter(key => key.includes('response')).length
        });

        console.log(`✅ Migrated deal: "${deal.title}" (${Object.keys(updates).filter(key => key.includes('response')).length} requests)`);
      }
    }

    console.log(`\n🎉 Migration completed!`);
    console.log(`   Total requests migrated: ${totalMigrated}`);
    console.log(`   Deals affected: ${migratedDeals.length}`);

    return {
      totalMigrated,
      migratedDeals
    };

  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run migration
migrateStuckRequests()
  .then(result => {
    console.log('\n✨ All stuck marketplace requests have been moved to pending status!');
    console.log('   Buyers can now see these deals in their Pending tab and take action.');
  })
  .catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });