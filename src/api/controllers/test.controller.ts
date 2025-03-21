import { Controller, Post, Body, Get, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { CodeReviewService } from '../../core/services/code-review.service';
import { GitlabService } from '../../adapters/vcs/gitlab.service';
import { GithubService } from '../../adapters/vcs/github.service';

/**
 * DTO pour la requête de test de revue
 */
class TestReviewDto {
  // ID du projet (GitLab) ou nom du dépôt (GitHub au format 'owner/repo')
  projectId: string;
  
  // ID ou numéro de la MR/PR
  mergeRequestId: number;
  
  // Optionnel: ID de l'utilisateur demandant la revue
  userId?: string;
}

/**
 * Contrôleur pour tester facilement les fonctionnalités de revue de code
 * sans passer par les webhooks
 */
@Controller('test')
export class TestController {
  constructor(
    private readonly codeReviewService: CodeReviewService,
    private readonly gitlabService: GitlabService,
    private readonly githubService: GithubService
  ) {}

  /**
   * Page d'accueil avec documentation simple
   */
  @Get()
  getTestInfo() {
    return {
      description: 'API de test pour les revues de code',
      endpoints: [
        {
          path: '/test/gitlab',
          method: 'POST',
          description: 'Tester une revue de code GitLab',
          body: {
            projectId: 'ID du projet (ex: 12345)',
            mergeRequestId: 'Numéro de la merge request (ex: 42)',
            userId: 'ID utilisateur (optionnel)'
          }
        },
        {
          path: '/test/github',
          method: 'POST',
          description: 'Tester une revue de code GitHub',
          body: {
            projectId: 'Nom du repository (ex: "owner/repo")',
            mergeRequestId: 'Numéro de la pull request (ex: 42)',
            userId: 'ID utilisateur (optionnel)'
          }
        },
        {
          path: '/test/gitlab/:projectId/:mergeRequestId',
          method: 'GET',
          description: 'Tester une revue de code GitLab (via URL)',
          params: {
            projectId: 'ID du projet',
            mergeRequestId: 'Numéro de la merge request'
          }
        },
        {
          path: '/test/github/:owner/:repo/:pullRequestId',
          method: 'GET',
          description: 'Tester une revue de code GitHub (via URL)',
          params: {
            owner: 'Propriétaire du repository',
            repo: 'Nom du repository',
            pullRequestId: 'Numéro de la pull request'
          }
        }
      ]
    };
  }

  /**
   * Test d'une revue GitLab (POST)
   */
  @Post('gitlab')
  async testGitlabReview(@Body() testDto: TestReviewDto) {
    try {
      console.log(`[TEST] Reviewing GitLab merge request ${testDto.mergeRequestId} for project ${testDto.projectId}`);
      
      const userId = testDto.userId || 'test-user';
      
      const review = await this.codeReviewService.reviewMergeRequest(
        testDto.projectId,
        testDto.mergeRequestId,
        userId,
        this.gitlabService
      );
      
      return {
        status: 'success',
        message: `GitLab review completed with status: ${review.status}`,
        review: {
          id: review.id,
          status: review.status,
          commentCount: review.comments.length,
          summary: review.summary
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to review GitLab merge request: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test d'une revue GitHub (POST)
   */
  @Post('github')
  async testGithubReview(@Body() testDto: TestReviewDto) {
    try {
      console.log(`[TEST] Reviewing GitHub pull request ${testDto.mergeRequestId} for repository ${testDto.projectId}`);
      
      const userId = testDto.userId || 'test-user';
      
      const review = await this.codeReviewService.reviewMergeRequest(
        testDto.projectId,
        testDto.mergeRequestId,
        userId,
        this.githubService
      );
      
      return {
        status: 'success',
        message: `GitHub review completed with status: ${review.status}`,
        review: {
          id: review.id,
          status: review.status,
          commentCount: review.comments.length,
          summary: review.summary
        }
      };
    } catch (error) {
      throw new HttpException(
        `Failed to review GitHub pull request: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test d'une revue GitLab (GET)
   */
  @Get('gitlab/:projectId/:mergeRequestId')
  async testGitlabReviewGet(
    @Param('projectId') projectId: string,
    @Param('mergeRequestId') mergeRequestId: number,
    @Query('userId') userId?: string
  ) {
    const testDto: TestReviewDto = {
      projectId,
      mergeRequestId: Number(mergeRequestId),
      userId: userId || 'test-user'
    };
    
    return this.testGitlabReview(testDto);
  }

  /**
   * Test d'une revue GitHub (GET avec format owner/repo)
   */
  @Get('github/:owner/:repo/:pullRequestId')
  async testGithubReviewGet(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('pullRequestId') pullRequestId: number,
    @Query('userId') userId?: string
  ) {
    const testDto: TestReviewDto = {
      projectId: `${owner}/${repo}`,
      mergeRequestId: Number(pullRequestId),
      userId: userId || 'test-user'
    };
    
    return this.testGithubReview(testDto);
  }
}
