import { Injectable } from '@nestjs/common';
import { CodeFile } from '@core/domain/entities/code-file.entity';
import { AIRepository } from "@core/domain/repositories/ai.repository";
import { AIResponse } from "@core/domain/entities/ai-response.entity";
import { ConfigService } from '@nestjs/config';

export interface AIModelConfig {
  name: string;
  apiEndpoint: string;
  apiVersion: string;
  temperature?: number;
  maxTokens?: number;
}

@Injectable()
export abstract class AIAdapter implements AIRepository {
  constructor(
    protected readonly configService: ConfigService,
    protected readonly defaultModel: AIModelConfig
  ) {}

  protected currentModel: AIModelConfig;

  async analyzeCode(files: CodeFile[]): Promise<AIResponse> {
    try {
      // Generate prompt for API
      const prompt = this.generatePrompt(files);
      
      // Call AI API
      const analysis = await this.callAPI(prompt);
      
      // Parse the API response
      const response = this.parseResponse(analysis, files);
      
      // Filter comments to only include lines in the diff
      return this.filterCommentsForDiff(response, files);
    } catch (error) {
      console.error(`Error analyzing code with ${this.currentModel.name}:`, error);
      throw error;
    }
  }

  setModel(model: AIModelConfig): void {
    this.currentModel = model;
  }

  getModel(): AIModelConfig {
    return this.currentModel || this.defaultModel;
  }

  protected abstract generatePrompt(files: CodeFile[]): string;
  
  protected abstract callAPI(prompt: string): Promise<string>;
  
  protected abstract parseResponse(response: string, files: CodeFile[]): AIResponse;
  
  protected abstract filterCommentsForDiff(response: AIResponse, files: CodeFile[]): AIResponse;
}