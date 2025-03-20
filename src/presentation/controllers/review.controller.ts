import { Controller, Post, Body, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBody, ApiParam } from '@nestjs/swagger';
import { CreateReviewDto, VcsType } from '../dtos/create-review.dto';
import { AnalyzeMergeRequestUseCase } from '@core/usecases/analyze-merge-request.usecase';
import { Review, ReviewStatus, CommentCategory, CommentSeverity } from '@core/domain/entities/review.entity';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { GitlabRepository } from '@infrastructure/persistence/gitlab.repository';
import { GithubRepository } from '@infrastructure/persistence/github.repository';
import { ClaudeAIService } from '@infrastructure/persistence/claude-ai.service';

@ApiTags('review')
@Controller('review')
export class ReviewController {
  constructor(
    private readonly gitlabRepository: GitlabRepository,
    private readonly githubRepository: GithubRepository,
    private readonly claudeAIService: ClaudeAIService
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new code review for a merge/pull request',
    description: 'Analyze code in a GitLab merge request or GitHub pull request using AI and provide detailed feedback'
  })
  @ApiBody({
    type: CreateReviewDto,
    description: 'Request parameters for the code review',
    examples: {
      gitlab: {
        summary: 'GitLab review example',
        value: {
          projectId: '12345',
          mergeRequestId: 42,
          userId: 'user123',
          vcsType: 'gitlab'
        }
      },
      github: {
        summary: 'GitHub review example',
        value: {
          projectId: 'owner/repo',
          mergeRequestId: 42,
          userId: 'user123',
          vcsType: 'github'
        }
      }
    }
  })
  @ApiResponse({
    status: 201,
    description: 'The review has been created successfully.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
        projectId: { type: 'string', example: '12345' },
        mergeRequestId: { type: 'number', example: 42 },
        commitSha: { type: 'string', example: 'abcdef1234567890' },
        createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T14:30:00Z' },
        userId: { type: 'string', example: 'user123' },
        status: { 
          type: 'string', 
          enum: Object.values(ReviewStatus),
          example: 'completed' 
        },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174000' },
              filePath: { type: 'string', example: 'src/app.js' },
              lineNumber: { type: 'number', example: 42 },
              content: { type: 'string', example: 'Consider using const instead of let as this variable is not reassigned' },
              category: { 
                type: 'string', 
                enum: Object.values(CommentCategory),
                example: 'best_practice' 
              },
              severity: { 
                type: 'string', 
                enum: Object.values(CommentSeverity),
                example: 'medium' 
              },
              createdAt: { type: 'string', format: 'date-time', example: '2023-01-15T14:35:00Z' },
            }
          }
        },
        summary: { type: 'string', example: 'Overall code quality is good, with some minor style improvements suggested.' },
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  @ApiResponse({ status: 500, description: 'Internal server error or AI service failure.' })
  async createReview(@Body() createReviewDto: CreateReviewDto): Promise<Review> {
    try {
      // Select the appropriate repository based on VCS type
      const repository: VersionControlRepository = 
        createReviewDto.vcsType === VcsType.GITHUB ? 
        this.githubRepository : 
        this.gitlabRepository;
      
      // Create the use case with the selected repository
      const useCase = new AnalyzeMergeRequestUseCase(repository, this.claudeAIService);
      
      return await useCase.execute(
        createReviewDto.projectId,
        createReviewDto.mergeRequestId,
        createReviewDto.userId,
      );
    } catch (error) {
      throw new HttpException(
        `Failed to create review: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}