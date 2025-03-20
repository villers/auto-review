import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Core domain providers
import { AnalyzeMergeRequestUseCase } from '@core/usecases/analyze-merge-request.usecase';

// Infrastructure providers
import { ClaudeAIService } from '@infrastructure/persistence/claude-ai.service';
import { GitlabRepository } from '@infrastructure/persistence/gitlab.repository';
import { GithubRepository } from '@infrastructure/persistence/github.repository';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';

// Controllers
import { ReviewController } from '@presentation/controllers/review.controller';
import { WebhookController } from '@presentation/controllers/webhook.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  controllers: [
    ReviewController,
    WebhookController,
  ],
  providers: [
    // Services
    ClaudeAIService,
    GitlabRepository,
    GithubRepository,
    
    // Use cases
    AnalyzeMergeRequestUseCase,
  ],
})
export class AppModule {}