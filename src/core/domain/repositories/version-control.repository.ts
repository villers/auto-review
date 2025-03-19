import { CodeFile } from '../entities/code-file.entity';

export interface VersionControlRepository {
  getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]>;
  getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]>;
  getFileContent(projectId: string, filePath: string, ref?: string): Promise<string>;
  submitComment(projectId: string, mergeRequestId: number, comment: {
    filePath: string, 
    lineNumber: number, 
    content: string
  }): Promise<boolean>;
  submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean>;
  clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void>;
}