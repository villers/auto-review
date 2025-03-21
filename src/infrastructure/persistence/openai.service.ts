import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeFile, DiffType } from '@core/domain/entities/code-file.entity';
import { CommentCategory, CommentSeverity } from '@core/domain/entities/review.entity';
import { AIResponse } from "@core/domain/entities/ai-response.entity";
import { AIAdapter, AIModelConfig } from './ai.adapter';

@Injectable()
export class OpenAIService extends AIAdapter {
  
  // OpenAI model configurations
  private readonly OPENAI_MODELS = {
    GPT4: {
      name: 'gpt-4-turbo',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiVersion: '2023-05-15',
      temperature: 0.2,
      maxTokens: 4000
    },
    GPT35: {
      name: 'gpt-3.5-turbo',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiVersion: '2023-05-15',
      temperature: 0.3,
      maxTokens: 2000
    }
  };

  constructor(configService: ConfigService) {
    // Use GPT4 as default model
    super(configService, {
      name: 'gpt-4-turbo',
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiVersion: '2023-05-15',
      temperature: 0.2,
      maxTokens: 4000
    });
    
    // Set current model from default model
    this.currentModel = this.defaultModel;
  }

  // Helper method to set model by name
  setModelByName(modelName: 'GPT4' | 'GPT35'): void {
    this.currentModel = this.OPENAI_MODELS[modelName];
  }

  protected generatePrompt(files: CodeFile[]): string {
    let prompt = `You are a senior software engineer performing a thorough code review. Review ONLY the modified or added lines in the following code files and provide specific, actionable feedback.

CODE FILES AND THEIR MODIFICATIONS:
`;

    // Add only the modified portions of each file to the prompt
    files.forEach((file, index) => {
      prompt += `\n---FILE ${index + 1}: ${file.path} (${file.language})---\n`;
      
      // Extract only modified lines with their line numbers for context
      const modifiedLines = file.changes
        .filter(change => change.type === DiffType.ADDED && change.newLineNumber)
        .map(change => `Line ${change.newLineNumber}: ${change.content}`)
        .join('\n');
      
      prompt += modifiedLines || "No modifications found in this file.";
      prompt += "\n";
    });

    prompt += `
Please analyze ONLY the modified/added lines I've provided and provide:

1. Issues identified with each modified line (do not comment on unmodified lines)
2. Each issue should include: file path, line number, a detailed description of the problem, suggestion for improvement, and assign a category (SECURITY, PERFORMANCE, STYLE, BEST_PRACTICE, BUG, OTHER) and severity (CRITICAL, HIGH, MEDIUM, LOW, INFO)
3. A summary of the overall quality of the changes

IMPORTANT:
- Only comment on lines that were explicitly shown as modified
- Do not invent or assume line numbers that weren't in the provided code
- If there are no issues with the modified code, return an empty comments array

Format your response as a JSON object with the following structure:
{
  "comments": [
    {
      "filePath": "path/to/file",
      "lineNumber": 123,
      "content": "Detailed description and suggestion",
      "category": "CATEGORY",
      "severity": "SEVERITY"
    }
  ],
  "summary": "Overall review summary"
}

IMPORTANT: Your output MUST be valid JSON without any explanation or text outside the JSON object.`;

    return prompt;
  }

  protected async callAPI(prompt: string): Promise<string> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    try {
      const model = this.getModel();
      
      const response = await fetch(model.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'assistants=v1'
        },
        body: JSON.stringify({
          model: model.name,
          max_tokens: model.maxTokens || 4000,
          temperature: model.temperature || 0.2,
          messages: [
            { role: 'system', content: 'You are a code review assistant that outputs only valid JSON.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API Error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      throw new Error(`Failed to call OpenAI API: ${error.message}`);
    }
  }

  protected parseResponse(response: string, files: CodeFile[]): AIResponse {
    try {
      // Clean up the response
      let jsonText = response;
      
      // Remove any markdown code block indicators
      jsonText = jsonText.replace(/```json\s*/g, '');
      jsonText = jsonText.replace(/```\s*$/g, '');
      
      // Suppression de tout texte avant le premier {
      const firstBraceIndex = jsonText.indexOf('{');
      if (firstBraceIndex > 0) {
        jsonText = jsonText.substring(firstBraceIndex);
      }
      
      // Suppression de tout texte après le dernier }
      const lastBraceIndex = jsonText.lastIndexOf('}');
      if (lastBraceIndex !== -1 && lastBraceIndex < jsonText.length - 1) {
        jsonText = jsonText.substring(0, lastBraceIndex + 1);
      }
      
      console.log("Cleaned JSON:", jsonText);
      
      const parsedResponse = JSON.parse(jsonText);
      
      // Validation et nettoyage de la réponse
      const comments = Array.isArray(parsedResponse.comments) 
        ? parsedResponse.comments.map(comment => ({
            filePath: String(comment.filePath || ''),
            lineNumber: Number(comment.lineNumber || 0),
            content: String(comment.content || ''),
            category: this.validateCategory(comment.category),
            severity: this.validateSeverity(comment.severity)
          }))
        : [];
      
      const summary = String(parsedResponse.summary || 'No summary provided.');
      
      return {
        comments,
        summary
      };
    } catch (error) {
      console.error('Error parsing OpenAI response:', error);
      throw new Error(`Error parsing AI response: ${error.message}`);
    }
  }

  protected filterCommentsForDiff(response: AIResponse, files: CodeFile[]): AIResponse {
    const modifiedLines = new Set<string>();
    
    // Build a set of modified lines
    files.forEach(file => {
      // Consider lines mentioned in comments
      response.comments.forEach(comment => {
        if (comment.filePath === file.path) {
          modifiedLines.add(`${file.path}:${comment.lineNumber}`);
        }
      });
      
      // Also get the lines that were actually added or modified
      file.changes.forEach(change => {
        if (change.type === DiffType.ADDED && change.newLineNumber) {
          modifiedLines.add(`${file.path}:${change.newLineNumber}`);
        }
      });
    });
    
    // Filter comments to only keep those that concern modified lines
    const filteredComments = response.comments.filter(comment => {
      const key = `${comment.filePath}:${comment.lineNumber}`;
      return modifiedLines.has(key);
    });
    
    return {
      comments: filteredComments,
      summary: response.summary
    };
  }

  private validateCategory(category: string): CommentCategory {
    const validCategories = Object.values(CommentCategory);
    const normalizedCategory = String(category || '').toUpperCase();
    
    for (const validCategory of validCategories) {
      if (validCategory.toUpperCase() === normalizedCategory) {
        return validCategory as CommentCategory;
      }
    }
    
    return CommentCategory.OTHER;
  }

  private validateSeverity(severity: string): CommentSeverity {
    const validSeverities = Object.values(CommentSeverity);
    const normalizedSeverity = String(severity || '').toUpperCase();
    
    for (const validSeverity of validSeverities) {
      if (validSeverity.toUpperCase() === normalizedSeverity) {
        return validSeverity as CommentSeverity;
      }
    }
    
    return CommentSeverity.INFO;
  }
}