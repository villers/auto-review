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
  
  // Une seule ligne ou la ligne de début pour un commentaire multi-lignes
  lineNumber: number;
  
  // Ligne de fin pour un commentaire multi-lignes (optionnel)
  endLineNumber?: number;
  
  category: CommentCategory;
  severity: Severity;
  content: string;
}

export interface AiResponse {
  comments: Comment[];
  summary: string;
}
