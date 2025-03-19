import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewController } from '../../../src/presentation/controllers/review.controller';
import { AnalyzeMergeRequestUseCase } from '../../../src/core/usecases/analyze-merge-request.usecase';
import { GetReviewUseCase } from '../../../src/core/usecases/get-review.usecase';
import { Review, ReviewStatus } from '../../../src/core/domain/entities/review.entity';
import { CreateReviewDto } from '../../../src/presentation/dtos/create-review.dto';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('ReviewController', () => {
  let controller: ReviewController;
  let analyzeMRUseCase: {
    execute: vi.Mock;
  };
  let getReviewUseCase: {
    execute: vi.Mock;
  };

  beforeEach(() => {
    // Create mock use cases
    analyzeMRUseCase = {
      execute: vi.fn()
    };
    
    getReviewUseCase = {
      execute: vi.fn()
    };
    
    controller = new ReviewController(
      analyzeMRUseCase as unknown as AnalyzeMergeRequestUseCase,
      getReviewUseCase as unknown as GetReviewUseCase
    );
  });

  describe('createReview', () => {
    it('should create a review successfully', async () => {
      // Arrange
      const dto: CreateReviewDto = {
        projectId: 'test-project',
        mergeRequestId: 123,
        userId: 'test-user'
      };
      
      const mockReview = new Review(
        'review-id',
        dto.projectId,
        dto.mergeRequestId,
        'commit-sha',
        new Date(),
        dto.userId,
        ReviewStatus.COMPLETED,
        [],
        'Review completed'
      );
      
      analyzeMRUseCase.execute.mockResolvedValue(mockReview);

      // Act
      const result = await controller.createReview(dto);

      // Assert
      expect(result).toBe(mockReview);
      expect(analyzeMRUseCase.execute).toHaveBeenCalledWith(
        dto.projectId,
        dto.mergeRequestId,
        dto.userId
      );
    });

    it('should throw HttpException when creation fails', async () => {
      // Arrange
      const dto: CreateReviewDto = {
        projectId: 'test-project',
        mergeRequestId: 123,
        userId: 'test-user'
      };
      
      analyzeMRUseCase.execute.mockRejectedValue(new Error('Creation failed'));

      // Act & Assert
      await expect(controller.createReview(dto))
        .rejects.toThrow(HttpException);
    });
  });

  describe('getReview', () => {
    it('should return a review by ID', async () => {
      // Arrange
      const reviewId = 'test-review-id';
      
      const mockReview = new Review(
        reviewId,
        'project-id',
        123,
        'commit-sha',
        new Date(),
        'user-id',
        ReviewStatus.COMPLETED,
        [],
        'Review completed'
      );
      
      getReviewUseCase.execute.mockResolvedValue(mockReview);

      // Act
      const result = await controller.getReview(reviewId);

      // Assert
      expect(result).toBe(mockReview);
      expect(getReviewUseCase.execute).toHaveBeenCalledWith(reviewId);
    });

    it('should throw HttpException when review not found', async () => {
      // Arrange
      const reviewId = 'non-existent-id';
      
      getReviewUseCase.execute.mockResolvedValue(null);

      // Act & Assert
      await expect(controller.getReview(reviewId))
        .rejects.toThrow(HttpException);
      
      expect(getReviewUseCase.execute).toHaveBeenCalledWith(reviewId);
    });
  });
});