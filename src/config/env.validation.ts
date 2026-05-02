import { plainToInstance } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from "class-validator";

class EnvironmentVariables {
  @IsString()
  @MinLength(10)
  JWT_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  @IsString()
  MONGODB_URI!: string;

  @IsString()
  FRONTEND_URL!: string;

  @IsOptional()
  @IsString()
  BACKEND_URL?: string;

  @IsOptional()
  @IsEmail()
  EMAIL_USER?: string;

  @IsOptional()
  @IsString()
  EMAIL_PASS?: string;

  @IsOptional()
  @IsEmail()
  ADMIN_NOTIFICATION_EMAIL?: string;

  @IsOptional()
  @IsNumberString()
  PORT?: string;

  @IsOptional()
  @IsIn(["development", "production", "test"])
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  ANTHROPIC_API_KEY?: string;

  @IsOptional()
  @IsString()
  ERROR_MONITORING_WEBHOOK_URL?: string;
}

export function validateEnvironment(config: Record<string, unknown>) {
  const merged = { ...process.env, ...config };

  const validatedConfig = plainToInstance(EnvironmentVariables, merged, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        const constraints = error.constraints
          ? Object.values(error.constraints).join(", ")
          : "Invalid value";
        return `${error.property}: ${constraints}`;
      })
      .join("; ");
    throw new Error(`Environment validation failed: ${details}`);
  }

  return validatedConfig;
}
