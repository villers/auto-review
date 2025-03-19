import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VersionControlRepository } from '../../core/domain/repositories/version-control.repository';
import { CodeFile, DiffType, FileDiff } from '../../core/domain/entities/code-file.entity';

@Injectable()
export class GithubRepository implements VersionControlRepository {
  private apiBaseUrl: string;
  private apiToken: string;

  constructor(private readonly configService: ConfigService) {
    this.apiBaseUrl = this.configService.get<string>('GITHUB_API_URL', 'https://api.github.com');
    this.apiToken = this.configService.get<string>('GITHUB_API_TOKEN', '');
  }

  async clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void> {
    try {
      const [owner, repo] = projectId.split('/');
      
      // Get all comments on the PR
      const commentsResponse = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/issues/${mergeRequestId}/comments`,
        {
          headers: this.getHeaders(),
        }
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
          const deleteResponse = await fetch(
            `${this.apiBaseUrl}/repos/${owner}/${repo}/issues/comments/${comment.id}`,
            {
              method: 'DELETE',
              headers: this.getHeaders(),
            }
          );

          if (!deleteResponse.ok) {
            console.warn(`Failed to delete comment ${comment.id}: ${deleteResponse.statusText}`);
          } else {
            console.log(`Successfully deleted comment ${comment.id}`);
          }
        } catch (error) {
          console.warn(`Error deleting comment ${comment.id}:`, error.message);
          // Continue with other comments
        }
      }
      
      // Get review comments as well (comments on specific lines of code)
      const reviewCommentsResponse = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/${mergeRequestId}/comments`,
        {
          headers: this.getHeaders(),
        }
      );

      if (reviewCommentsResponse.ok) {
        const reviewComments = await reviewCommentsResponse.json();
        
        // Filter for AI-generated review comments
        const aiReviewComments = reviewComments.filter(
          (comment: any) => 
            comment.body && 
            comment.body.includes('AI Code Review')
        );

        console.log(`Found ${aiReviewComments.length} AI-generated review comments to delete`);

        // Delete each AI review comment
        for (const comment of aiReviewComments) {
          try {
            const deleteResponse = await fetch(
              `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/comments/${comment.id}`,
              {
                method: 'DELETE',
                headers: this.getHeaders(),
              }
            );

            if (!deleteResponse.ok) {
              console.warn(`Failed to delete review comment ${comment.id}: ${deleteResponse.statusText}`);
            } else {
              console.log(`Successfully deleted review comment ${comment.id}`);
            }
          } catch (error) {
            console.warn(`Error deleting review comment ${comment.id}:`, error.message);
            // Continue with other comments
          }
        }
      }
      
      console.log('Previous AI comments cleared successfully');
    } catch (error) {
      console.error('Error clearing previous comments:', error);
      // Continue even if clearing fails
    }
  }

  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    try {
      // In GitHub, projectId is in format 'owner/repo' and mergeRequestId is the PR number
      const [owner, repo] = projectId.split('/');
      
      // Get the PR details to access the base and head SHAs
      const prResponse = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/${mergeRequestId}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!prResponse.ok) {
        throw new Error(`Failed to fetch PR details: ${prResponse.statusText}`);
      }

      const prData = await prResponse.json();
      const baseSha = prData.base.sha;
      const headSha = prData.head.sha;

      // Get the files changed in the PR
      const filesResponse = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/${mergeRequestId}/files`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!filesResponse.ok) {
        throw new Error(`Failed to fetch PR files: ${filesResponse.statusText}`);
      }

      const filesData = await filesResponse.json();

      // Process each file
      const files: CodeFile[] = [];
      for (const file of filesData) {
        // Skip binary files or deleted files
        if (file.status === 'removed' || file.binary) {
          continue;
        }

        // Get the file content
        let fileContent = '';
        try {
          fileContent = await this.getFileContent(projectId, file.filename, headSha);
        } catch (error) {
          console.warn(`Could not get content for ${file.filename}: ${error.message}`);
          // Continue with empty content if we can't fetch it
        }

        // Process the patch to create FileDiff objects
        const changes = this.parsePatch(file.patch || '');

        // Determine the language based on the file extension
        const language = this.detectLanguage(file.filename);

        files.push(
          new CodeFile(
            file.filename,
            fileContent,
            language,
            file.additions,
            file.deletions,
            changes
          )
        );
      }

      return files;
    } catch (error) {
      console.error('Error fetching GitHub PR files:', error);
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
      
      const response = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`,
        {
          headers: this.getHeaders(),
        }
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

  async submitComment(
    projectId: string,
    mergeRequestId: number,
    comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean> {
    try {
      const [owner, repo] = projectId.split('/');
      
      // First, get the PR to find the latest commit SHA
      const prResponse = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/${mergeRequestId}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!prResponse.ok) {
        throw new Error(`Failed to fetch PR details: ${prResponse.statusText}`);
      }

      const prData = await prResponse.json();
      const commitId = prData.head.sha;

      // Create a review comment
      const response = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/pulls/${mergeRequestId}/comments`,
        {
          method: 'POST',
          headers: {
            ...this.getHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commit_id: commitId,
            path: comment.filePath,
            line: comment.lineNumber,
            body: comment.content,
            position: comment.lineNumber, // This is a simplification; GitHub needs the position in the diff
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to submit comment: ${JSON.stringify(errorData)}`);
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
      const response = await fetch(
        `${this.apiBaseUrl}/repos/${owner}/${repo}/issues/${mergeRequestId}/comments`,
        {
          method: 'POST',
          headers: {
            ...this.getHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: `## AI Code Review Summary\n\n${summary}`,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to submit review summary: ${JSON.stringify(errorData)}`);
      }

      return true;
    } catch (error) {
      console.error('Error submitting GitHub PR summary:', error);
      throw new Error(`Failed to submit review summary: ${error.message}`);
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `token ${this.apiToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private parsePatch(patch: string): FileDiff[] {
    if (!patch) {
      return [];
    }

    const changes: FileDiff[] = [];
    const lines = patch.split('\n');
    
    // Track the current line numbers
    let oldLineNumber: number | null = null;
    let newLineNumber: number | null = null;

    // Simple heuristic parser for the patch format
    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Parse the hunk header, e.g. @@ -1,7 +1,7 @@
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLineNumber = parseInt(match[1], 10);
          newLineNumber = parseInt(match[2], 10);
        }
        continue;
      }

      if (line.startsWith('+')) {
        changes.push(
          new FileDiff(
            null,
            newLineNumber,
            line.substring(1),
            DiffType.ADDED
          )
        );
        if (newLineNumber !== null) newLineNumber++;
      } else if (line.startsWith('-')) {
        changes.push(
          new FileDiff(
            oldLineNumber,
            null,
            line.substring(1),
            DiffType.DELETED
          )
        );
        if (oldLineNumber !== null) oldLineNumber++;
      } else if (!line.startsWith('\\')) { // Ignore "\ No newline at end of file"
        changes.push(
          new FileDiff(
            oldLineNumber,
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