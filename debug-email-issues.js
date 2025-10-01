// Debug script to check email functionality issues
const mongoose = require('mongoose');
require('dotenv').config();

async function debugEmailIssues() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/e-commerce');
    console.log('✓ Connected to MongoDB');

    // Check environment variables
    console.log('\n=== ENVIRONMENT VARIABLES ===');
    console.log(`EMAIL_USER: ${process.env.EMAIL_USER ? '✓ SET' : '✗ NOT SET'}`);
    console.log(`EMAIL_PASS: ${process.env.EMAIL_PASS ? '✓ SET' : '✗ NOT SET'}`);
    console.log(`BACKEND_URL: ${process.env.BACKEND_URL || '✗ NOT SET'}`);
    console.log(`FRONTEND_URL: ${process.env.FRONTEND_URL || '✗ NOT SET'}`);

    // Define schemas
    const BuyerSchema = new mongoose.Schema({
      email: String,
      fullName: String,
      isEmailVerified: { type: Boolean, default: false },
      profileCompletionReminderCount: { type: Number, default: 0 },
      lastProfileCompletionReminderSentAt: Date,
      companyProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyProfile' }
    }, { timestamps: true });

    const CompanyProfileSchema = new mongoose.Schema({
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
      }
    });

    const EmailVerificationSchema = new mongoose.Schema({
      userId: mongoose.Schema.Types.ObjectId,
      token: String,
      isUsed: { type: Boolean, default: false },
      expiresAt: Date
    });

    const CommunicationLogSchema = new mongoose.Schema({
      recipientEmail: String,
      recipientType: String,
      subject: String,
      sentAt: Date,
      status: String
    });

    const Buyer = mongoose.model('Buyer', BuyerSchema);
    const CompanyProfile = mongoose.model('CompanyProfile', CompanyProfileSchema);
    const EmailVerification = mongoose.model('EmailVerification', EmailVerificationSchema);
    const CommunicationLog = mongoose.model('CommunicationLog', CommunicationLogSchema);

    // Check unverified buyers
    console.log('\n=== UNVERIFIED BUYERS ===');
    const unverifiedBuyers = await Buyer.find({ isEmailVerified: false }).limit(5);
    console.log(`Found ${unverifiedBuyers.length} unverified buyers:`);
    unverifiedBuyers.forEach(buyer => {
      console.log(`  - ${buyer.email} (created: ${buyer.createdAt})`);
    });

    // Check buyers eligible for profile completion reminders
    console.log('\n=== BUYERS ELIGIBLE FOR PROFILE REMINDERS ===');
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));
    
    const eligibleBuyers = await Buyer.find({
      isEmailVerified: true,
      profileCompletionReminderCount: { $lt: 5 },
      $or: [
        { lastProfileCompletionReminderSentAt: { $eq: null } },
        { lastProfileCompletionReminderSentAt: { $lte: twoDaysAgo } }
      ]
    }).populate('companyProfileId').limit(10);

    console.log(`Found ${eligibleBuyers.length} buyers eligible for profile reminders:`);
    
    for (const buyer of eligibleBuyers) {
      const profile = buyer.companyProfileId;
      const isComplete = profile && !!(
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

      console.log(`  - ${buyer.email}: ${isComplete ? '✓ COMPLETE' : '✗ INCOMPLETE'} (reminders: ${buyer.profileCompletionReminderCount})`);
    }

    // Check recent email verification tokens
    console.log('\n=== RECENT EMAIL VERIFICATION TOKENS ===');
    const recentTokens = await EmailVerification.find().sort({ _id: -1 }).limit(5);
    console.log(`Found ${recentTokens.length} recent tokens:`);
    recentTokens.forEach(token => {
      const expired = token.expiresAt < now;
      console.log(`  - ${token.token.substring(0, 8)}... (used: ${token.isUsed}, expired: ${expired})`);
    });

    // Check recent communication logs
    console.log('\n=== RECENT EMAIL LOGS ===');
    const recentLogs = await CommunicationLog.find().sort({ sentAt: -1 }).limit(10);
    console.log(`Found ${recentLogs.length} recent email logs:`);
    recentLogs.forEach(log => {
      console.log(`  - ${log.recipientEmail}: "${log.subject}" (${log.status}) - ${log.sentAt}`);
    });

    // Test email configuration
    console.log('\n=== EMAIL CONFIGURATION TEST ===');
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      try {
        await transporter.verify();
        console.log('✓ Email transporter configuration is valid');
      } catch (error) {
        console.log('✗ Email transporter configuration failed:', error.message);
      }
    } else {
      console.log('✗ Email credentials not configured');
    }

  } catch (error) {
    console.error('Debug failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

debugEmailIssues();