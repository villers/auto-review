import { Injectable, Inject, Optional } from '@nestjs/common';
import { VcsService } from '../interfaces/vcs.interface';
import { AiService } from '../interfaces/ai.interface';
import { Review, ReviewStatus, ReviewComment } from '../entities/review';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CodeReviewService {
  constructor(
    @Inject('AI_SERVICE') private readonly aiService: AiService,
    @Optional() @Inject('VCS_SERVICE') private readonly defaultVcsService?: VcsService
  ) {}

  async reviewMergeRequest(
    projectId: string,
    mergeRequestId: number,
    userId: string,
    vcsService?: VcsService,
    postSummary: boolean = false
  ): Promise<Review> {
    // Utiliser le service VCS fourni ou le service par défaut
    const service = vcsService || this.defaultVcsService;
    if (!service) {
      throw new Error('No VCS service provided');
    }

    const reviewId = uuidv4();
    const createdAt = new Date();

    try {
      // 1. Nettoyer les commentaires précédents
      await service.clearPreviousComments(projectId, mergeRequestId);
      
      // 2. Obtenir les fichiers modifiés
      const files = await service.getMergeRequestFiles(projectId, mergeRequestId);
      
      // 3. Analyser le code avec l'IA
      const aiResponse = await this.aiService.analyzeCode(files);
      
      // 4. Convertir les commentaires d'IA au format de revue
      const comments: ReviewComment[] = aiResponse.comments.map(comment => ({
        id: uuidv4(),
        filePath: comment.filePath,
        lineNumber: comment.lineNumber,
        content: comment.content,
        category: comment.category,
        severity: comment.severity,
        createdAt: new Date()
      }));
      
      // 5. Soumettre les commentaires
      for (const comment of comments) {
        await service.submitComment(
          projectId,
          mergeRequestId,
          comment.filePath,
          comment.lineNumber,
          comment.content
        );
      }
      
      // 6. Soumettre le résumé uniquement si demandé
      if (postSummary && aiResponse.summary) {
        await service.submitReviewSummary(projectId, mergeRequestId, aiResponse.summary);
      }
      
      // 7. Créer et retourner l'objet Review
      return {
        id: reviewId,
        projectId,
        mergeRequestId,
        userId,
        createdAt,
        status: ReviewStatus.COMPLETED,
        comments,
        summary: aiResponse.summary
      };
    } catch (error) {
      console.error(`Error reviewing merge request: ${error.message}`);
      return {
        id: reviewId,
        projectId,
        mergeRequestId,
        userId,
        createdAt,
        status: ReviewStatus.FAILED,
        comments: [],
        summary: `Error during code review: ${error.message}`
      };
    }
  }
}
