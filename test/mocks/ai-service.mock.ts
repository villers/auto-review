import { AIService, AIServiceResponse } from '../../src/core/interfaces/ai-service.interface';
import { CodeFile } from '../../src/core/domain/entities/code-file.entity';
import { CommentCategory, CommentSeverity } from '../../src/core/domain/entities/review.entity';

export class MockAIService implements AIService {
  private mockResponse: AIServiceResponse = {
    comments: [],
    summary: 'Mock summary'
  };

  constructor(mockResponse?: AIServiceResponse) {
    if (mockResponse) {
      this.mockResponse = mockResponse;
    }
  }

  setMockResponse(response: AIServiceResponse): void {
    this.mockResponse = response;
  }

  async analyzeCode(files: CodeFile[]): Promise<AIServiceResponse> {
    return this.mockResponse;
  }
}