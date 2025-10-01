// Test script to verify email functionality
const mongoose = require('mongoose');
require('dotenv').config();

async function testEmailFunctionality() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/e-commerce');
    console.log('Connected to MongoDB');

    // Test 1: Check buyers with unverified emails
    const Buyer = mongoose.model('Buyer', new mongoose.Schema({
      email: String,
      fullName: String,
      isEmailVerified: { type: Boolean, default: false },
      createdAt: Date,
      companyProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyProfile' }
    }, { timestamps: true }));

    const unverifiedBuyers = await Buyer.find({ isEmailVerified: false }).limit(5);
    console.log(`\n1. Found ${unverifiedBuyers.length} unverified buyers:`);
    unverifiedBuyers.forEach(buyer => {
      console.log(`   - ${buyer.email} (created: ${buyer.createdAt})`);
    });

    // Test 2: Check buyers with incomplete profiles
    const CompanyProfile = mongoose.model('CompanyProfile', new mongoose.Schema({
      companyName: String,
      website: String,
      companyType: String,
      capitalEntity: String,
      dealsCompletedLast5Years: Number,
      averageDealSize: Number,
      targetCriteria: {
        countries: [String],
        industrySectors: [String],
        revenueMin: Number,
        revenueMax: Number,
        ebitdaMin: Number,
        ebitdaMax: Number,
        transactionSizeMin: Number,
        transactionSizeMax: Number,
        revenueGrowth: Number,
        minStakePercent: Number,
        minYearsInBusiness: Number,
        preferredBusinessModels: [String],
        description: String
      },
      agreements: {
        feeAgreementAccepted: Boolean
      },
      buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Buyer' }
    }));

    const buyersWithProfiles = await Buyer.find({ 
      isEmailVerified: true,
      companyProfileId: { $exists: true }
    }).populate('companyProfileId').limit(10);

    console.log(`\n2. Checking ${buyersWithProfiles.length} verified buyers for incomplete profiles:`);
    
    let incompleteCount = 0;
    buyersWithProfiles.forEach(buyer => {
      if (buyer.companyProfileId) {
        const profile = buyer.companyProfileId;
        const isComplete = !!(
          profile.companyName &&
          profile.companyName !== "Set your company name" &&
          profile.website &&
          profile.companyType &&
          profile.companyType !== "Other" &&
          profile.capitalEntity &&
          profile.dealsCompletedLast5Years !== undefined &&
          profile.averageDealSize !== undefined &&
          profile.targetCriteria?.countries?.length > 0 &&
          profile.targetCriteria?.industrySectors?.length > 0 &&
          profile.targetCriteria?.revenueMin !== undefined &&
          profile.targetCriteria?.revenueMax !== undefined &&
          profile.targetCriteria?.ebitdaMin !== undefined &&
          profile.targetCriteria?.ebitdaMax !== undefined &&
          profile.targetCriteria?.transactionSizeMin !== undefined &&
          profile.targetCriteria?.transactionSizeMax !== undefined &&
          profile.targetCriteria?.revenueGrowth !== undefined &&
          profile.targetCriteria?.minYearsInBusiness !== undefined &&
          profile.targetCriteria?.preferredBusinessModels?.length > 0 &&
          profile.targetCriteria?.description &&
          profile.agreements?.feeAgreementAccepted
        );
        
        if (!isComplete) {
          incompleteCount++;
          console.log(`   - INCOMPLETE: ${buyer.email} (${profile.companyName})`);
        }
      }
    });
    
    console.log(`   Total incomplete profiles: ${incompleteCount}`);

    // Test 3: Check email verification tokens
    const EmailVerification = mongoose.model('EmailVerification', new mongoose.Schema({
      userId: { type: mongoose.Schema.Types.ObjectId, required: true },
      token: { type: String, required: true },
      isUsed: { type: Boolean, default: false },
      expiresAt: { type: Date, required: true }
    }));

    const recentTokens = await EmailVerification.find().sort({ _id: -1 }).limit(5);
    console.log(`\n3. Recent email verification tokens (${recentTokens.length}):`);
    recentTokens.forEach(token => {
      console.log(`   - Token: ${token.token.substring(0, 8)}... (used: ${token.isUsed}, expires: ${token.expiresAt})`);
    });

    // Test 4: Check communication logs
    const CommunicationLog = mongoose.model('CommunicationLog', new mongoose.Schema({
      recipientEmail: String,
      recipientType: String,
      subject: String,
      sentAt: Date,
      status: String
    }));

    const recentEmails = await CommunicationLog.find().sort({ sentAt: -1 }).limit(10);
    console.log(`\n4. Recent email logs (${recentEmails.length}):`);
    recentEmails.forEach(log => {
      console.log(`   - ${log.recipientEmail}: "${log.subject}" (${log.status}) - ${log.sentAt}`);
    });

    // Test 5: Environment variables check
    console.log(`\n5. Environment variables check:`);
    console.log(`   - EMAIL_USER: ${process.env.EMAIL_USER ? 'SET' : 'NOT SET'}`);
    console.log(`   - EMAIL_PASS: ${process.env.EMAIL_PASS ? 'SET' : 'NOT SET'}`);
    console.log(`   - BACKEND_URL: ${process.env.BACKEND_URL || 'NOT SET'}`);
    console.log(`   - FRONTEND_URL: ${process.env.FRONTEND_URL || 'NOT SET'}`);

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

testEmailFunctionality();