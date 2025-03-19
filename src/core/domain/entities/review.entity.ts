export class Review {
  constructor(
    public readonly id: string,
    public readonly projectId: string,
    public readonly mergeRequestId: number,
    public readonly commitSha: string,
    public readonly createdAt: Date,
    public readonly userId: string,
    public readonly status: ReviewStatus,
    public readonly comments: ReviewComment[] = [],
    public readonly summary?: string,
  ) {}
}

export enum ReviewStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export class ReviewComment {
  constructor(
    public readonly id: string,
    public readonly filePath: string,
    public readonly lineNumber: number,
    public readonly content: string,
    public readonly category: CommentCategory,
    public readonly severity: CommentSeverity,
    public readonly createdAt: Date,
  ) {}
}

export enum CommentCategory {
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  STYLE = 'style',
  BEST_PRACTICE = 'best_practice',
  BUG = 'bug',
  OTHER = 'other',
}

export enum CommentSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}