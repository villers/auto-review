import { Controller, Post, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyzeMergeRequestUseCase } from '../../core/usecases/analyze-merge-request.usecase';

@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly analyzeMergeRequestUseCase: AnalyzeMergeRequestUseCase,
    private readonly configService: ConfigService,
  ) {}

  @Post('gitlab')
  @ApiOperation({ summary: 'Handle GitLab webhook events' })
  async handleGitlabWebhook(
    @Headers('x-gitlab-token') token: string,
    @Body() webhookData: any,
  ): Promise<{ message: string }> {
    // Verify webhook token
    const configuredToken = this.configService.get<string>('GITLAB_WEBHOOK_TOKEN');
    if (configuredToken && token !== configuredToken) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    // Check if this is a merge request event
    if (webhookData.object_kind === 'merge_request') {
      const mrEvent = webhookData.object_attributes;
      
      // Only process when MR is opened or updated
      if (['open', 'update'].includes(mrEvent.action)) {
        // Start the review process in the background
        this.analyzeMergeRequestUseCase
          .execute(
            webhookData.project.id.toString(),
            mrEvent.iid,
            'system', // System-triggered webhook
          )
          .catch(error => {
            console.error('Error processing webhook review:', error);
          });
        
        return { message: 'Review process started' };
      }
    }
    
    return { message: 'Event ignored' };
  }

  @Post('github')
  @ApiOperation({ summary: 'Handle GitHub webhook events' })
  async handleGithubWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Body() webhookData: any,
  ): Promise<{ message: string }> {
    // In a real implementation, you would verify the signature
    // using the GITHUB_WEBHOOK_SECRET
    
    // Check if this is a pull request event
    if (webhookData.action === 'opened' || webhookData.action === 'synchronize') {
      const pr = webhookData.pull_request;
      const repoFullName = webhookData.repository.full_name; // Format: 'owner/repo'
      
      // Start the review process in the background
      this.analyzeMergeRequestUseCase
        .execute(
          repoFullName, // GitHub projectId is 'owner/repo'
          pr.number,    // The PR number
          'system',     // System-triggered webhook
        )
        .catch(error => {
          console.error('Error processing GitHub webhook review:', error);
        });
      
      return { message: 'Review process started for GitHub PR' };
    }
    
    return { message: 'Event ignored' };
  }
}