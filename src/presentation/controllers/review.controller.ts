import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateReviewDto } from '../dtos/create-review.dto';
import { AnalyzeMergeRequestUseCase } from '@core/usecases/analyze-merge-request.usecase';
import { Review } from '@core/domain/entities/review.entity';

@ApiTags('review')
@Controller('review')
export class ReviewController {
  constructor(
    private readonly analyzeMergeRequestUseCase: AnalyzeMergeRequestUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new code review for a merge request' })
  @ApiResponse({ status: 201, description: 'The review has been created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  async createReview(@Body() createReviewDto: CreateReviewDto): Promise<Review> {
    try {
      return await this.analyzeMergeRequestUseCase.execute(
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