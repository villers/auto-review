import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VersionControlRepository } from '@core/domain/repositories/version-control.repository';
import { CodeFile } from '@core/domain/entities/code-file.entity';
import { ApiConfig, VersionControlService } from './version-control.adapter';

// Types for GitHub API responses
interface PullRequestData {
  head: {
    sha: string;
  };
}

interface PullRequestFile {
  filename: string;
  status: string;
  patch?: string;
  binary?: boolean;
}

interface GithubComment {
  id: number;
  body: string;
}

@Injectable()
export class GithubRepository implements VersionControlRepository {
  private readonly apiConfig: ApiConfig;
  private commitSha: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly vcService: VersionControlService
  ) {
    // Set up API configuration
    const baseUrl = this.configService.get<string>('GITHUB_API_URL', 'https://api.github.com');
    const token = this.configService.get<string>('GITHUB_API_TOKEN', '');
    
    this.apiConfig = {
      baseUrl,
      authHeaders: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
  }

  async getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    try {
      // In GitHub, projectId is in format 'owner/repo' and mergeRequestId is the PR number
      const [owner, repo] = this.parseProjectId(projectId);

      // Get the PR details to access the head SHA
      const prData = await this.fetchPullRequestData(owner, repo, mergeRequestId);
      this.commitSha = prData.head.sha;
      
      // Get the files changed in the PR
      const filesData = await this.fetchPullRequestFiles(owner, repo, mergeRequestId);
      
      return this.processFiles(projectId, filesData);
    }
    catch (error) {
      console.log(`Failed to get PR files: ${error.message}`);
      throw new Error(`Failed to get PR files: ${error.message}`);
    }
  }

  async getFileContent(projectId: string, filePath: string, ref: string = 'main'): Promise<string> {
    try {
      const [owner, repo] = this.parseProjectId(projectId);
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
      const [owner, repo] = this.parseProjectId(projectId);
      
      // Get and delete issue comments (main thread comments)
      await this.clearIssueComments(owner, repo, mergeRequestId);
      
      // Get and delete review comments (comments on specific lines of code)
      await this.clearReviewComments(owner, repo, mergeRequestId);
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
      const [owner, repo] = this.parseProjectId(projectId);
      
      // Make sure we have the commit SHA
      if (!this.commitSha) {
        const prData = await this.fetchPullRequestData(owner, repo, mergeRequestId);
        this.commitSha = prData.head.sha;
      }

      // Try creating a review comment on a specific line
      const success = await this.createLineComment(
        owner, 
        repo, 
        mergeRequestId, 
        this.commitSha, 
        comment
      );
      
      if (success) return true;
      
      // If that fails, fall back to a regular issue comment
      return this.createIssueComment(owner, repo, mergeRequestId, comment);
    } catch (error) {
      console.error('Error submitting GitHub PR comment:', error);
      throw new Error(`Failed to submit comment: ${error.message}`);
    }
  }

  async submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean> {
    try {
      const [owner, repo] = this.parseProjectId(projectId);
      
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

  // Private helper methods
  private async apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    return this.vcService.apiRequest(
      this.apiConfig,
      endpoint,
      options
    );
  }

  private parseProjectId(projectId: string): [string, string] {
    const parts = projectId.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid GitHub project ID format: ${projectId}. Expected format: 'owner/repo'`);
    }
    return [parts[0], parts[1]];
  }

  private async fetchPullRequestData(owner: string, repo: string, prNumber: number): Promise<PullRequestData> {
    const response = await this.apiRequest(`repos/${owner}/${repo}/pulls/${prNumber}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch PR details: ${response.statusText}`);
    }
    
    return await response.json();
  }

  private async fetchPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<PullRequestFile[]> {
    const response = await this.apiRequest(`repos/${owner}/${repo}/pulls/${prNumber}/files`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch PR files: ${response.statusText}`);
    }
    
    return await response.json();
  }

  private async processFiles(projectId: string, files: PullRequestFile[]): Promise<CodeFile[]> {
    const processedFiles: CodeFile[] = [];
    
    for (const file of files) {
      // Skip removed or binary files
      if (file.status === 'removed' || file.binary) {
        continue;
      }
      
      const fileContent = await this.getFileContent(projectId, file.filename, this.commitSha || 'main');
      const language = this.vcService.detectLanguage(file.filename);
      const changes = this.vcService.parseDiffContent(file.patch || '');
      
      processedFiles.push(
        new CodeFile(
          file.filename,
          fileContent,
          language,
          changes
        )
      );
    }
    
    return processedFiles;
  }

  private async clearIssueComments(owner: string, repo: string, prNumber: number): Promise<void> {
    // Get all issue comments
    const commentsResponse = await this.apiRequest(
      `repos/${owner}/${repo}/issues/${prNumber}/comments`
    );
    
    if (!commentsResponse.ok) {
      throw new Error(`Failed to fetch comments: ${commentsResponse.statusText}`);
    }
    
    const comments: GithubComment[] = await commentsResponse.json();
    
    // Filter for AI-generated comments
    const aiComments = comments.filter(comment => this.vcService.isAIGeneratedComment(comment.body));
    
    console.log(`Found ${aiComments.length} AI-generated issue comments to delete`);
    
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
  }

  private async clearReviewComments(owner: string, repo: string, prNumber: number): Promise<void> {
    // Get all review comments (comments on specific lines)
    const reviewCommentsResponse = await this.apiRequest(
      `repos/${owner}/${repo}/pulls/${prNumber}/comments`
    );
    
    if (!reviewCommentsResponse.ok) {
      return; // Just return if we can't fetch review comments
    }
    
    const reviewComments: GithubComment[] = await reviewCommentsResponse.json();
    
    // Filter for AI-generated review comments
    const aiReviewComments = reviewComments.filter(
      comment => this.vcService.isAIGeneratedComment(comment.body)
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

  private async createLineComment(
    owner: string, 
    repo: string, 
    prNumber: number, 
    commitSha: string,
    comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean> {
    const response = await this.apiRequest(
      `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          commit_id: commitSha,
          path: comment.filePath,
          line: comment.lineNumber,
          body: `Code Review: ${comment.content}`
        })
      }
    );
    
    return response.ok;
  }

  private async createIssueComment(
    owner: string, 
    repo: string, 
    prNumber: number,
    comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean> {
    const response = await this.apiRequest(
      `repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: `**Code Review**: ${comment.filePath} (line ${comment.lineNumber})\n\n${comment.content}`
        })
      }
    );
    
    return response.ok;
  }
}