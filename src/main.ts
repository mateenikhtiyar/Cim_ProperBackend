// Import the shims first
import "./shims"

import { NestFactory } from "@nestjs/core"
import { ValidationPipe } from "@nestjs/common"
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger"
import { AppModule } from "./app.module"
import * as fs from "fs"

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule)
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
    const uploadDirs = ["./uploads", "./uploads/profile-pictures"]
    uploadDirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    })

    // Fix CORS configuration
    let frontendUrl = process.env.FRONTEND_URL || "https://cim-amp-f.vercel.app/"
    // Remove trailing slash if present
    if (frontendUrl.endsWith("/")) {
      frontendUrl = frontendUrl.slice(0, -1)
    }

    app.enableCors({
      origin: frontendUrl,
      credentials: true,
    })

    // Setup Swagger
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
    await app.listen(3001)
    console.log("Application running on port 3001")
    console.log("Swagger documentation available at: http://localhost:3001/api")
  } catch (error) {
    console.error("Failed to start application:", error)
  }
}

// Only run bootstrap in server environment
if (typeof window === "undefined") {
  bootstrap()
}

// Export bootstrap for Next.js
export { bootstrap }
