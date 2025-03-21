import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export enum VcsType {
  GITLAB = 'gitlab',
  GITHUB = 'github'
}

export enum AIProviderType {
  CLAUDE = 'claude',
  OPENAI = 'openai'
}

export enum AIModelType {
  // Claude models
  CLAUDE_OPUS = 'claude_opus',
  CLAUDE_SONNET = 'claude_sonnet',
  CLAUDE_HAIKU = 'claude_haiku',
  // OpenAI models
  GPT4 = 'gpt4',
  GPT35 = 'gpt35'
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

  @ApiProperty({
    description: 'The AI provider to use (claude or openai)',
    enum: AIProviderType,
    example: 'claude',
    default: AIProviderType.CLAUDE,
    required: false
  })
  @IsOptional()
  @IsEnum(AIProviderType, {
    message: 'aiProvider must be either "claude" or "openai"'
  })
  aiProvider?: AIProviderType = AIProviderType.CLAUDE;

  @ApiProperty({
    description: 'The AI model to use',
    enum: AIModelType,
    example: 'claude_opus',
    required: false
  })
  @IsOptional()
  @IsEnum(AIModelType, {
    message: 'aiModel must be one of the supported models'
  })
  aiModel?: AIModelType;
}