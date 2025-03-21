import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Core domain providers
import { AnalyzeMergeRequestUseCase } from '@core/usecases/analyze-merge-request.usecase';

// Infrastructure providers
import { ClaudeAIService } from '@infrastructure/persistence/claude-ai.service';
import { OpenAIService } from '@infrastructure/persistence/openai.service';
import { AIFactoryService } from '@infrastructure/persistence/ai.factory.service';
import { GitlabRepository } from '@infrastructure/persistence/gitlab.repository';
import { GithubRepository } from '@infrastructure/persistence/github.repository';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { VersionControlService } from '@infrastructure/persistence/version-control.adapter';
import { AIRepository } from '@core/domain/repositories/ai.repository';
import { AI_REPOSITORY_TOKEN, VERSION_CONTROL_REPOSITORY_TOKEN } from '@core/domain/repositories/injection-tokens';

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
    OpenAIService,
    AIFactoryService,
    VersionControlService,
    GitlabRepository,
    GithubRepository,
    
    // Provider pour AIRepository
    {
      provide: AI_REPOSITORY_TOKEN,
      useFactory: (aiFactory: AIFactoryService) => {
        return aiFactory.getRepository();
      },
      inject: [AIFactoryService],
    },
    
    // Provider pour VersionControlRepository
    {
      provide: VERSION_CONTROL_REPOSITORY_TOKEN,
      useFactory: (vcsService: VersionControlService, gitlab: GitlabRepository, github: GithubRepository) => {
        // Par défaut, retourne l'implémentation GitLab, mais cela sera remplacé
        // dynamiquement dans le contrôleur en fonction du type de VCS
        return gitlab;
      },
      inject: [VersionControlService, GitlabRepository, GithubRepository],
    },
    
    // Use cases
    AnalyzeMergeRequestUseCase,
  ],
})
export class AppModule {}