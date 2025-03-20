import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { CodeFile, DiffType, FileDiff } from '@core/domain/entities/code-file.entity';

@Injectable()
export class GithubRepository implements VersionControlRepository {
  private readonly apiBaseUrl: string;
  private readonly apiToken: string;

  constructor(private readonly configService: ConfigService) {
    this.apiBaseUrl = this.configService.get<string>('GITHUB_API_URL', 'https://api.github.com');
    this.apiToken = this.configService.get<string>('GITHUB_API_TOKEN', '');
  }

  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    try {
      // In GitHub, projectId is in format 'owner/repo' and mergeRequestId is the PR number
      const [owner, repo] = projectId.split('/');

      // Get the PR details to access the base and head SHAs
      const prResponse = await this.apiRequest(
          `repos/${owner}/${repo}/pulls/${mergeRequestId}`
      );

      if (!prResponse.ok) {
        throw new Error(`Failed to fetch PR details: ${prResponse.statusText}`);
      }

      const prData = await prResponse.json();
      const headSha = prData.head.sha;

      // Get the files changed in the PR
      const filesResponse = await this.apiRequest(
          `repos/${owner}/${repo}/pulls/${mergeRequestId}/files`
      );

      if (!filesResponse.ok) {
        throw new Error(`Failed to fetch PR files: ${filesResponse.statusText}`);
      }

      const filesData = await filesResponse.json();
      const files: CodeFile[] = [];

      for (const file of filesData) {
        if (file.status === 'removed' || file.binary) {
          continue;
        }

        const fileContent = await this.getFileContent(projectId, file.filename, headSha);
        const language = this.detectLanguage(file.filename);
        const changes = this.parsePatch(file.patch || '');

        files.push(
            new CodeFile(
              file.filename,
              fileContent,
              language,
              changes
            )
        );
        return files;
      }
    }
    catch (error) {
      console.log(`Failed to get PR files: ${error.message}`);
      throw new Error(`Failed to get PR files: ${error.message}`);
    }
  }

  async getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.getMergeRequestFiles(projectId, mergeRequestId);
  }

  async getFileContent(projectId: string, filePath: string, ref: string = 'main'): Promise<string> {
    try {
      const [owner, repo] = projectId.split('/');
      const encodedPath = encodeURIComponent(filePath);
      
      const response = await this.apiRequest(
        `repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch file content: ${response.statusText}`);
      }

      const data = await response.json();
      
      // GitHub API returns content as base64 encoded
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
      console.error(`Error fetching file content for ${filePath}:`, error);
      throw new Error(`Failed to get file content: ${error.message}`);
    }
  }

  async clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void> {
    try {
      console.log(`Clearing previous comments from PR ${mergeRequestId}...`);

      const [owner, repo] = projectId.split('/');
      
      // Get all comments on the PR
      const commentsResponse = await this.apiRequest(
        `repos/${owner}/${repo}/issues/${mergeRequestId}/comments`
      );

      if (!commentsResponse.ok) {
        throw new Error(`Failed to fetch comments: ${commentsResponse.statusText}`);
      }

      const comments = await commentsResponse.json();
      
      // Filter for AI-generated comments
      const aiComments = comments.filter(
        (comment: any) => 
          comment.body && 
          (comment.body.includes('AI Code Review') || 
           comment.body.includes('## AI Code Review Summary'))
      );

      console.log(`Found ${aiComments.length} AI-generated comments to delete`);

      // Delete each AI comment
      for (const comment of aiComments) {
        try {
          const deleteResponse = await this.apiRequest(
            `repos/${owner}/${repo}/issues/comments/${comment.id}`,
            { method: 'DELETE' }
          );

          if (!deleteResponse.ok) {
            console.warn(`Failed to delete comment ${comment.id}: ${deleteResponse.statusText}`);
          }
        } catch (error) {
          console.warn(`Error deleting comment ${comment.id}:`, error.message);
        }
      }
      
      // Get review comments as well (comments on specific lines of code)
      const reviewCommentsResponse = await this.apiRequest(
        `repos/${owner}/${repo}/pulls/${mergeRequestId}/comments`
      );

      if (reviewCommentsResponse.ok) {
        const reviewComments = await reviewCommentsResponse.json();
        
        // Filter for AI-generated review comments
        const aiReviewComments = reviewComments.filter(
          (comment: any) => 
            comment.body && 
            comment.body.includes('Code Review:')
        );

        console.log(`Found ${aiReviewComments.length} AI-generated review comments to delete`);

        // Delete each AI review comment
        for (const comment of aiReviewComments) {
          try {
            const deleteResponse = await this.apiRequest(
              `repos/${owner}/${repo}/pulls/comments/${comment.id}`,
              { method: 'DELETE' }
            );

            if (!deleteResponse.ok) {
              console.warn(`Failed to delete review comment ${comment.id}: ${deleteResponse.statusText}`);
            }
          } catch (error) {
            console.warn(`Error deleting review comment ${comment.id}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('Error clearing previous comments:', error);
    }
  }

  async submitComment(
    projectId: string,
    mergeRequestId: number,
    comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean> {
    try {
      const [owner, repo] = projectId.split('/');
      
      // First, get the PR to find the latest commit SHA
      const prResponse = await this.apiRequest(
        `repos/${owner}/${repo}/pulls/${mergeRequestId}`
      );

      if (!prResponse.ok) {
        throw new Error(`Failed to fetch PR details: ${prResponse.statusText}`);
      }

      const prData = await prResponse.json();
      const commitId = prData.head.sha;

      // Create a review comment
      const response = await this.apiRequest(
        `repos/${owner}/${repo}/pulls/${mergeRequestId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            commit_id: commitId,
            path: comment.filePath,
            line: comment.lineNumber,
            body: `Code Review: ${comment.content}`
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.warn(`Failed to submit comment: ${JSON.stringify(errorData)}`);
        
        // Try using the issue comments endpoint as a fallback
        const fallbackResponse = await this.apiRequest(
          `repos/${owner}/${repo}/issues/${mergeRequestId}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({
              body: `**Code Review**: ${comment.filePath} (line ${comment.lineNumber})\n\n${comment.content}`
            })
          }
        );
        
        return fallbackResponse.ok;
      }

      return true;
    } catch (error) {
      console.error('Error submitting GitHub PR comment:', error);
      throw new Error(`Failed to submit comment: ${error.message}`);
    }
  }

  async submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean> {
    try {
      const [owner, repo] = projectId.split('/');
      
      // Add a regular PR comment with the summary
      const response = await this.apiRequest(
        `repos/${owner}/${repo}/issues/${mergeRequestId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: `## AI Code Review Summary\n\n${summary}`
          })
        }
      );

      return response.ok;
    } catch (error) {
      console.error('Error submitting GitHub PR summary:', error);
      throw new Error(`Failed to submit review summary: ${error.message}`);
    }
  }

  // Helper methods
  private async apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const headers = {
      'Authorization': `token ${this.apiToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers
    };

    return fetch(`${this.apiBaseUrl}/${endpoint}`, {
      ...options,
      headers
    });
  }

  private parsePatch(patch: string): FileDiff[] {
    if (!patch) {
      return [];
    }

    const changes: FileDiff[] = [];
    const lines = patch.split('\n');
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

      if (line.startsWith('+') && !line.startsWith('+++')) {
        changes.push(
          new FileDiff(
            newLineNumber,
            line.substring(1),
            DiffType.ADDED
          )
        );
        if (newLineNumber !== null) newLineNumber++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        changes.push(
          new FileDiff(
            null,
            line.substring(1),
            DiffType.DELETED
          )
        );
        if (oldLineNumber !== null) oldLineNumber++;
      } else if (!line.startsWith('\\')) { // Ignore "\ No newline at end of file"
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