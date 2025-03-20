import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { CodeFile, DiffType, FileDiff } from '@core/domain/entities/code-file.entity';

@Injectable()
export class GitlabRepository implements VersionControlRepository {
  private readonly apiBaseUrl: string;
  private readonly apiToken: string;
  private diffReferences: {
    baseSha: string | null;
    startSha: string | null;
    headSha: string | null;
  } = {
    baseSha: null,
    startSha: null,
    headSha: null
  };

  constructor(private readonly configService: ConfigService) {
    this.apiBaseUrl = this.configService.get<string>('GITLAB_API_URL', 'https://gitlab.com/api/v4');
    this.apiToken = this.configService.get<string>('GITLAB_API_TOKEN', '');
  }

  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    try {
      // Get MR details to retrieve SHAs
      await this.fetchMergeRequestDetails(projectId, mergeRequestId);
      
      // Get changes (including diffs)
      const response = await this.apiRequest(
        `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/changes`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch MR files: ${response.statusText}`);
      }

      const data = await response.json();
      const files: CodeFile[] = [];

      for (const change of data.changes) {
        const filePath = change.new_path;
        try {
          const fileContent = await this.getFileContent(projectId, filePath, data.source_branch);
          const language = this.detectLanguage(filePath);
          const diffLines = this.parseDiff(change.diff);
          
          files.push(
            new CodeFile(
              filePath,
              fileContent,
              language,
              diffLines,
            ),
          );
        } catch (err) {
          console.warn(`Skipping file ${filePath} due to error: ${err.message}`);
        }
      }

      return files;
    } catch (error) {
      console.error('Error fetching merge request files:', error);
      throw new Error(`Failed to get MR files: ${error.message}`);
    }
  }

  async getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.getMergeRequestFiles(projectId, mergeRequestId);
  }

  async getFileContent(projectId: string, filePath: string, ref: string = 'main'): Promise<string> {
    try {
      const response = await this.apiRequest(
        `projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch file content: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      console.error(`Error fetching file content for ${filePath}:`, error);
      throw new Error(`Failed to get file content: ${error.message}`);
    }
  }

  async clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void> {
    try {
      console.log(`Clearing previous comments from MR ${mergeRequestId}...`);
      
      // Get all notes from the MR
      const response = await this.apiRequest(
        `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes?per_page=100`
      );
      
      if (!response.ok) {
        console.warn(`Failed to fetch notes: ${response.statusText}`);
        return;
      }
      
      const notes = await response.json();
      const aiNoteIds: number[] = [];
      
      // Identify AI-generated notes
      for (const note of notes) {
        if (note.body && (note.body.includes('AI Code Review') || note.body.includes('**Code Review**'))) {
          aiNoteIds.push(note.id);
        }
      }
      
      console.log(`Found ${aiNoteIds.length} AI-generated notes to delete`);
      
      // Delete each note
      for (const noteId of aiNoteIds) {
        try {
          const deleteResponse = await fetch(
            `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes/${noteId}`,
            {
              method: 'DELETE',
              headers: { 'PRIVATE-TOKEN': this.apiToken },
            }
          );

          if (!deleteResponse.ok) {
            console.warn(`Failed to delete note ${noteId}: ${deleteResponse.statusText}`);
          }
        } catch (error) {
          console.warn(`Error deleting note ${noteId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error clearing previous comments:', error);
    }
  }

  async submitComment(
    projectId: string,
    mergeRequestId: number,
    comment: { filePath: string; lineNumber: number; content: string },
  ): Promise<boolean> {
    try {
      // Ensure we have the necessary SHAs
      if (!this.diffReferences.baseSha) {
        await this.fetchMergeRequestDetails(projectId, mergeRequestId);
      }
      
      // Attempt to create a positioned comment
      if (this.diffReferences.baseSha && this.diffReferences.headSha) {
        const commentData = {
          body: `Code Review: ${comment.content}`,
          position: {
            base_sha: this.diffReferences.baseSha,
            start_sha: this.diffReferences.startSha || this.diffReferences.baseSha,
            head_sha: this.diffReferences.headSha,
            position_type: 'text',
            new_path: comment.filePath,
            new_line: comment.lineNumber
          }
        };
        
        const response = await fetch(
          `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/discussions`,
          {
            method: 'POST',
            headers: {
              'PRIVATE-TOKEN': this.apiToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(commentData),
          }
        );

        if (response.ok) {
          return true;
        }
        
        // If failed, try with old_path/old_line included
        const commentDataWithOld = {
          ...commentData,
          position: {
            ...commentData.position,
            old_path: comment.filePath,
            old_line: comment.lineNumber
          }
        };
        
        const retryResponse = await fetch(
          `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/discussions`,
          {
            method: 'POST',
            headers: {
              'PRIVATE-TOKEN': this.apiToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(commentDataWithOld),
          }
        );
        
        if (retryResponse.ok) {
          return true;
        }
      }
      
      // Fallback: add a simple note with file and line reference
      const noteResponse = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes`,
        {
          method: 'POST',
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: `**Code Review**: ${comment.filePath} (ligne ${comment.lineNumber})\n\n${comment.content}`,
          }),
        }
      );

      return noteResponse.ok;
    } catch (error) {
      console.error('Error submitting comment:', error);
      throw new Error(`Failed to submit comment: ${error.message}`);
    }
  }

  async submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean> {
    try {
      const response = await this.apiRequest(
        `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: `## AI Code Review Summary\n\n${summary}`,
          }),
        }
      );

      return response.ok;
    } catch (error) {
      console.error('Error submitting review summary:', error);
      throw new Error(`Failed to submit review summary: ${error.message}`);
    }
  }

  // Helper methods
  private async fetchMergeRequestDetails(projectId: string, mergeRequestId: number): Promise<void> {
    try {
      const response = await this.apiRequest(
        `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}`
      );

      if (response.ok) {
        const mrData = await response.json();
        if (mrData.diff_refs) {
          this.diffReferences = {
            baseSha: mrData.diff_refs.base_sha,
            startSha: mrData.diff_refs.start_sha,
            headSha: mrData.diff_refs.head_sha
          };
        }
      }
    } catch (error) {
      console.warn('Failed to fetch MR details:', error);
    }
  }

  private async apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const headers = {
      'PRIVATE-TOKEN': this.apiToken,
      'Content-Type': 'application/json',
      ...options.headers
    };

    return fetch(`${this.apiBaseUrl}/${endpoint}`, {
      ...options,
      headers
    });
  }

  private parseDiff(diffContent: string): FileDiff[] {
    if (!diffContent) {
      return [];
    }

    const changes: FileDiff[] = [];
    const lines = diffContent.split('\n');
    let currentLineOld = null;
    let currentLineNew = null;
    
    for (const line of lines) {
      // Parse diff header to get starting line numbers
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          currentLineOld = parseInt(match[1], 10);
          currentLineNew = parseInt(match[2], 10);
        }
        continue;
      }
      
      if (line.startsWith('+') && !line.startsWith('+++')) {
        // Added line
        changes.push(
          new FileDiff(
            currentLineNew,
            line.substring(1),
            DiffType.ADDED,
          ),
        );
        if (currentLineNew !== null) currentLineNew++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Removed line
        changes.push(
          new FileDiff(
            null,
            line.substring(1),
            DiffType.DELETED,
          ),
        );
        if (currentLineOld !== null) currentLineOld++;
      } else if (!line.startsWith('@@') && !line.startsWith('---') && !line.startsWith('+++')) {
        // Unchanged line
        changes.push(
          new FileDiff(
            currentLineNew,
            line,
            DiffType.UNCHANGED,
          ),
        );
        if (currentLineOld !== null) currentLineOld++;
        if (currentLineNew !== null) currentLineNew++;
      }
    }

    return changes;
  }

  private detectLanguage(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    const languageMap: { [key: string]: string } = {
      'js': 'JavaScript',
      'ts': 'TypeScript',
      'jsx': 'JavaScript (React)',
      'tsx': 'TypeScript (React)',
      'py': 'Python',
      'java': 'Java',
      'rb': 'Ruby',
      'php': 'PHP',
      'go': 'Go',
      'cs': 'C#',
      'cpp': 'C++',
      'c': 'C',
      'rs': 'Rust',
      'swift': 'Swift',
      'kt': 'Kotlin',
      'sh': 'Shell',
      'yml': 'YAML',
      'yaml': 'YAML',
      'json': 'JSON',
      'md': 'Markdown',
      'sql': 'SQL',
      'tf': 'Terraform',
      'html': 'HTML',
      'css': 'CSS',
      'scss': 'SCSS',
      'sass': 'Sass',
      'less': 'Less',
    };

    return extension && languageMap[extension] 
      ? languageMap[extension] 
      : 'Unknown';
  }
}