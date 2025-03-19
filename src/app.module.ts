import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Core domain providers
import { AnalyzeMergeRequestUseCase } from './core/usecases/analyze-merge-request.usecase';
import { GetReviewUseCase } from './core/usecases/get-review.usecase';

// Infrastructure providers
import { ClaudeAIService } from './infrastructure/ai/claude-ai.service';
import { GitlabRepository } from './infrastructure/gitlab/gitlab.repository';
import { InMemoryReviewRepository } from './infrastructure/persistence/in-memory-review.repository';

// Controllers
import { ReviewController } from './presentation/controllers/review.controller';
import { WebhookController } from './presentation/controllers/webhook.controller';

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
        reviewRepo,
        vcRepo,
        aiService,
      ) => new AnalyzeMergeRequestUseCase(reviewRepo, vcRepo, aiService),
      inject: [InMemoryReviewRepository, GitlabRepository, ClaudeAIService],
    },
    {
      provide: GetReviewUseCase,
      useFactory: (reviewRepo) => new GetReviewUseCase(reviewRepo),
      inject: [InMemoryReviewRepository],
    },
    
    // Infrastructure
    InMemoryReviewRepository,
    GitlabRepository,
    ClaudeAIService,
  ],
})
export class AppModule {}