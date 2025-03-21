import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { VcsService } from '../../core/interfaces/vcs.interface';
import { CodeFile, FileDiff, DiffType } from '../../core/entities/code-file';

/**
 * Configuration pour la connexion à l'API GitHub
 */
interface ApiConfig {
  baseUrl: string;
  authHeaders: Record<string, string>;
}

/**
 * Interface pour un fichier modifié dans une PR
 */
interface PullRequestFile {
  sha: string;
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

/**
 * Interface pour une révision de PR
 */
interface PullRequestReview {
  id: number;
  body: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  user: {
    login: string;
    id: number;
  };
}

/**
 * Interface pour un commentaire sur une PR
 */
interface PullRequestComment {
  id: number;
  body: string;
  user: {
    login: string;
    id: number;
  };
  path?: string;
  position?: number;
  line?: number;
}

/**
 * Service d'interaction avec l'API GitHub
 * Implémente l'interface VcsService pour intégrer GitHub au système de revue de code
 */
@Injectable()
export class GithubService implements VcsService {
  private readonly apiConfig: ApiConfig;
  private readonly botUsername: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService
  ) {
    // Configuration de l'API
    const baseUrl = this.configService.get<string>('GITHUB_API_URL', 'https://api.github.com');
    const token = this.configService.get<string>('GITHUB_API_TOKEN', '');
    this.botUsername = this.configService.get<string>('GITHUB_BOT_USERNAME', 'github-review-bot');

    this.apiConfig = {
      baseUrl,
      authHeaders: { 
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    };
  }

  /**
   * Récupère les fichiers et leurs modifications d'une pull request
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @returns Liste des fichiers modifiés avec leurs différences
   */
  async getMergeRequestFiles(projectId: string, pullRequestId: number): Promise<CodeFile[]> {
    try {
      // Récupérer la liste des fichiers modifiés
      const files = await this.fetchPullRequestFiles(projectId, pullRequestId);
      
      // Récupérer les détails de la PR pour avoir les branches source et cible
      const prDetails = await this.fetchPullRequestDetails(projectId, pullRequestId);
      const baseBranch = prDetails.base.ref;
      const headBranch = prDetails.head.ref;
      
      // Traiter les fichiers modifiés
      return this.processFiles(projectId, files, baseBranch, headBranch);
    } catch (error: any) {
      console.error(`Failed to get PR files: ${error.message}`);
      throw new Error(`Failed to get PR files: ${error.message}`);
    }
  }

  /**
   * Soumet un commentaire sur une ligne spécifique d'un fichier
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @param filePath Chemin du fichier
   * @param lineNumber Numéro de ligne
   * @param content Contenu du commentaire
   */
  async submitComment(
    projectId: string, 
    pullRequestId: number, 
    filePath: string, 
    lineNumber: number, 
    content: string
  ): Promise<void> {
    try {
      // Récupérer les informations sur le dernier commit de la PR
      const prDetails = await this.fetchPullRequestDetails(projectId, pullRequestId);
      const commitSha = prDetails.head.sha;
      
      // Créer un commentaire lié au code
      await this.createReviewComment(
        projectId,
        pullRequestId,
        commitSha,
        filePath,
        lineNumber,
        content
      );
    } catch (error: any) {
      console.error('Error submitting comment:', error);
      throw new Error(`Failed to submit comment: ${error.message}`);
    }
  }

  /**
   * Soumet un résumé global de la revue de code
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @param summary Contenu du résumé
   */
  async submitReviewSummary(projectId: string, pullRequestId: number, summary: string): Promise<void> {
    try {
      // Récupérer les informations sur le dernier commit de la PR
      const prDetails = await this.fetchPullRequestDetails(projectId, pullRequestId);
      const commitSha = prDetails.head.sha;
      
      // Soumettre une revue avec le résumé
      await this.createReview(
        projectId,
        pullRequestId,
        commitSha,
        `## AI Code Review Summary\n\n${summary}`,
        'COMMENT'
      );
    } catch (error: any) {
      console.error('Error submitting review summary:', error);
      throw new Error(`Failed to submit review summary: ${error.message}`);
    }
  }

  /**
   * Supprime les commentaires AI précédemment générés
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   */
  async clearPreviousComments(projectId: string, pullRequestId: number): Promise<void> {
    try {
      console.log(`Clearing previous comments from PR ${pullRequestId}...`);
      
      // Récupérer les commentaires de revue existants
      const comments = await this.fetchPullRequestComments(projectId, pullRequestId);
      
      // Identifier les commentaires générés par l'IA
      const aiCommentIds = this.identifyAiComments(comments);
      
      console.log(`Found ${aiCommentIds.length} AI-generated comments to delete`);
      
      // Supprimer les commentaires
      for (const commentId of aiCommentIds) {
        await this.deleteComment(projectId, commentId);
      }
      
      // Récupérer les revues de code existantes
      const reviews = await this.fetchPullRequestReviews(projectId, pullRequestId);
      
      // Identifier les revues générées par l'IA
      const aiReviews = this.identifyAiReviews(reviews);
      
      console.log(`Found ${aiReviews.length} AI-generated reviews`);
      // GitHub ne permet pas de supprimer les revues, donc on ne peut que les identifier
      
    } catch (error: any) {
      console.error('Error clearing previous comments:', error);
      // Ne pas propager l'erreur pour éviter de bloquer le processus principal
    }
  }

  // ------ Méthodes privées ------

  /**
   * Récupère les détails d'une pull request
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @returns Détails de la pull request
   */
  private async fetchPullRequestDetails(projectId: string, pullRequestId: number): Promise<any> {
    const response: AxiosResponse = await lastValueFrom(this.httpService.get(
      `${this.apiConfig.baseUrl}/repos/${projectId}/pulls/${pullRequestId}`,
      { headers: this.apiConfig.authHeaders }
    ));

    if (response.status !== 200) {
      throw new Error(`Failed to fetch PR details: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Récupère les fichiers d'une pull request
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @returns Liste des fichiers modifiés
   */
  private async fetchPullRequestFiles(projectId: string, pullRequestId: number): Promise<PullRequestFile[]> {
    const response: AxiosResponse<PullRequestFile[]> = await lastValueFrom(this.httpService.get<PullRequestFile[]>(
      `${this.apiConfig.baseUrl}/repos/${projectId}/pulls/${pullRequestId}/files`,
      { 
        headers: this.apiConfig.authHeaders,
        params: { per_page: 100 }
      }
    ));

    if (response.status !== 200) {
      throw new Error(`Failed to fetch PR files: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Récupère les commentaires d'une pull request
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @returns Liste des commentaires
   */
  private async fetchPullRequestComments(projectId: string, pullRequestId: number): Promise<PullRequestComment[]> {
    const response: AxiosResponse<PullRequestComment[]> = await lastValueFrom(this.httpService.get<PullRequestComment[]>(
      `${this.apiConfig.baseUrl}/repos/${projectId}/pulls/${pullRequestId}/comments`,
      { 
        headers: this.apiConfig.authHeaders,
        params: { per_page: 100 }
      }
    ));

    if (response.status !== 200) {
      throw new Error(`Failed to fetch PR comments: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Récupère les revues d'une pull request
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @returns Liste des revues
   */
  private async fetchPullRequestReviews(projectId: string, pullRequestId: number): Promise<PullRequestReview[]> {
    const response: AxiosResponse<PullRequestReview[]> = await lastValueFrom(this.httpService.get<PullRequestReview[]>(
      `${this.apiConfig.baseUrl}/repos/${projectId}/pulls/${pullRequestId}/reviews`,
      { 
        headers: this.apiConfig.authHeaders,
        params: { per_page: 100 }
      }
    ));

    if (response.status !== 200) {
      throw new Error(`Failed to fetch PR reviews: ${response.statusText}`);
    }

    return response.data;
  }

  /**
   * Récupère le contenu d'un fichier
   * @param projectId Nom du dépôt au format owner/repo
   * @param filePath Chemin du fichier
   * @param ref Référence (branche, commit)
   * @returns Contenu du fichier
   */
  private async getFileContent(projectId: string, filePath: string, ref: string = 'main'): Promise<string> {
    try {
      const encodedPath = encodeURIComponent(filePath);
      const response: AxiosResponse = await lastValueFrom(this.httpService.get(
        `${this.apiConfig.baseUrl}/repos/${projectId}/contents/${encodedPath}`,
        { 
          headers: this.apiConfig.authHeaders,
          params: { ref }
        }
      ));

      if (response.status !== 200) {
        throw new Error(`Failed to fetch file content: ${response.statusText}`);
      }

      // GitHub retourne le contenu encodé en base64
      const content = response.data.content;
      return Buffer.from(content, 'base64').toString('utf-8');
    } catch (error: any) {
      console.warn(`Could not fetch content for ${filePath} at ref ${ref}: ${error.message}`);
      return ''; 
    }
  }

  /**
   * Crée un commentaire sur une ligne de code
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @param commitSha SHA du commit
   * @param filePath Chemin du fichier
   * @param lineNumber Numéro de ligne
   * @param content Contenu du commentaire
   */
  private async createReviewComment(
    projectId: string,
    pullRequestId: number,
    commitSha: string,
    filePath: string,
    lineNumber: number,
    content: string
  ): Promise<void> {
    await lastValueFrom(this.httpService.post(
      `${this.apiConfig.baseUrl}/repos/${projectId}/pulls/${pullRequestId}/comments`,
      {
        commit_id: commitSha,
        path: filePath,
        line: lineNumber,
        body: `Code Review: ${content}`
      },
      { headers: this.apiConfig.authHeaders }
    ));
  }

  /**
   * Crée une revue de code
   * @param projectId Nom du dépôt au format owner/repo
   * @param pullRequestId Numéro de la pull request
   * @param commitSha SHA du commit
   * @param body Corps de la revue
   * @param event Type d'événement ('APPROVE', 'REQUEST_CHANGES', 'COMMENT')
   */
  private async createReview(
    projectId: string,
    pullRequestId: number,
    commitSha: string,
    body: string,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  ): Promise<void> {
    await lastValueFrom(this.httpService.post(
      `${this.apiConfig.baseUrl}/repos/${projectId}/pulls/${pullRequestId}/reviews`,
      {
        commit_id: commitSha,
        body,
        event
      },
      { headers: this.apiConfig.authHeaders }
    ));
  }

  /**
   * Supprime un commentaire
   * @param projectId Nom du dépôt au format owner/repo
   * @param commentId Identifiant du commentaire
   */
  private async deleteComment(projectId: string, commentId: number): Promise<void> {
    try {
      const response: AxiosResponse = await lastValueFrom(this.httpService.delete(
        `${this.apiConfig.baseUrl}/repos/${projectId}/pulls/comments/${commentId}`,
        { headers: this.apiConfig.authHeaders }
      ));

      if (response.status !== 204) {
        console.warn(`Failed to delete comment ${commentId}: ${response.statusText}`);
      }
    } catch (error: any) {
      console.warn(`Error deleting comment ${commentId}: ${error.message}`);
    }
  }

  /**
   * Identifie les commentaires générés par l'IA
   * @param comments Liste de commentaires
   * @returns IDs des commentaires à supprimer
   */
  private identifyAiComments(comments: PullRequestComment[]): number[] {
    return comments
      .filter(comment => 
        // Identifier par nom d'utilisateur
        (comment.user.login === this.botUsername ||
        // Ou par contenu du commentaire
        this.isAiGeneratedComment(comment.body))
      )
      .map(comment => comment.id);
  }

  /**
   * Identifie les revues générées par l'IA
   * @param reviews Liste de revues
   * @returns Revues générées par l'IA
   */
  private identifyAiReviews(reviews: PullRequestReview[]): PullRequestReview[] {
    return reviews.filter(review => 
      // Identifier par nom d'utilisateur
      (review.user.login === this.botUsername ||
      // Ou par contenu de la revue
      this.isAiGeneratedComment(review.body))
    );
  }

  /**
   * Traite les fichiers modifiés
   * @param projectId Nom du dépôt au format owner/repo
   * @param files Liste des fichiers modifiés
   * @param baseBranch Branche cible
   * @param headBranch Branche source
   * @returns Liste des fichiers avec leurs modifications
   */
  private async processFiles(
    projectId: string,
    files: PullRequestFile[],
    baseBranch: string,
    headBranch: string
  ): Promise<CodeFile[]> {
    const processedFiles: CodeFile[] = [];

    for (const file of files) {
      // Ignorer les fichiers binaires ou sans patch (impossible à analyser ligne par ligne)
      if (!file.patch) {
        continue;
      }

      const filePath = file.filename;
      let fileContent: string;

      if (file.status === 'removed') {
        // Pour les fichiers supprimés, on récupère l'ancienne version
        fileContent = await this.getFileContent(projectId, filePath, baseBranch);
      } else {
        // Pour les autres, on récupère la version courante
        fileContent = await this.getFileContent(projectId, filePath, headBranch);
      }

      processedFiles.push(
        new CodeFile(
          filePath,
          fileContent,
          this.detectLanguage(filePath),
          this.parseDiffContent(file.patch),
        )
      );
    }

    return processedFiles;
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
