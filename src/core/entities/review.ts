import { CommentCategory, Severity } from './ai-response';

export enum ReviewStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber: number;
  endLineNumber?: number; // Ligne de fin pour un commentaire multi-lignes
  content: string;
  category: CommentCategory;
  severity: Severity;
  createdAt: Date;
}

export interface Review {
  id: string;
  projectId: string;
  mergeRequestId: number;
  userId: string;
  createdAt: Date;
  status: ReviewStatus;
  comments: ReviewComment[];
  summary?: string;
}
