import { ReviewRepository } from '../domain/repositories/review.repository';
import { Review } from '../domain/entities/review.entity';

export class GetReviewUseCase {
  constructor(private readonly reviewRepository: ReviewRepository) {}

  async execute(id: string): Promise<Review | null> {
    return this.reviewRepository.getReviewById(id);
  }
}