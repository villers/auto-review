import { CodeFile } from '../entities/code-file';

/**
 * Interface pour les services de contrôle de version (GitLab, GitHub, etc.)
 */
export interface VcsService {
  /**
   * Récupère les fichiers et leurs modifications depuis une merge/pull request
   */
  getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]>;
  
  /**
   * Soumet un commentaire sur une ligne spécifique d'un fichier dans une merge/pull request
   */
  submitComment(
    projectId: string, 
    mergeRequestId: number, 
    filePath: string, 
    lineNumber: number, 
    content: string
  ): Promise<void>;
  
  /**
   * Soumet un résumé global de la revue sur une merge/pull request
   */
  submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<void>;
  
  /**
   * Supprime les commentaires AI précédemment générés sur une merge/pull request
   */
  clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void>;
}
