import "./shims"
import { NestFactory } from "@nestjs/core"
import { ValidationPipe } from "@nestjs/common"
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger"
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import { AppModule } from "./app.module"
import * as fs from "fs"
import * as express from "express"

async function bootstrap() {
  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    let frontendUrl = process.env.FRONTEND_URL || "https://app.cimamplify.com"
    // Remove trailing slash if present
    if (frontendUrl.endsWith("/")) {
      frontendUrl = frontendUrl.slice(0, -1)
    }

    // Increase body size limit for large uploads
    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ limit: '10mb', extended: true }))

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

    // Ensure uploads directory exists
    const uploadDirs = ["./uploads", "./uploads/profile-pictures", "./uploads/deal-documents"]
    uploadDirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    })

    app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' })
    app.useStaticAssets(join(__dirname, '..', 'assets'), { prefix: '/assets' })

    // ✅ Fixed CORS configuration (allow credentials + exact origin)
    app.enableCors({
      origin: (origin, callback) => {
        const allowedOrigins = [frontendUrl]
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, origin)
        } else {
          callback(new Error("Not allowed by CORS"))
        }
      },
      credentials: true,
    })

    // Swagger setup
    const config = new DocumentBuilder()
      .setTitle("E-commerce API")
      .setDescription("The E-commerce API documentation")
      .setVersion("1.0")
      .addTag("auth")
      .addTag("buyers")
      .addTag("admin")
      .addTag("sellers")
      .addTag("deals")
      .addTag("deal-tracking")
      .addTag("company-profiles")
      .addBearerAuth()
      .build()

    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup("api", app, document)

    console.log("MongoDB URI:", process.env.MONGODB_URI)
    console.log("Google Client ID configured:", !!process.env.GOOGLE_CLIENT_ID)
    console.log("Frontend URL configured as:", frontendUrl)
    console.log("Static files will be served from: /uploads/")

    await app.listen(3001)
    console.log("Application running on port 3001")
    console.log("Swagger documentation available at: http://localhost:3001/api")

  } catch (error) {
    console.error("Failed to start application:", error)
  }
}

if (typeof window === "undefined") {
  bootstrap()
}

export { bootstrap }
