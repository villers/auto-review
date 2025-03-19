import { describe, it, expect, beforeEach } from 'vitest';
import { GetReviewUseCase } from '../../../src/core/usecases/get-review.usecase';
import { MockReviewRepository } from '../../mocks/repositories.mock';
import { Review, ReviewStatus } from '../../../src/core/domain/entities/review.entity';

describe('GetReviewUseCase', () => {
  let useCase: GetReviewUseCase;
  let reviewRepository: MockReviewRepository;

  beforeEach(() => {
    reviewRepository = new MockReviewRepository();
    useCase = new GetReviewUseCase(reviewRepository);
  });

  it('should return a review by ID if it exists', async () => {
    // Arrange
    const reviewId = 'test-review-id';
    const review = new Review(
      reviewId,
      'project-1',
      123,
      'commit-sha',
      new Date(),
      'user-1',
      ReviewStatus.COMPLETED,
      [],
      'Review completed successfully'
    );
    
    await reviewRepository.createReview(review);

    // Act
    const result = await useCase.execute(reviewId);

    // Assert
    expect(result).toBeDefined();
    expect(result?.id).toBe(reviewId);
    expect(result?.projectId).toBe('project-1');
    expect(result?.status).toBe(ReviewStatus.COMPLETED);
  });

  it('should return null if the review does not exist', async () => {
    // Act
    const result = await useCase.execute('non-existent-id');

    // Assert
    expect(result).toBeNull();
  });
});