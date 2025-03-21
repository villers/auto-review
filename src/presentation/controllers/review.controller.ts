import { Controller, Post, Body, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiOperation, ApiResponse, ApiTags, ApiBody, ApiParam } from '@nestjs/swagger';
import { v4 as uuidv4 } from 'uuid';
import { CreateReviewDto, VcsType, AIProviderType, AIModelType } from '../dtos/create-review.dto';
import { AnalyzeMergeRequestUseCase } from '@core/usecases/analyze-merge-request.usecase';
import { Review, ReviewStatus, CommentCategory, CommentSeverity, ReviewComment } from '@core/domain/entities/review.entity';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { GitlabRepository } from '@infrastructure/persistence/gitlab.repository';
import { GithubRepository } from '@infrastructure/persistence/github.repository';
import { AIRepository } from '@core/domain/repositories/ai.repository';
import { AI_REPOSITORY_TOKEN, VERSION_CONTROL_REPOSITORY_TOKEN } from '@core/domain/repositories/injection-tokens';
import { AIFactoryService, AIProvider, ClaudeModel, OpenAIModel } from '@infrastructure/persistence/ai.factory.service';

@ApiTags('review')
@Controller('review')
export class ReviewController {
  constructor(
    private readonly gitlabRepository: GitlabRepository,
    private readonly githubRepository: GithubRepository,
    @Inject(AI_REPOSITORY_TOKEN) private readonly aiRepository: AIRepository,
    private readonly aiFactoryService: AIFactoryService,
    private readonly analyzeMergeRequestUseCase: AnalyzeMergeRequestUseCase,
    private readonly moduleRef: ModuleRef
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
      
      // Configure AI provider and model if specified
      if (createReviewDto.aiProvider) {
        // Set the AI provider
        if (createReviewDto.aiProvider === AIProviderType.CLAUDE) {
          this.aiFactoryService.setProvider(AIProvider.CLAUDE);
          
          // Set Claude model if specified
          if (createReviewDto.aiModel) {
            switch (createReviewDto.aiModel) {
              case AIModelType.CLAUDE_OPUS:
                this.aiFactoryService.setClaudeModel(ClaudeModel.OPUS);
                break;
              case AIModelType.CLAUDE_SONNET:
                this.aiFactoryService.setClaudeModel(ClaudeModel.SONNET);
                break;
              case AIModelType.CLAUDE_HAIKU:
                this.aiFactoryService.setClaudeModel(ClaudeModel.HAIKU);
                break;
            }
          }
        } else if (createReviewDto.aiProvider === AIProviderType.OPENAI) {
          this.aiFactoryService.setProvider(AIProvider.OPENAI);
          
          // Set OpenAI model if specified
          if (createReviewDto.aiModel) {
            switch (createReviewDto.aiModel) {
              case AIModelType.GPT4:
                this.aiFactoryService.setOpenAIModel(OpenAIModel.GPT4);
                break;
              case AIModelType.GPT35:
                this.aiFactoryService.setOpenAIModel(OpenAIModel.GPT35);
                break;
            }
          }
        }
      }
      
      // La factory dans app.module.ts fournit le repository par défaut,
      // mais nous devons mettre à jour ce repository en fonction du type de VCS spécifié dans la requête
      let useCase = this.analyzeMergeRequestUseCase;
      
      try {
        // Utilisez moduleRef pour récupérer le provider et le mettre à jour
        const vcsRepositoryProvider = this.moduleRef.get(VERSION_CONTROL_REPOSITORY_TOKEN, { strict: false });
        
        // Remplacer le repository dans le provider dynamiquement
        if (vcsRepositoryProvider) {
          Object.assign(vcsRepositoryProvider, repository);
        }
      } catch (error) {
        console.warn('Could not update VCS repository provider:', error.message);
        // Puisque nous ne pouvons pas modifier directement le useCase, 
        // créons un objet proxy qui intercepte les appels au repository
        useCase = {
          execute: async (projectId: string, mergeRequestId: number, userId: string) => {
            // Créer une instance de Review avec les informations de base
            const reviewId = uuidv4();
            const review = new Review(
              reviewId,
              projectId,
              mergeRequestId,
              '',
              new Date(),
              userId,
              ReviewStatus.PENDING,
              []
            );
            
            try {
              // Utiliser directement le repository spécifié et notre aiRepository
              await repository.clearPreviousComments(projectId, mergeRequestId);
              const mrFiles = await repository.getMergeRequestDiff(projectId, mergeRequestId);
              const aiResponse = await this.aiRepository.analyzeCode(mrFiles);
              
              // Créer des commentaires de revue à partir de la réponse de l'IA
              const comments = aiResponse.comments.map((comment) => {
                return new ReviewComment(
                  uuidv4(),
                  comment.filePath,
                  comment.lineNumber,
                  comment.content,
                  comment.category,
                  comment.severity,
                  new Date()
                );
              });
              
              // Poster les commentaires
              for (const comment of comments) {
                await repository.submitComment(
                  projectId,
                  mergeRequestId,
                  {
                    filePath: comment.filePath,
                    lineNumber: comment.lineNumber,
                    content: comment.content,
                  }
                );
              }
              
              // Soumettre le résumé de la revue
              await repository.submitReviewSummary(
                projectId,
                mergeRequestId,
                aiResponse.summary
              );
              
              // Mettre à jour et retourner l'enregistrement de la revue
              return new Review(
                review.id,
                review.projectId,
                review.mergeRequestId,
                review.commitSha,
                review.createdAt,
                review.userId,
                ReviewStatus.COMPLETED,
                comments,
                aiResponse.summary
              );
            } catch (error) {
              // En cas d'erreur, retourner une revue avec le statut d'échec
              return new Review(
                review.id,
                review.projectId,
                review.mergeRequestId,
                review.commitSha,
                review.createdAt,
                review.userId,
                ReviewStatus.FAILED,
                [],
                `Error: Failed to fetch diff - ${error.message}`
              );
            }
          }
        } as AnalyzeMergeRequestUseCase;
      }
      
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