import { CodeFile } from '@core/domain/entities/code-file.entity';
import {AIResponse} from "@core/domain/entities/ai-response.entity";
import {AIRepository} from "@core/domain/repositories/ai.repository";

export class MockAIService implements AIRepository {
  private mockResponse: AIResponse = {
    comments: [],
    summary: 'Mock summary'
  };

  constructor(mockResponse?: AIResponse) {
    if (mockResponse) {
      this.mockResponse = mockResponse;
    }
  }

  setMockResponse(response: AIResponse): void {
    this.mockResponse = response;
  }

  async analyzeCode(files: CodeFile[]): Promise<AIResponse> {
    return this.mockResponse;
  }
}