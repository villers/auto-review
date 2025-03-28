import { Controller, Post, Body, Headers, HttpCode, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeReviewService } from '../../core/services/code-review.service';
import { GithubService } from '../../adapters/vcs/github.service';
import * as crypto from 'crypto';

interface PullRequestEvent {
  action: string;
  pull_request: {
    number: number;
    state: string;
  };
  repository: {
    id: number;
    full_name: string;
  };
  sender: {
    id: number;
    login: string;
  };
}

@Controller('webhook/github')
export class GithubController {
  constructor(
    private readonly codeReviewService: CodeReviewService,
    private readonly githubService: GithubService,
    private readonly configService: ConfigService
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() event: PullRequestEvent,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-event') eventType: string
  ) {
    // Vérifier la signature du webhook pour la sécurité
    if (!this.verifySignature(signature, JSON.stringify(event))) {
      throw new BadRequestException('Invalid webhook signature');
    }

    // Ne traiter que les événements de pull request
    if (eventType !== 'pull_request') {
      return { status: 'ignored', message: 'Not a pull request event' };
    }

    // Ne traiter que les pull requests ouvertes ou mises à jour
    const validActions = ['opened', 'synchronize', 'reopened'];
    if (!validActions.includes(event.action)) {
      return { 
        status: 'ignored', 
        message: `Ignoring action ${event.action}` 
      };
    }

    // Ne traiter que les pull requests qui sont ouvertes
    if (event.pull_request.state !== 'open') {
      return { 
        status: 'ignored', 
        message: `Ignoring PR in state ${event.pull_request.state}` 
      };
    }

    try {
      // Lancer la revue de code avec le service GitHub
      console.log(`Processing pull request #${event.pull_request.number} for repository ${event.repository.full_name}`);
      
      // Ne pas afficher le résumé par défaut (false)
      const postSummary = this.configService.get<boolean>('POST_SUMMARY', false);
      
      const review = await this.codeReviewService.reviewMergeRequest(
        event.repository.full_name,
        event.pull_request.number,
        event.sender.id.toString(),
        this.githubService,
        postSummary
      );

      return {
        status: 'success',
        review: {
          id: review.id,
          status: review.status,
          commentCount: review.comments.length
        }
      };
    } catch (error) {
      console.error('Error processing webhook:', error);
      return { 
        status: 'error', 
        message: `Failed to process webhook: ${error.message}` 
      };
    }
  }

  private verifySignature(signature: string, payload: string): boolean {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret || !signature) {
      return false;
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }
}
