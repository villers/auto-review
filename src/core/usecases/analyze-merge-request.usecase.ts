import { v4 as uuidv4 } from 'uuid';
import { Inject, Injectable } from '@nestjs/common';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { Review, ReviewComment, ReviewStatus } from '@core/domain/entities/review.entity';
import { AIRepository } from "@core/domain/repositories/ai.repository";
import { AI_REPOSITORY_TOKEN, VERSION_CONTROL_REPOSITORY_TOKEN } from '@core/domain/repositories/injection-tokens';

@Injectable()
export class AnalyzeMergeRequestUseCase {
  constructor(
      @Inject(VERSION_CONTROL_REPOSITORY_TOKEN) private readonly versionControlRepository: VersionControlRepository,
      @Inject(AI_REPOSITORY_TOKEN) private readonly aiService: AIRepository,
  ) {}

  async execute(
      projectId: string,
      mergeRequestId: number,
      userId: string,
  ): Promise<Review> {
    // Create a new review record
    const reviewId = uuidv4();
    const review = new Review(
        reviewId,
        projectId,
        mergeRequestId,
        '', // Will be updated once we get actual commit SHA
        new Date(),
        userId,
        ReviewStatus.PENDING,
        [],
    );

    try {
      await this.versionControlRepository.clearPreviousComments(
          projectId,
          mergeRequestId
      );

      const mrFiles = await this.versionControlRepository.getMergeRequestDiff(
          projectId,
          mergeRequestId,
      );

      const aiResponse = await this.aiService.analyzeCode(mrFiles);

      // Create review comments from AI response
      const comments: ReviewComment[] = aiResponse.comments.map((comment) => {
        return new ReviewComment(
            uuidv4(),
            comment.filePath,
            comment.lineNumber,
            comment.content,
            comment.category,
            comment.severity,
            new Date(),
        );
      });

      // Post comments to GitLab
      for (const comment of comments) {
        await this.versionControlRepository.submitComment(
            projectId,
            mergeRequestId,
            {
              filePath: comment.filePath,
              lineNumber: comment.lineNumber,
              content: comment.content,
            },
        );
      }

      // Submit review summary
      await this.versionControlRepository.submitReviewSummary(
          projectId,
          mergeRequestId,
          aiResponse.summary,
      );

      // Update the review record with comments and status
      return new Review(
          review.id,
          review.projectId,
          review.mergeRequestId,
          review.commitSha,
          review.createdAt,
          review.userId,
          ReviewStatus.COMPLETED,
          comments,
          aiResponse.summary,
      );
    } catch (error) {
      return new Review(
          review.id,
          review.projectId,
          review.mergeRequestId,
          review.commitSha,
          review.createdAt,
          review.userId,
          ReviewStatus.FAILED,
          review.comments,
          `Error: Failed to fetch diff - ${error.message}`,
      );
    }
  }
}