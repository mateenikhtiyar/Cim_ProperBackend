import "./shims"
import { NestFactory } from "@nestjs/core"
import { ValidationPipe } from "@nestjs/common"
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger"
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { AppModule } from "./app.module"
import * as express from "express"
import { GlobalExceptionFilter } from "./common/filters/http-exception.filter"

let cachedApp: NestExpressApplication;

async function bootstrap() {
  if (cachedApp) {
    return cachedApp;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Create uploads directories if they don't exist (only for local development)
  if (process.env.VERCEL !== '1') {
    const uploadDirs = ['./uploads', './uploads/profile-pictures', './uploads/deal-documents'];
    uploadDirs.forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    });

    // Serve static files from uploads directory
    app.useStaticAssets(join(__dirname, '..', 'uploads'), {
      prefix: '/uploads/',
    });
  }

  let frontendUrl = process.env.FRONTEND_URL || "https://app.cimamplify.com"
  // Remove trailing slash if present
  if (frontendUrl.endsWith("/")) {
    frontendUrl = frontendUrl.slice(0, -1)
  }
  // Enable CORS before other middleware
  app.enableCors({
    origin: true, // Allow all origins for now
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  })

  // Increase body size limit for large uploads (e.g., base64 images)
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ limit: '50mb', extended: true }))
  
  // Global exception filter for consistent error responses
  app.useGlobalFilters(new GlobalExceptionFilter())

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  )
  
  // Setup Swagger with CDN assets for Vercel
  const config = new DocumentBuilder()
    .setTitle("CIM Amplify API")
    .setDescription("The CIM Amplify API documentation")
    .setVersion("1.0")
    .addTag("auth")
    .addTag("buyers")
    .addTag("admin")
    .addTag("sellers")
    .addTag("deals")
    .addTag("deal-tracking")
    .addTag("company-profiles")
    .addBearerAuth()
    .addServer(process.env.BACKEND_URL || 'https://api.cimamplify.com', 'Production')
    .addServer('https://api.cimamplify.com', 'Development')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup("api-docs", app, document, {
    customSiteTitle: 'CIM Amplify API',
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.js',
    ],
    swaggerOptions: {
      persistAuthorization: true,
    },
  })

  const port = process.env.PORT || 3001;
  
  // Only listen on port if not in Vercel environment
  if (process.env.VERCEL !== '1') {
    await app.listen(port);
    console.log(`🚀 Backend server running on http://localhost:${port}`);
    console.log(`📚 Swagger docs available at http://localhost:${port}/api-docs`);
  } else {
    await app.init();
  }
  
  cachedApp = app;
  return app;
}

// Call bootstrap when running locally (not in Vercel)
// This ensures the server starts when running npm run start:dev or npm run start
if (process.env.VERCEL !== '1' && require.main === module) {
  bootstrap().catch((error) => {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  });
}

// Vercel serverless handler
export default async (req, res) => {
  const app = await bootstrap();
  const server = app.getHttpAdapter().getInstance();
  return server(req, res);
};