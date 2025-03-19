import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VersionControlRepository } from '../../core/domain/repositories/version-control.repository';
import { CodeFile, DiffType, FileDiff } from '../../core/domain/entities/code-file.entity';

// Extension de FileDiff pour stocker les line_codes
interface EnhancedDiff {
  filePath: string;
  lineNumber: number;
  lineCode: string;
}

@Injectable()
export class GitlabRepository implements VersionControlRepository {
  private apiBaseUrl: string;
  private apiToken: string;
  // Stockage local des line_codes
  private diffMap: EnhancedDiff[] = [];
  // Stockage des SHA nécessaires pour le positionnement des commentaires
  private baseSha: string | null = null;
  private startSha: string | null = null;
  private headSha: string | null = null;

  constructor(private readonly configService: ConfigService) {
    this.apiBaseUrl = this.configService.get<string>('GITLAB_API_URL', 'https://gitlab.com/api/v4');
    this.apiToken = this.configService.get<string>('GITLAB_API_TOKEN', '');
  }

  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    try {
      // Réinitialiser le diffMap pour chaque nouvelle requête
      this.diffMap = [];
      
      // Récupérer d'abord les détails de la MR pour obtenir les SHAs du diff
      const mrResponse = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}`,
        {
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
          },
        }
      );

      if (mrResponse.ok) {
        const mrData = await mrResponse.json();
        if (mrData.diff_refs) {
          this.baseSha = mrData.diff_refs.base_sha;
          this.startSha = mrData.diff_refs.start_sha;
          this.headSha = mrData.diff_refs.head_sha;
          console.log(`MR SHAs - Base: ${this.baseSha}, Start: ${this.startSha}, Head: ${this.headSha}`);
        } else {
          console.warn('diff_refs information not found in MR data');
        }
      } else {
        console.warn(`Failed to fetch MR details: ${mrResponse.statusText}`);
      }
      
      const response = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/changes`,
        {
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch MR files: ${response.statusText}`);
      }

      const data = await response.json();
      const files: CodeFile[] = [];

      // Récupérer les informations détaillées du diff avec les line_codes
      await this.fetchLineCodesForMR(projectId, mergeRequestId);

      for (const change of data.changes) {
        const filePath = change.new_path;
        try {
          const fileContent = await this.getFileContent(projectId, filePath, data.source_branch);
          
          // Déterminer le langage basé sur l'extension
          const language = this.detectLanguage(filePath);
          
          // Parse the diff to extract added/modified lines with proper line numbers
          const diffLines = this.parseDetailedDiff(filePath, change.diff);
          
          files.push(
            new CodeFile(
              filePath,
              fileContent,
              language,
              change.additions,
              change.deletions,
              diffLines,
            ),
          );
        } catch (err) {
          console.warn(`Skipping file ${filePath} due to error: ${err.message}`);
          // Continuer avec les autres fichiers
        }
      }

      return files;
    } catch (error) {
      console.error('Error fetching merge request files:', error);
      throw new Error(`Failed to get MR files: ${error.message}`);
    }
  }

  // Nouvelle méthode pour récupérer les line_codes
  private async fetchLineCodesForMR(projectId: string, mergeRequestId: number): Promise<void> {
    try {
      // Méthode directe pour récupérer les discussions (commentaires) existantes
      // Cela nous donne accès aux line_codes
      const response = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/discussions`,
        {
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
          },
        }
      );

      if (!response.ok) {
        console.warn(`Failed to fetch discussions: ${response.statusText}`);
        return;
      }

      const discussions = await response.json();
      
      // Récupérer les diffs plus détaillés
      const diffResponse = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/diffs`,
        {
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
          },
        }
      );

      if (diffResponse.ok) {
        const diffs = await diffResponse.json();
        
        for (const diff of diffs) {
          const filePath = diff.new_path;
          
          if (diff.lines) {
            for (const line of diff.lines) {
              if (line.new_line && line.line_code) {
                this.diffMap.push({
                  filePath,
                  lineNumber: line.new_line,
                  lineCode: line.line_code
                });
              }
            }
          }
        }
      }

      // On peut également extraire les line_codes des discussions existantes
      for (const discussion of discussions) {
        // Si c'est une discussion sur une ligne de code
        if (discussion.notes && discussion.notes.length > 0) {
          for (const note of discussion.notes) {
            if (note.position && note.position.line_code && note.position.new_path && note.position.new_line) {
              this.diffMap.push({
                filePath: note.position.new_path,
                lineNumber: note.position.new_line,
                lineCode: note.position.line_code
              });
            }
          }
        }
      }

      console.log(`Extracted ${this.diffMap.length} line codes for the diff`);
    } catch (error) {
      console.error('Error fetching line codes:', error);
    }
  }

  // Amélioration du parsing du diff pour extraire correctement les numéros de ligne
  private parseDetailedDiff(filePath: string, diffContent: string): FileDiff[] {
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
            null,
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
            currentLineOld,
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
            currentLineOld,
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

  async getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.getMergeRequestFiles(projectId, mergeRequestId);
  }

  async getFileContent(projectId: string, filePath: string, ref: string = 'main'): Promise<string> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`,
        {
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
          },
        },
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

  // Récupère le line_code pour un fichier et une ligne donnés
  private getLineCode(filePath: string, lineNumber: number): string | undefined {
    const diffEntry = this.diffMap.find(
      entry => entry.filePath === filePath && entry.lineNumber === lineNumber
    );
    
    if (!diffEntry) {
      // En dernier recours, essayons de générer un line_code
      // Cette approche est basée sur l'observation du format des line_codes GitLab
      const lineCodeGuess = `${filePath}_${lineNumber}`;
      return lineCodeGuess;
    }
    
    return diffEntry.lineCode;
  }

  // Cette méthode supprime tous les commentaires précédents de l'IA
  async clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void> {
    try {
      console.log(`Clearing previous comments from MR ${mergeRequestId}...`);
      
      // Récupérer toutes les notes de la MR
      const notesResponse = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes?per_page=100`,
        {
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
          },
        }
      );
      
      if (!notesResponse.ok) {
        console.warn(`Failed to fetch notes: ${notesResponse.statusText}`);
        return; // Continue without deleting notes
      }
      
      const notes = await notesResponse.json();
      const aiNoteIds: number[] = []; // Changé de Set à Array pour plus de clarté
      
      // Identifier les notes créées par notre système
      for (const note of notes) {
        if (note.body && (note.body.includes('AI Code Review') || note.body.includes('**Code Review**'))) {
          aiNoteIds.push(note.id);
        }
      }
      
      console.log(`Found ${aiNoteIds.length} AI-generated notes to delete`);
      
      // Supprimer les notes (en utilisant une liste des IDs pour éviter les doublons)
      for (const noteId of aiNoteIds) {
        try {
          // URL CORRIGÉE: inclure le mergeRequestId dans le chemin
          const deleteUrl = `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes/${noteId}`;
          console.log(`Deleting note ${noteId} with URL: ${deleteUrl}`);
          
          const response = await fetch(
            deleteUrl,
            {
              method: 'DELETE',
              headers: {
                'PRIVATE-TOKEN': this.apiToken,
              },
            }
          );

          if (!response.ok) {
            console.warn(`Failed to delete note ${noteId}: ${response.statusText}`);
          } else {
            console.log(`Successfully deleted note ${noteId}`);
          }
        } catch (error) {
          console.warn(`Error deleting note ${noteId}:`, error.message);
          // Continue with other notes
        }
      }
      
      console.log('Previous AI comments cleared successfully');
    } catch (error) {
      console.error('Error clearing previous comments:', error);
      // Continuer même si la suppression échoue
    }
  }

  async submitComment(
    projectId: string,
    mergeRequestId: number,
    comment: { filePath: string; lineNumber: number; content: string },
  ): Promise<boolean> {
    try {
      // Vérifier si nous avons les SHAs nécessaires
      if (!this.baseSha || !this.startSha || !this.headSha) {
        // Si pas encore récupérés, essayer de les obtenir
        const mrResponse = await fetch(
          `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}`,
          {
            headers: {
              'PRIVATE-TOKEN': this.apiToken,
            },
          },
        );

        if (mrResponse.ok) {
          const mrData = await mrResponse.json();
          if (mrData.diff_refs) {
            this.baseSha = mrData.diff_refs.base_sha;
            this.startSha = mrData.diff_refs.start_sha;
            this.headSha = mrData.diff_refs.head_sha;
            console.log(`Retrieved MR SHAs - Base: ${this.baseSha}, Start: ${this.startSha}, Head: ${this.headSha}`);
          }
        }
      }
      
      // Si nous avons les SHAs, créer un commentaire positionné
      if (this.baseSha && this.startSha && this.headSha) {
        console.log(`Creating positioned comment for ${comment.filePath}:${comment.lineNumber} with SHAs`);
        
        const commentData = {
          body: `Code Review: ${comment.content}`,
          position: {
            base_sha: this.baseSha,
            start_sha: this.startSha,
            head_sha: this.headSha,
            position_type: 'text',
            new_path: comment.filePath,
            new_line: comment.lineNumber
          }
        };
        
        console.log('Sending comment data:', JSON.stringify(commentData, null, 2));
        
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
          console.log(`Successfully created positioned comment for ${comment.filePath}:${comment.lineNumber}`);
          return true;
        }
        
        const responseData = await response.text();
        console.warn(`Positioned comment failed with status ${response.status}: ${responseData}`);
        
        // Si le commentaire positionné échoue, essayons avec old_path et old_line
        console.log('Trying with old_path and old_line...');
        const commentDataWithOld = {
          body: `Code Review: ${comment.content}`,
          position: {
            base_sha: this.baseSha,
            start_sha: this.startSha,
            head_sha: this.headSha,
            position_type: 'text',
            new_path: comment.filePath,
            new_line: comment.lineNumber,
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
          console.log(`Successfully created positioned comment (with old path/line) for ${comment.filePath}:${comment.lineNumber}`);
          return true;
        }
        
        const retryResponseData = await retryResponse.text();
        console.warn(`Retry positioned comment failed with status ${retryResponse.status}: ${retryResponseData}`);
      } else {
        console.warn('Missing SHAs for positioned comment, falling back to line_code method');
        
        // Essayer avec les line_codes (ancien comportement)
        if (!this.diffMap.length) {
          await this.fetchLineCodesForMR(projectId, mergeRequestId);
        }
        
        const lineCode = this.getLineCode(comment.filePath, comment.lineNumber);
        
        if (lineCode) {
          console.log(`Creating positioned comment with line_code ${lineCode}`);
          
          const response = await fetch(
            `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/discussions`,
            {
              method: 'POST',
              headers: {
                'PRIVATE-TOKEN': this.apiToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                body: `Code Review: ${comment.content}`,
                line_code: lineCode
              }),
            }
          );
          
          if (response.ok) {
            console.log(`Successfully created line_code positioned comment for ${comment.filePath}:${comment.lineNumber}`);
            return true;
          }
          
          const errorText = await response.text();
          console.warn(`Line_code positioned comment failed: ${errorText}`);
        }
      }
      
      // Fallback: ajouter une note simple avec référence au fichier et à la ligne
      console.log(`Falling back to simple note for ${comment.filePath}:${comment.lineNumber}`);
      
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

      if (!noteResponse.ok) {
        const errorText = await noteResponse.text();
        throw new Error(`Failed to submit note: ${noteResponse.statusText} - ${errorText}`);
      }
      
      return true;
    } catch (error) {
      console.error('Error submitting comment:', error);
      throw new Error(`Failed to submit comment: ${error.message}`);
    }
  }

  async submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes`,
        {
          method: 'POST',
          headers: {
            'PRIVATE-TOKEN': this.apiToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: `## AI Code Review Summary\n\n${summary}`,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to submit review summary: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      console.error('Error submitting review summary:', error);
      throw new Error(`Failed to submit review summary: ${error.message}`);
    }
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