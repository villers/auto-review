import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export enum VcsType {
  GITLAB = 'gitlab',
  GITHUB = 'github'
}

export class CreateReviewDto {
  @ApiProperty({
    description: 'The project ID (GitLab) or repo (owner/repo for GitHub)',
    example: '12345 or owner/repo',
  })
  @IsNotEmpty()
  @IsString()
  projectId: string;

  @ApiProperty({
    description: 'The merge request ID to review',
    example: 42,
  })
  @IsNotEmpty()
  @IsNumber()
  mergeRequestId: number;

  @ApiProperty({
    description: 'The user ID initiating the review',
    example: 'user123',
  })
  @IsNotEmpty()
  @IsString()
  userId: string;

  @ApiProperty({
    description: 'The version control system type (gitlab or github)',
    enum: VcsType,
    example: 'gitlab',
    default: VcsType.GITLAB
  })
  @IsEnum(VcsType, {
    message: 'vcsType must be either "gitlab" or "github"'
  })
  vcsType: VcsType = VcsType.GITLAB;
}