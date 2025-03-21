import { Controller, Post, Body, Headers, HttpCode, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeReviewService } from '../../core/services/code-review.service';
import { GitlabService } from '../../adapters/vcs/gitlab.service';

interface MergeRequestEvent {
  object_kind: string;
  project: {
    id: number;
    path_with_namespace: string;
  };
  object_attributes: {
    id: number;
    iid: number;
    action: string;
    state: string;
  };
  user: {
    id: number;
    username: string;
  };
}

@Controller('webhook/gitlab')
export class GitlabController {
  constructor(
    private readonly codeReviewService: CodeReviewService,
    private readonly gitlabService: GitlabService,
    private readonly configService: ConfigService
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() event: MergeRequestEvent,
    @Headers('x-gitlab-token') token: string
  ) {
    // Vérifier le token de webhook pour la sécurité
    const configToken = this.configService.get<string>('GITLAB_WEBHOOK_TOKEN');
    if (configToken && token !== configToken) {
      throw new BadRequestException('Invalid webhook token');
    }

    // Ne traiter que les événements de merge request
    if (event.object_kind !== 'merge_request') {
      return { status: 'ignored', message: 'Not a merge request event' };
    }

    // Ne traiter que les merge requests ouvertes ou mises à jour
    const validActions = ['open', 'update', 'reopen'];
    if (!validActions.includes(event.object_attributes.action)) {
      return { 
        status: 'ignored', 
        message: `Ignoring action ${event.object_attributes.action}` 
      };
    }

    // Ne traiter que les merge requests qui sont ouvertes
    if (event.object_attributes.state !== 'opened') {
      return { 
        status: 'ignored', 
        message: `Ignoring MR in state ${event.object_attributes.state}` 
      };
    }

    try {
      // Lancer la revue de code avec le service GitLab
      console.log(`Processing merge request ${event.object_attributes.iid} for project ${event.project.path_with_namespace}`);
      
      const review = await this.codeReviewService.reviewMergeRequest(
        event.project.id.toString(), 
        event.object_attributes.iid,
        event.user.id.toString(),
        this.gitlabService // Passer explicitement le service GitLab
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
}
