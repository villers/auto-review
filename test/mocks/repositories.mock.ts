import { ReviewRepository } from '../../src/core/domain/repositories/review.repository';
import { VersionControlRepository } from '../../src/core/domain/repositories/version-control.repository';
import { Review, ReviewComment, ReviewStatus } from '../../src/core/domain/entities/review.entity';
import { CodeFile } from '../../src/core/domain/entities/code-file.entity';

export class MockReviewRepository implements ReviewRepository {
  private reviews: Map<string, Review> = new Map();

  async createReview(review: Review): Promise<Review> {
    this.reviews.set(review.id, review);
    return review;
  }

  async getReviewById(id: string): Promise<Review | null> {
    return this.reviews.get(id) || null;
  }

  async getReviewsByProjectId(projectId: string): Promise<Review[]> {
    return Array.from(this.reviews.values())
      .filter(review => review.projectId === projectId);
  }

  async getReviewsByMergeRequestId(projectId: string, mergeRequestId: number): Promise<Review[]> {
    return Array.from(this.reviews.values())
      .filter(
        review => 
          review.projectId === projectId && 
          review.mergeRequestId === mergeRequestId
      );
  }

  async updateReview(review: Review): Promise<Review> {
    // Pour un test spécifique, conserver le status COMPLETED
    // Le mock repositoire pourrait changer le status dans un scénario réel,
    // mais pour les tests, nous voulons qu'il reste COMPLETED
    const updatedReview = new Review(
      review.id,
      review.projectId,
      review.mergeRequestId,
      review.commitSha,
      review.createdAt,
      review.userId,
      review.status,  // Préserver le statut d'origine
      review.comments,
      review.summary
    );
    this.reviews.set(review.id, updatedReview);
    return updatedReview;
  }

  async addCommentToReview(reviewId: string, comment: ReviewComment): Promise<Review> {
    const review = await this.getReviewById(reviewId);
    if (!review) {
      throw new Error(`Review with id ${reviewId} not found`);
    }

    const updatedReview = new Review(
      review.id,
      review.projectId,
      review.mergeRequestId,
      review.commitSha,
      review.createdAt,
      review.userId,
      review.status,
      [...review.comments, comment],
      review.summary,
    );

    return this.updateReview(updatedReview);
  }

  async deleteReview(id: string): Promise<boolean> {
    return this.reviews.delete(id);
  }
}

export class MockVersionControlRepository implements VersionControlRepository {
  private files: Map<string, string> = new Map();
  private diffFiles: CodeFile[] = [];
  private comments: any[] = [];
  private summaries: Map<string, string> = new Map();
  
  // Ajouter la méthode manquante
  async clearPreviousComments(projectId: string, mergeRequestId: number): Promise<void> {
    // Ne rien faire dans le mock
    return;
  }

  constructor(mockFiles: CodeFile[] = []) {
    this.diffFiles = mockFiles;
  }

  setMockFiles(files: CodeFile[]): void {
    this.diffFiles = files;
  }

  async getMergeRequestFiles(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.diffFiles;
  }

  async getMergeRequestDiff(projectId: string, mergeRequestId: number): Promise<CodeFile[]> {
    return this.diffFiles;
  }

  async getFileContent(projectId: string, filePath: string, ref?: string): Promise<string> {
    const key = `${projectId}/${filePath}/${ref || 'default'}`;
    const content = this.files.get(key);
    if (!content) {
      throw new Error(`File not found: ${filePath}`);
    }
    return content;
  }

  setMockFileContent(projectId: string, filePath: string, content: string, ref: string = 'default'): void {
    const key = `${projectId}/${filePath}/${ref}`;
    this.files.set(key, content);
  }

  async submitComment(
    projectId: string, 
    mergeRequestId: number, 
    comment: { filePath: string; lineNumber: number; content: string }
  ): Promise<boolean> {
    this.comments.push({
      projectId,
      mergeRequestId,
      ...comment
    });
    return true;
  }

  getSubmittedComments(): any[] {
    return this.comments;
  }

  async submitReviewSummary(projectId: string, mergeRequestId: number, summary: string): Promise<boolean> {
    const key = `${projectId}/${mergeRequestId}`;
    this.summaries.set(key, summary);
    return true;
  }

  getSubmittedSummary(projectId: string, mergeRequestId: number): string | undefined {
    const key = `${projectId}/${mergeRequestId}`;
    return this.summaries.get(key);
  }
}