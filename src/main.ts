import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Setup global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: false,
    forbidNonWhitelisted: false,
    transform: true,
  }));

  // Setup Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Code Review API')
    .setDescription('API for automated code reviews using AI for GitLab and GitHub merge/pull requests')
    .setVersion('1.0')
    .addTag('code-review')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Enable CORS
  app.enableCors();

  // Start the server
  const port = process.env.PORT || 3003;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();