import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { CodeFile, DiffType, FileDiff } from '@core/domain/entities/code-file.entity';

/**
 * Base class for version control adapters that implements common functionality
 */
@Injectable()
export abstract class VersionControlAdapter implements VersionControlRepository {
  protected readonly apiBaseUrl: string;
  protected readonly apiToken: string;

  constructor(
    protected readonly configService: ConfigService,
    baseUrlConfigKey: string,
    tokenConfigKey: string,
    defaultBaseUrl: string
  ) {
    this.apiBaseUrl = this.configService.get<string>(baseUrlConfigKey, defaultBaseUrl);
    this.apiToken = this.configService.get<string>(tokenConfigKey, '');
  }

  abstract getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]>;
  
  async getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.getMergeRequestFiles(projectId, mergeRequestId);
  }
  
  abstract getFileContent(projectId: string, filePath: string, ref?: string): Promise<string>;
  abstract clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void>;
  abstract submitComment(
    projectId: string,
    mergeRequestId: number,
    comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean>;
  abstract submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean>;

  // Common utility methods
  protected detectLanguage(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    const languageMap: { [key: string]: string } = {
      'js': 'JavaScript', 'ts': 'TypeScript', 'jsx': 'JavaScript (React)',
      'tsx': 'TypeScript (React)', 'py': 'Python', 'java': 'Java',
      'rb': 'Ruby', 'php': 'PHP', 'go': 'Go', 'cs': 'C#',
      'cpp': 'C++', 'c': 'C', 'rs': 'Rust', 'swift': 'Swift',
      'kt': 'Kotlin', 'sh': 'Shell', 'yml': 'YAML', 'yaml': 'YAML',
      'json': 'JSON', 'md': 'Markdown', 'sql': 'SQL', 'tf': 'Terraform',
      'html': 'HTML', 'css': 'CSS', 'scss': 'SCSS', 'sass': 'Sass',
      'less': 'Less',
    };

    return extension && languageMap[extension] ? languageMap[extension] : 'Unknown';
  }

  // Helper method for making API requests
  protected async apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const headers = {
      ...this.getAuthHeaders(),
      'Content-Type': 'application/json',
      ...options.headers
    };

    return fetch(`${this.apiBaseUrl}/${endpoint}`, {
      ...options,
      headers
    });
  }

  // Common patterns used for identifying AI-generated comments
  protected isAIGeneratedComment(commentBody: string): boolean {
    if (!commentBody) return false;
    
    const aiPatterns = [
      'AI Code Review',
      '## AI Code Review Summary',
      '**Code Review**',
      'Code Review:',
      '**Code Review**:'
    ];
    
    return aiPatterns.some(pattern => commentBody.includes(pattern));
  }

  /**
   * Parse diff/patch content into FileDiff objects
   * This method works with both GitLab and GitHub diff/patch formats
   */
  protected parseDiffContent(diffContent: string): FileDiff[] {
    if (!diffContent) {
      return [];
    }

    const changes: FileDiff[] = [];
    const lines = diffContent.split('\n');
    let oldLineNumber: number | null = null;
    let newLineNumber: number | null = null;

    for (const line of lines) {
      // Parse diff header to get starting line numbers
      if (line.startsWith('@@')) {
        // Parse the hunk header, e.g. @@ -1,7 +1,7 @@
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLineNumber = parseInt(match[1], 10);
          newLineNumber = parseInt(match[2], 10);
        }
        continue;
      }

      // Added lines (start with '+' but not '+++' which is part of the diff header)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        changes.push(
          new FileDiff(
            newLineNumber,
            line.substring(1),
            DiffType.ADDED
          )
        );
        if (newLineNumber !== null) newLineNumber++;
      } 
      // Deleted lines (start with '-' but not '---' which is part of the diff header)
      else if (line.startsWith('-') && !line.startsWith('---')) {
        changes.push(
          new FileDiff(
            null,
            line.substring(1),
            DiffType.DELETED
          )
        );
        if (oldLineNumber !== null) oldLineNumber++;
      } 
      // Unchanged lines (don't start with diff markers)
      else if (!line.startsWith('@@') && !line.startsWith('---') && 
               !line.startsWith('+++') && !line.startsWith('\\')) {
        // We ignore '\ No newline at end of file' lines
        changes.push(
          new FileDiff(
            newLineNumber,
            line,
            DiffType.UNCHANGED
          )
        );
        if (oldLineNumber !== null) oldLineNumber++;
        if (newLineNumber !== null) newLineNumber++;
      }
    }

    return changes;
  }

  // Abstract method to get auth headers for the specific VCS
  protected abstract getAuthHeaders(): Record<string, string>;
}