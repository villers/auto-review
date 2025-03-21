export enum CommentCategory {
  BUG = 'bug',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  STYLE = 'style',
  MAINTENANCE = 'maintenance',
  OTHER = 'other'
}

export enum Severity {
  CRITICAL = 'critical',
  MAJOR = 'major',
  MINOR = 'minor'
}

export interface Comment {
  filePath: string;
  lineNumber: number;
  content: string;
  category: CommentCategory;
  severity: Severity;
}

export interface AiResponse {
  comments: Comment[];
  summary: string;
}
