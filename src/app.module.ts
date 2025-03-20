import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Core domain providers
import { AnalyzeMergeRequestUseCase } from '@core/usecases/analyze-merge-request.usecase';

// Infrastructure providers
import { ClaudeAIService } from '@infrastructure/persistence/claude-ai.service';
import { GitlabRepository } from '@infrastructure/persistence/gitlab.repository';

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
    // Use cases
    {
      provide: AnalyzeMergeRequestUseCase,
      useFactory: (
        vcRepo,
        aiService,
      ) => new AnalyzeMergeRequestUseCase(vcRepo, aiService),
      inject: [GitlabRepository, ClaudeAIService],
    },
    
    // Infrastructure
    GitlabRepository,
    ClaudeAIService,
  ],
})
export class AppModule {}