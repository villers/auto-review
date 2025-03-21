import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { VcsService } from '../../core/interfaces/vcs.interface';
import { CodeFile, FileDiff, DiffType } from '../../core/entities/code-file';

/**
 * Configuration pour la connexion à l'API GitLab
 */
interface ApiConfig {
  baseUrl: string;
  authHeaders: Record<string, string>;
}

/**
 * Interface pour les références de diff GitLab
 */
interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}

/**
 * Interface pour un changement de fichier dans une MR
 */
interface MergeRequestChange {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff: string;
}

/**
 * Interface pour tous les changements dans une MR
 */
interface MergeRequestChanges {
  changes: MergeRequestChange[];
  diff_refs: DiffRefs;
  source_branch: string;
  target_branch: string;
}

/**
 * Interface pour une note (commentaire) GitLab
 */
interface Note {
  id: number;
  body: string;
}

/**
 * Type pour le statut d'un fichier modifié
 */
type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

/**
 * Service d'interaction avec l'API GitLab
 * Implémente l'interface VcsService pour intégrer GitLab au système de revue de code
 */
@Injectable()
export class GitlabService implements VcsService {
  private readonly apiConfig: ApiConfig;
  private diffReferences: {
    baseSha: string | null;
    startSha: string | null;
    headSha: string | null;
  } = {
    baseSha: null,
    startSha: null,
    headSha: null
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService
  ) {
    // Configuration de l'API
    const baseUrl = this.configService.get<string>('GITLAB_API_URL', 'https://gitlab.com/api/v4');
    const token = this.configService.get<string>('GITLAB_API_TOKEN', '');

    this.apiConfig = {
      baseUrl,
      authHeaders: { 'PRIVATE-TOKEN': token }
    };
  }

  /**
   * Récupère les fichiers et leurs modifications d'une merge request
   * @param projectId Identifiant du projet GitLab
   * @param mergeRequestId Identifiant de la merge request
   * @returns Liste des fichiers modifiés avec leurs différences
   */
  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    try {
      // Récupérer les changements de la merge request
      const mrChangesData = await this.fetchMergeRequestChanges(projectId, mergeRequestId);
      
      // Stocker les références pour les commentaires positionnels
      this.storeDiffReferences(mrChangesData.diff_refs);
      
      // Traiter les changements de fichiers
      return this.processFileChanges(
        projectId, 
        mrChangesData.changes,
        mrChangesData.source_branch,
        mrChangesData.target_branch
      );
    }
    catch (error: any) {
      console.error(`Failed to get MR files: ${error.message}`);
      throw new Error(`Failed to get MR files: ${error.message}`);
    }
  }

  /**
   * Soumet un commentaire sur une ligne spécifique d'un fichier
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   * @param filePath Chemin du fichier
   * @param lineNumber Numéro de ligne
   * @param content Contenu du commentaire
   */
  async submitComment(
    projectId: string, 
    mergeRequestId: number, 
    filePath: string, 
    lineNumber: number, 
    content: string
  ): Promise<void> {
    try {
      // Essayer d'abord avec un commentaire positionnel si nous avons les références
      if (this.diffReferences.baseSha && this.diffReferences.headSha) {
        // Essayer avec la nouvelle ligne seulement
        const success = await this.tryPositionedComment(
          projectId, 
          mergeRequestId, 
          filePath,
          lineNumber,
          content, 
          false
        );
        
        if (success) return;
        
        // Essayer avec l'ancienne et la nouvelle ligne
        const retrySuccess = await this.tryPositionedComment(
          projectId, 
          mergeRequestId,
          filePath,
          lineNumber,
          content, 
          true
        );
        
        if (retrySuccess) return;
      }

      // Fallback à une note simple
      await this.submitSimpleNote(projectId, mergeRequestId, filePath, lineNumber, content);
    } catch (error: any) {
      console.error('Error submitting comment:', error);
      throw new Error(`Failed to submit comment: ${error.message}`);
    }
  }

  /**
   * Soumet un résumé global de la revue de code
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   * @param summary Contenu du résumé
   */
  async submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<void> {
    try {
      const response: AxiosResponse = await lastValueFrom(this.httpService.post(
        `${this.apiConfig.baseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes`,
        {
          body: summary // Soumettre le résumé tel quel, sans ajouter de titre
        },
        {
          headers: this.apiConfig.authHeaders
        }
      ));

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Failed to submit review summary: ${response.statusText}`);
      }
    } catch (error: any) {
      console.error('Error submitting review summary:', error);
      throw new Error(`Failed to submit review summary: ${error.message}`);
    }
  }

  /**
   * Supprime les commentaires AI précédemment générés
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   */
  async clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void> {
    try {
      console.log(`Clearing previous comments from MR ${mergeRequestId}...`);
      
      // Récupérer toutes les notes
      const notes = await this.fetchMergeRequestNotes(projectId, mergeRequestId);
      
      // Identifier les notes générées par l'IA
      const aiNoteIds = this.identifyAiNotes(notes);
      
      console.log(`Found ${aiNoteIds.length} AI-generated notes to delete`);
      
      // Supprimer les notes
      await this.deleteNotes(projectId, mergeRequestId, aiNoteIds);
    } catch (error: any) {
      console.error('Error clearing previous comments:', error);
      // Ne pas propager l'erreur pour éviter de bloquer le processus principal
    }
  }

  // ------ Méthodes privées ------

  /**
   * Récupère les changements d'une merge request
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   * @returns Données des changements
   */
  private async fetchMergeRequestChanges(
    projectId: string, 
    mergeRequestId: number
  ): Promise<MergeRequestChanges> {
    const response: AxiosResponse<MergeRequestChanges> = await lastValueFrom(this.httpService.get<MergeRequestChanges>(
      `${this.apiConfig.baseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/changes`,
      { headers: this.apiConfig.authHeaders }
    ));

    if (response.status !== 200) {
      throw new Error(`Failed to fetch MR files: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Récupère le contenu d'un fichier
   * @param projectId Identifiant du projet
   * @param filePath Chemin du fichier
   * @param ref Référence (branche, commit)
   * @returns Contenu du fichier
   */
  private async getFileContent(projectId: string, filePath: string, ref: string = 'main'): Promise<string> {
    try {
      const response: AxiosResponse<string> = await lastValueFrom(this.httpService.get<string>(
        `${this.apiConfig.baseUrl}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`,
        { 
          headers: this.apiConfig.authHeaders,
          responseType: 'text'
        }
      ));

      return response.data;
    } catch (error: any) {
      console.warn(`Could not fetch content for ${filePath} at ref ${ref}: ${error.message}`);
      return ''; 
    }
  }

  /**
   * Récupère les notes (commentaires) d'une merge request
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   * @returns Liste des notes
   */
  private async fetchMergeRequestNotes(
    projectId: string, 
    mergeRequestId: number
  ): Promise<Note[]> {
    const response: AxiosResponse<Note[]> = await lastValueFrom(this.httpService.get<Note[]>(
      `${this.apiConfig.baseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes?per_page=100`,
      { headers: this.apiConfig.authHeaders }
    ));

    if (response.status !== 200) {
      throw new Error(`Failed to fetch notes: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Identifie les notes générées par l'IA
   * @param notes Liste des notes
   * @returns IDs des notes à supprimer
   */
  private identifyAiNotes(notes: Note[]): number[] {
    return notes
      .filter(note => this.isAiGeneratedComment(note.body))
      .map(note => note.id);
  }

  /**
   * Supprime une liste de notes
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   * @param noteIds IDs des notes à supprimer
   */
  private async deleteNotes(
    projectId: string, 
    mergeRequestId: number, 
    noteIds: number[]
  ): Promise<void> {
    for (const noteId of noteIds) {
      try {
        const response: AxiosResponse = await lastValueFrom(this.httpService.delete(
          `${this.apiConfig.baseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes/${noteId}`,
          { headers: this.apiConfig.authHeaders }
        ));

        if (response.status !== 200 && response.status !== 204) {
          console.warn(`Failed to delete note ${noteId}: ${response.statusText}`);
        }
      } catch (error: any) {
        console.warn(`Error deleting note ${noteId}:`, error.message);
      }
    }
  }

  /**
   * Tente de soumettre un commentaire positionnel
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   * @param filePath Chemin du fichier
   * @param lineNumber Numéro de ligne
   * @param content Contenu du commentaire
   * @param includeOldPath Inclure l'ancien chemin (pour les lignes modifiées)
   * @returns Succès ou échec
   */
  private async tryPositionedComment(
    projectId: string,
    mergeRequestId: number,
    filePath: string,
    lineNumber: number,
    content: string,
    includeOldPath: boolean
  ): Promise<boolean> {
    // Construire la position pour le commentaire
    const position: Record<string, any> = {
      base_sha: this.diffReferences.baseSha,
      start_sha: this.diffReferences.startSha || this.diffReferences.baseSha,
      head_sha: this.diffReferences.headSha,
      position_type: 'text',
      new_path: filePath,
      new_line: lineNumber
    };

    if (includeOldPath) {
      position.old_path = filePath;
      position.old_line = lineNumber;
    }

    try {
      const response: AxiosResponse = await lastValueFrom(this.httpService.post(
        `${this.apiConfig.baseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/discussions`,
        {
          body: `Code Review: ${content}`,
          position
        },
        { headers: this.apiConfig.authHeaders }
      ));

      return response.status >= 200 && response.status < 300;
    } catch (error: any) {
      console.warn(`Error creating positioned comment: ${error.message}`);
      return false;
    }
  }

  /**
   * Soumet un commentaire simple (non positionnel)
   * @param projectId Identifiant du projet
   * @param mergeRequestId Identifiant de la merge request
   * @param filePath Chemin du fichier
   * @param lineNumber Numéro de ligne
   * @param content Contenu du commentaire
   */
  private async submitSimpleNote(
    projectId: string,
    mergeRequestId: number,
    filePath: string,
    lineNumber: number,
    content: string
  ): Promise<void> {
    await lastValueFrom(this.httpService.post(
      `${this.apiConfig.baseUrl}/projects/${encodeURIComponent(projectId)}/merge_requests/${mergeRequestId}/notes`,
      {
        body: `**Code Review**: ${filePath} (ligne ${lineNumber})\n\n${content}`
      },
      { headers: this.apiConfig.authHeaders }
    ));
  }

  /**
   * Stocke les références de diff pour les commentaires positionnels
   * @param diffRefs Références de diff
   */
  private storeDiffReferences(diffRefs: DiffRefs): void {
    this.diffReferences = {
      baseSha: diffRefs?.base_sha || null,
      startSha: diffRefs?.start_sha || null,
      headSha: diffRefs?.head_sha || null
    };
  }

  /**
   * Traite les changements de fichiers
   * @param projectId Identifiant du projet
   * @param changes Liste des changements
   * @param sourceBranch Branche source
   * @param targetBranch Branche cible
   * @returns Liste des fichiers avec leurs modifications
   */
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
          this.parseDiffContent(file.diff),
        )
      );
    }

    return processedFiles;
  }

  /**
   * Détermine le statut d'un fichier modifié
   * @param file Fichier modifié
   * @returns Statut du fichier
   */
  private getFileStatus(file: MergeRequestChange): FileStatus {
    if (file.new_file) return 'added';
    if (file.deleted_file) return 'deleted';
    if (file.renamed_file) return 'renamed';
    return 'modified';
  }

  /**
   * Récupère le contenu d'un fichier modifié
   * @param projectId Identifiant du projet
   * @param file Fichier modifié
   * @param fileStatus Statut du fichier
   * @param sourceBranch Branche source
   * @param targetBranch Branche cible
   * @returns Contenu du fichier
   */
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
    } catch (error: any) {
      console.warn(`Could not fetch content for ${file.new_path}, using empty content: ${error.message}`);
      return ''; 
    }
  }

  /**
   * Parse le contenu d'un diff en objets FileDiff
   * @param diffContent Contenu du diff
   * @returns Liste des différences par ligne
   */
  private parseDiffContent(diffContent: string): FileDiff[] {
    if (!diffContent) return [];
    
    const diffs: FileDiff[] = [];
    const lines = diffContent.split('\n');
    let lineNumber: number | null = null;
    
    for (const line of lines) {
      // Trouver le numéro de ligne de départ
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          lineNumber = parseInt(match[1], 10);
        }
        continue;
      }
      
      // Ligne ajoutée
      if (line.startsWith('+') && !line.startsWith('+++')) {
        diffs.push({
          lineNumber,
          content: line.substring(1),
          type: DiffType.ADDED
        });
        if (lineNumber !== null) lineNumber++;
      } 
      // Ligne supprimée
      else if (line.startsWith('-') && !line.startsWith('---')) {
        diffs.push({
          lineNumber: null,
          content: line.substring(1),
          type: DiffType.DELETED
        });
      } 
      // Ligne inchangée
      else if (!line.startsWith('@@') && !line.startsWith('---') && 
                !line.startsWith('+++') && !line.startsWith('\\')) {
        diffs.push({
          lineNumber,
          content: line,
          type: DiffType.UNCHANGED
        });
        if (lineNumber !== null) lineNumber++;
      }
    }
    
    return diffs;
  }

  /**
   * Détecte le langage de programmation d'un fichier
   * @param filePath Chemin du fichier
   * @returns Langage du fichier
   */
  private detectLanguage(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    
    const languageMap: Record<string, string> = {
      'js': 'JavaScript', 'ts': 'TypeScript', 'py': 'Python',
      'java': 'Java', 'rb': 'Ruby', 'php': 'PHP',
      'go': 'Go', 'cs': 'C#', 'cpp': 'C++',
      'c': 'C', 'rs': 'Rust', 'swift': 'Swift',
      'kt': 'Kotlin', 'sh': 'Shell', 'yml': 'YAML',
      'yaml': 'YAML', 'json': 'JSON', 'md': 'Markdown',
      'sql': 'SQL', 'tf': 'Terraform', 'html': 'HTML',
      'css': 'CSS', 'scss': 'SCSS', 'sass': 'Sass',
      'less': 'Less'
    };
    
    return languageMap[extension] || 'Unknown';
  }

  /**
   * Vérifie si un commentaire a été généré par l'IA
   * @param commentBody Contenu du commentaire
   * @returns Vrai si généré par l'IA
   */
  private isAiGeneratedComment(commentBody: string): boolean {
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
}
