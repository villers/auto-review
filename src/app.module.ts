import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

// Core
import { CodeReviewService } from './core/services/code-review.service';

// Adapters
import { GitlabService } from './adapters/vcs/gitlab.service';
import { GithubService } from './adapters/vcs/github.service';
import { ClaudeService } from './adapters/ai/claude.service';

// API Controllers
import { GitlabController } from './api/controllers/gitlab.controller';
import { GithubController } from './api/controllers/github.controller';
import { TestController } from './api/controllers/test.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true
    }),
    HttpModule.register({
      timeout: 15000,
      maxRedirects: 5
    })
  ],
  controllers: [
    GitlabController,
    GithubController,
    TestController
  ],
  providers: [
    // Service métier
    CodeReviewService,
    
    // Services VCS
    GitlabService,
    GithubService,
    
    // Service AI
    {
      provide: 'AI_SERVICE',
      useClass: ClaudeService
    }
  ]
})
export class AppModule {}
