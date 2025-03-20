import {VersionControlRepository} from "@core/domain/repositories/version-control.repository";
import {CodeFile} from "@core/domain/entities/code-file.entity";

export class MockVersionControlRepository implements VersionControlRepository {
  private readonly files: Map<string, string> = new Map();
  private diffFiles: CodeFile[] = [];
  private readonly comments: any[] = [];
  private readonly summaries: Map<string, string> = new Map();

  // Ajouter la méthode manquante
  async clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void> {
    // Ne rien faire dans le mock
    return;
  }

  constructor(mockFiles: CodeFile[] = []) {
    this.diffFiles = mockFiles;
  }

  setMockFiles(files: CodeFile[]): void {
    this.diffFiles = files;
  }

  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.diffFiles;
  }

  async getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.diffFiles;
  }

  async getFileContent(projectId: string, filePath: string, ref?: string): Promise<string> {
    const key = `${projectId}/${filePath}/${ref || 'default'}`;
    const content = this.files.get(key);
    if (!content) {
      throw new Error(`File not found: ${filePath}`);
    }
    return content;
  }

  async submitComment(
      projectId: string,
      mergeRequestId: number,
      comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean> {
    this.comments.push({
      projectId,
      mergeRequestId,
      ...comment
    });
    return true;
  }

  getSubmittedComments(): any[] {
    return this.comments;
  }

  async submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean> {
    const key = `${projectId}/${mergeRequestId}`;
    this.summaries.set(key, summary);
    return true;
  }

  getSubmittedSummary(projectId: string, mergeRequestId: number): string | undefined {
    const key = `${projectId}/${mergeRequestId}`;
    return this.summaries.get(key);
  }
}