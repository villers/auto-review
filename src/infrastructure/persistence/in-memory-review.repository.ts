import { Injectable } from '@nestjs/common';
import { Review, ReviewComment } from '../../core/domain/entities/review.entity';
import { ReviewRepository } from '../../core/domain/repositories/review.repository';

/**
 * InMemoryReviewRepository - A simple in-memory implementation of ReviewRepository
 * Note: This is meant for development/testing only. In production, use a proper database.
 */
@Injectable()
export class InMemoryReviewRepository implements ReviewRepository {
  private reviews: Map<string, Review> = new Map();

  async createReview(review: Review): Promise<Review> {
    this.reviews.set(review.id, review);
    return review;
  }

  async getReviewById(id: string): Promise<Review | null> {
    return this.reviews.get(id) || null;
  }

  async getReviewsByProjectId(projectId: string): Promise<Review[]> {
    return Array.from(this.reviews.values())
      .filter(review => review.projectId === projectId);
  }

  async getReviewsByMergeRequestId(projectId: string, mergeRequestId: number): Promise<Review[]> {
    return Array.from(this.reviews.values())
      .filter(
        review => 
          review.projectId === projectId && 
          review.mergeRequestId === mergeRequestId
      );
  }

  async updateReview(review: Review): Promise<Review> {
    this.reviews.set(review.id, review);
    return review;
  }

  async addCommentToReview(reviewId: string, comment: ReviewComment): Promise<Review> {
    const review = await this.getReviewById(reviewId);
    if (!review) {
      throw new Error(`Review with id ${reviewId} not found`);
    }

    const updatedReview = new Review(
      review.id,
      review.projectId,
      review.mergeRequestId,
      review.commitSha,
      review.createdAt,
      review.userId,
      review.status,
      [...review.comments, comment],
      review.summary,
    );

    return this.updateReview(updatedReview);
  }

  async deleteReview(id: string): Promise<boolean> {
    return this.reviews.delete(id);
  }
}