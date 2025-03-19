import { Review, ReviewComment } from '../entities/review.entity';

export interface ReviewRepository {
  createReview(review: Review): Promise<Review>;
  getReviewById(id: string): Promise<Review | null>;
  getReviewsByProjectId(projectId: string): Promise<Review[]>;
  getReviewsByMergeRequestId(projectId: string, mergeRequestId: number): Promise<Review[]>;
  updateReview(review: Review): Promise<Review>;
  addCommentToReview(reviewId: string, comment: ReviewComment): Promise<Review>;
  deleteReview(id: string): Promise<boolean>;
}