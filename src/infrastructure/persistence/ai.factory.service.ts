import { Injectable } from '@nestjs/common';
import { AIRepository } from '@core/domain/repositories/ai.repository';
import { ClaudeAIService } from './claude-ai.service';
import { OpenAIService } from './openai.service';

export enum AIProvider {
  CLAUDE = 'claude',
  OPENAI = 'openai'
}

export enum ClaudeModel {
  OPUS = 'OPUS',
  SONNET = 'SONNET',
  HAIKU = 'HAIKU'
}

export enum OpenAIModel {
  GPT4 = 'GPT4',
  GPT35 = 'GPT35'
}

@Injectable()
export class AIFactoryService {
  private currentProvider: AIProvider = AIProvider.CLAUDE;
  
  constructor(
    private readonly claudeService: ClaudeAIService,
    private readonly openaiService: OpenAIService
  ) {}
  
  /**
   * Set the AI provider to use
   */
  setProvider(provider: AIProvider): void {
    this.currentProvider = provider;
  }
  
  /**
   * Get the current provider name
   */
  getProvider(): AIProvider {
    return this.currentProvider;
  }
  
  /**
   * Set the model for the Claude AI service
   */
  setClaudeModel(model: ClaudeModel): void {
    this.claudeService.setModelByName(model);
  }
  
  /**
   * Set the model for the OpenAI service
   */
  setOpenAIModel(model: OpenAIModel): void {
    this.openaiService.setModelByName(model);
  }
  
  /**
   * Get the repository for the current AI provider
   */
  getRepository(): AIRepository {
    switch (this.currentProvider) {
      case AIProvider.CLAUDE:
        return this.claudeService;
      case AIProvider.OPENAI:
        return this.openaiService;
      default:
        // Default to Claude
        return this.claudeService;
    }
  }
}