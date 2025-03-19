import { ApiProperty } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty({
    description: 'The GitLab project ID',
    example: '12345',
  })
  projectId: string;

  @ApiProperty({
    description: 'The merge request ID to review',
    example: 42,
  })
  mergeRequestId: number;

  @ApiProperty({
    description: 'The user ID initiating the review',
    example: 'user123',
  })
  userId: string;
}