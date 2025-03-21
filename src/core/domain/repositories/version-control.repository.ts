import { CodeFile } from '@core/domain/entities/code-file.entity';

/**
 * Repository interface for interacting with version control systems (GitHub, GitLab, etc.)
 */
export interface VersionControlRepository {
  /**
   * Get the files and their changes from a merge/pull request
   */
  getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]>;
  
  /**
   * Get the content of a specific file at a given reference point
   */
  getFileContent(projectId: string, filePath: string, ref?: string): Promise<string>;
  
  /**
   * Submit a comment on a specific line of a file in a merge/pull request
   */
  submitComment(projectId: string, mergeRequestId: number, comment: {
    filePath: string, 
    lineNumber: number, 
    content: string
  }): Promise<boolean>;
  
  /**
   * Submit an overall summary comment on a merge/pull request
   */
  submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean>;
  
  /**
   * Clear previously submitted AI-generated comments on a merge/pull request
   */
  clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void>;
}