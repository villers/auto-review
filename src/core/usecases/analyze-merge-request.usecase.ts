import { v4 as uuidv4 } from 'uuid';
import { AIService } from '../interfaces/ai-service.interface';
import { ReviewRepository } from '../domain/repositories/review.repository';
import { VersionControlRepository } from '../domain/repositories/version-control.repository';
import { Review, ReviewComment, ReviewStatus } from '../domain/entities/review.entity';

export class AnalyzeMergeRequestUseCase {
  constructor(
      private readonly reviewRepository: ReviewRepository,
      private readonly versionControlRepository: VersionControlRepository,
      private readonly aiService: AIService,
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

    await this.reviewRepository.createReview(review);

    try {
      // Update status to in progress
      const updatedReview = new Review(
          review.id,
          review.projectId,
          review.mergeRequestId,
          review.commitSha,
          review.createdAt,
          review.userId,
          ReviewStatus.IN_PROGRESS,
          review.comments,
          review.summary
      );
      await this.reviewRepository.updateReview(updatedReview);

      // IMPORTANT: Supprimer d'abord les anciens commentaires AVANT d'en ajouter de nouveaux
      await this.versionControlRepository.clearPreviousComments(
          projectId,
          mergeRequestId
      );

      // Get the files from the merge request
      const mrFiles = await this.versionControlRepository.getMergeRequestDiff(
          projectId,
          mergeRequestId,
      );

      // Analyze the code using AI service
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
      const completedReview = new Review(
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

      // Assurez-vous de renvoyer l'objet review avec le statut COMPLETED
      const savedReview = await this.reviewRepository.updateReview(completedReview);
      // Vérifier que le statut est conservé
      if (savedReview.status !== ReviewStatus.COMPLETED) {
        console.warn('Review status was changed unexpectedly. Creating new review with COMPLETED status.');
        // Créer une nouvelle instance au lieu de modifier directement la propriété en lecture seule
        const correctedReview = new Review(
          savedReview.id,
          savedReview.projectId,
          savedReview.mergeRequestId,
          savedReview.commitSha,
          savedReview.createdAt,
          savedReview.userId,
          ReviewStatus.COMPLETED, // Force le statut à COMPLETED
          savedReview.comments,
          savedReview.summary
        );
        return await this.reviewRepository.updateReview(correctedReview);
      }
      return savedReview;
    } catch (error) {
      // Update review status to failed
      const failedReview = new Review(
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

      return await this.reviewRepository.updateReview(failedReview);
    }
  }
}