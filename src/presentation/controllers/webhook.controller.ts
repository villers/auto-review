import { Controller, Post, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags, ApiHeader, ApiBody, ApiResponse } from '@nestjs/swagger';
import { AnalyzeMergeRequestUseCase } from '@core/usecases/analyze-merge-request.usecase';

@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly analyzeMergeRequestUseCase: AnalyzeMergeRequestUseCase,
    private readonly configService: ConfigService,
  ) {}

  @Post('gitlab')
  @ApiOperation({ 
    summary: 'Handle GitLab webhook events',
    description: 'Endpoint for GitLab webhook integration to automatically trigger code reviews on merge request events'
  })
  @ApiHeader({
    name: 'x-gitlab-token',
    description: 'GitLab webhook secret token for authentication',
    required: true
  })
  @ApiBody({
    description: 'GitLab webhook payload for merge request events',
    schema: {
      type: 'object',
      required: ['object_kind', 'object_attributes', 'project'],
      properties: {
        object_kind: { 
          type: 'string', 
          example: 'merge_request',
          description: 'Type of GitLab event' 
        },
        object_attributes: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 42 },
            iid: { type: 'number', example: 5 },
            action: { 
              type: 'string', 
              example: 'open',
              description: 'The action performed on the merge request (open, update, close, etc.)'
            }
          }
        },
        project: {
          type: 'object',
          properties: {
            id: { type: 'number', example: 12345 },
            name: { type: 'string', example: 'My Project' },
            path_with_namespace: { type: 'string', example: 'group/project' }
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Review process started' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid webhook token' })
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
  @ApiOperation({ 
    summary: 'Handle GitHub webhook events',
    description: 'Endpoint for GitHub webhook integration to automatically trigger code reviews on pull request events'
  })
  @ApiHeader({
    name: 'x-hub-signature-256',
    description: 'GitHub webhook signature for request validation',
    required: true
  })
  @ApiBody({
    description: 'GitHub webhook payload for pull request events',
    schema: {
      type: 'object',
      required: ['action', 'pull_request', 'repository'],
      properties: {
        action: { 
          type: 'string', 
          example: 'opened', 
          description: 'The action performed on the pull request (opened, synchronize, closed, etc.)' 
        },
        pull_request: {
          type: 'object',
          properties: {
            number: { type: 'number', example: 42 },
            title: { type: 'string', example: 'Add new feature' },
            state: { type: 'string', example: 'open' }
          }
        },
        repository: {
          type: 'object',
          properties: {
            full_name: { type: 'string', example: 'owner/repo' },
            name: { type: 'string', example: 'repo' },
            owner: { 
              type: 'object',
              properties: {
                login: { type: 'string', example: 'owner' }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Webhook processed successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Review process started for GitHub PR' }
      }
    }
  })
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