import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeFile, DiffType, FileDiff } from '@core/domain/entities/code-file.entity';
import { VersionControlAdapter } from './version-control.adapter';

// Types for GitLab API responses
interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}

interface MergeRequestChange {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;
}

interface MergeRequestChanges {
  changes: MergeRequestChange[];
  diff_refs: DiffRefs;
  source_branch: string;
  target_branch: string;
}

interface Note {
  id: number;
  body: string;
}

type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

@Injectable()
export class GitlabRepository extends VersionControlAdapter {
  private diffReferences: {
    baseSha: string | null;
    startSha: string | null;
    headSha: string | null;
  } = {
    baseSha: null,
    startSha: null,
    headSha: null
  };

  constructor(configService: ConfigService) {
    super(
      configService,
      'GITLAB_API_URL',
      'GITLAB_API_TOKEN',
      'https://gitlab.com/api/v4'
    );
  }

  protected getAuthHeaders(): Record<string, string> {
    return { 'PRIVATE-TOKEN': this.apiToken };
  }

  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    try {
      const mrChangesData = await this.fetchMergeRequestChanges(projectId, mergeRequestId);
      this.storeDiffReferences(mrChangesData.diff_refs);
      
      return this.processFileChanges(
        projectId, 
        mrChangesData.changes,
        mrChangesData.source_branch,
        mrChangesData.target_branch
      );
    }
    catch (error) {
      console.log(`Failed to get MR files: ${error.message}`);
      throw new Error(`Failed to get MR files: ${error.message}`);
    }
  }

  async getFileContent(projectId: string, filePath: string, ref: string = 'main'): Promise<string> {
    try {
      const response = await this.apiRequest(
        `projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`File ${filePath} not found in ref ${ref}`);
          return ''; 
        }
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
      const notes = await this.fetchMergeRequestNotes(projectId, mergeRequestId);
      const aiNoteIds = this.identifyAiNotes(notes);
      
      console.log(`Found ${aiNoteIds.length} AI-generated notes to delete`);
      await this.deleteNotes(projectId, mergeRequestId, aiNoteIds);
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
      // Try positioned comment first if we have diff references
      if (this.diffReferences.baseSha && this.diffReferences.headSha) {
        // Try with new line only
        const success = await this.tryPositionedComment(
          projectId, 
          mergeRequestId, 
          comment, 
          false
        );
        if (success) return true;
        
        // Try with both old and new lines
        const retrySuccess = await this.tryPositionedComment(
          projectId, 
          mergeRequestId, 
          comment, 
          true
        );
        if (retrySuccess) return true;
      }

      // Fallback to simple note
      return this.submitSimpleNote(projectId, mergeRequestId, comment);
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
          })
        }
      );

      return response.ok;
    } catch (error) {
      console.error('Error submitting review summary:', error);
      throw new Error(`Failed to submit review summary: ${error.message}`);
    }
  }

  // Private methods
  private async fetchMergeRequestChanges(
    projectId: string, 
    mergeRequestId: number
  ): Promise<MergeRequestChanges> {
    const response = await this.apiRequest(
      `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/changes`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch MR files: ${response.statusText}`);
    }

    return await response.json();
  }

  private async fetchMergeRequestNotes(
    projectId: string, 
    mergeRequestId: number
  ): Promise<Note[]> {
    const response = await this.apiRequest(
      `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes?per_page=100`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch notes: ${response.statusText}`);
    }

    return await response.json();
  }

  private identifyAiNotes(notes: Note[]): number[] {
    return notes
      .filter(note => this.isAIGeneratedComment(note.body))
      .map(note => note.id);
  }

  private async deleteNotes(
    projectId: string, 
    mergeRequestId: number, 
    noteIds: number[]
  ): Promise<void> {
    for (const noteId of noteIds) {
      try {
        const deleteResponse = await this.apiRequest(
          `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes/${noteId}`,
          { method: 'DELETE' }
        );

        if (!deleteResponse.ok) {
          console.warn(`Failed to delete note ${noteId}: ${deleteResponse.statusText}`);
        }
      } catch (error) {
        console.warn(`Error deleting note ${noteId}:`, error.message);
      }
    }
  }

  private async tryPositionedComment(
    projectId: string,
    mergeRequestId: number,
    comment: { filePath: string; lineNumber: number; content: string },
    includeOldPath: boolean
  ): Promise<boolean> {
    const position: any = {
      base_sha: this.diffReferences.baseSha,
      start_sha: this.diffReferences.startSha || this.diffReferences.baseSha,
      head_sha: this.diffReferences.headSha,
      position_type: 'text',
      new_path: comment.filePath,
      new_line: comment.lineNumber
    };

    if (includeOldPath) {
      position.old_path = comment.filePath;
      position.old_line = comment.lineNumber;
    }

    const response = await this.apiRequest(
      `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/discussions`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: `Code Review: ${comment.content}`,
          position
        }),
      }
    );

    return response.ok;
  }

  private async submitSimpleNote(
    projectId: string,
    mergeRequestId: number,
    comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean> {
    const noteResponse = await this.apiRequest(
      `projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: `**Code Review**: ${comment.filePath} (line ${comment.lineNumber})\n\n${comment.content}`,
        }),
      }
    );

    return noteResponse.ok;
  }

  private storeDiffReferences(diffRefs: DiffRefs): void {
    this.diffReferences = {
      baseSha: diffRefs?.base_sha || null,
      startSha: diffRefs?.start_sha || null,
      headSha: diffRefs?.head_sha || null
    };
  }

  private async processFileChanges(
    projectId: string, 
    changes: MergeRequestChange[], 
    sourceBranch: string,
    targetBranch: string
  ): Promise<CodeFile[]> {
    const processedFiles: CodeFile[] = [];

    for (const file of changes) {
      const filePath = file.new_path;
      const fileStatus = this.getFileStatus(file);
      const fileContent = await this.fetchFileContent(
        projectId,
        file,
        fileStatus,
        sourceBranch,
        targetBranch
      );

      processedFiles.push(
        new CodeFile(
          filePath,
          fileContent,
          this.detectLanguage(filePath),
          this.parseDiffContent(file.diff), // Utilise la méthode commune
        )
      );
    }

    return processedFiles;
  }

  private getFileStatus(file: MergeRequestChange): FileStatus {
    if (file.new_file) return 'added';
    if (file.deleted_file) return 'deleted';
    if (file.renamed_file) return 'renamed';
    return 'modified';
  }

  private async fetchFileContent(
    projectId: string,
    file: MergeRequestChange,
    fileStatus: FileStatus,
    sourceBranch: string,
    targetBranch: string
  ): Promise<string> {
    try {
      if (fileStatus === 'deleted') {
        return await this.getFileContent(
          projectId, 
          file.old_path, 
          this.diffReferences.baseSha || targetBranch
        );
      } 
      
      return await this.getFileContent(
        projectId,
        file.new_path,
        sourceBranch
      );
    } catch (error) {
      console.warn(`Could not fetch content for ${file.new_path}, using empty content: ${error.message}`);
      return ''; 
    }
  }
}