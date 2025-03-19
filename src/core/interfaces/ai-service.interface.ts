import { CodeFile } from '../domain/entities/code-file.entity';
import { CommentCategory, CommentSeverity, ReviewComment } from '../domain/entities/review.entity';

export interface AIServiceResponse {
  comments: {
    filePath: string;
    lineNumber: number;
    content: string;
    category: CommentCategory;
    severity: CommentSeverity;
  }[];
  summary: string;
}

export interface AIService {
  analyzeCode(files: CodeFile[]): Promise<AIServiceResponse>;
}