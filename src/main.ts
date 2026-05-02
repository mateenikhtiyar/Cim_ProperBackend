import "./shims"
import { NestFactory } from "@nestjs/core"
import { Logger, ValidationPipe } from "@nestjs/common"
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger"
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from "./app.module"
import * as express from "express"
import helmet from "helmet"
import { GlobalExceptionFilter } from "./common/filters/http-exception.filter"

const bootstrapLogger = new Logger("Bootstrap");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const frontendUrlConfig = process.env.FRONTEND_URL
  if (!frontendUrlConfig) {
    throw new Error("FRONTEND_URL must be set to one or more allowed origins.")
  }
  const allowedOrigins = frontendUrlConfig
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean)

  if (allowedOrigins.length === 0) {
    throw new Error("FRONTEND_URL must contain at least one valid origin.")
  }

  // Enable CORS BEFORE helmet so preflight OPTIONS requests are handled first
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true)
      }
      const normalizedOrigin = origin.replace(/\/$/, "")
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true)
      }
      return callback(new Error("Origin not allowed by CORS"), false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
      'X-Requested-With',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers'
    ],
    exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  })

  // Swagger UI ships inline bootstrap scripts; we relax the CSP only on its
  // route by registering a route-scoped helmet middleware *before* the global
  // one. styleSrc keeps 'unsafe-inline' globally since most CSS-in-JS
  // libraries (Tailwind plugins, framer-motion, etc.) emit inline styles.
  app.use(
    '/api-docs',
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https:"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
    }),
  )

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          // No 'unsafe-inline' on scripts — the React build emits no inline
          // <script> tags, so removing it closes a real XSS escalation path.
          scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https:"],
        },
      },
      referrerPolicy: { policy: "no-referrer" },
      frameguard: { action: "deny" },
    }),
  )

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
  
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`
  const config = new DocumentBuilder()
    .setTitle("CIM Amplify API")
    .setDescription("The CIM Amplify API documentation")
    .setVersion("2.2")
    .addTag("auth")
    .addTag("buyers")
    .addTag("admin")
    .addTag("sellers")
    .addTag("deals")
    .addTag("deal-tracking")
    .addTag("company-profiles")
    .addBearerAuth()
    .addServer(backendUrl, 'Production')
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
  await app.listen(port);
  bootstrapLogger.log(`Backend server running on http://localhost:${port}`);
  bootstrapLogger.log(`Swagger docs available at http://localhost:${port}/api-docs`);
}

bootstrap().catch((error) => {
  bootstrapLogger.error('Error starting server', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
