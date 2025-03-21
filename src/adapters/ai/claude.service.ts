import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { AiService } from '../../core/interfaces/ai.interface';
import { CodeFile } from '../../core/entities/code-file';
import { AiResponse, CommentCategory, Severity, Comment } from '../../core/entities/ai-response';

interface ClaudeResponse {
  content: {
    type: string;
    text: string;
  }[];
}

interface CodeReviewResponse {
  comments: {
    filePath: string;
    lineNumber: number;
    category: string;
    severity: string;
    problem: string;
    suggestion: string;
  }[];
  summary: string;
}

@Injectable()
export class ClaudeService implements AiService {
  private readonly apiKey: string;
  private readonly apiUrl: string = 'https://api.anthropic.com/v1/messages';
  //private readonly model: string = 'claude-3-opus-20240229';
  private readonly model: string = 'claude-3-7-sonnet-latest';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService
  ) {
    this.apiKey = this.configService.get<string>('CLAUDE_API_KEY', '');
  }

  async analyzeCode(files: CodeFile[]): Promise<AiResponse> {
    // Générer le prompt
    const prompt = this.generatePrompt(files);
    
    try {
      // Appeler l'API Claude
      const response: AxiosResponse<ClaudeResponse> = await lastValueFrom(
        this.httpService.post<ClaudeResponse>(
          this.apiUrl,
          {
            model: this.model,
            max_tokens: 4000,
            messages: [{ role: 'user', content: prompt }]
          },
          {
            headers: {
              'x-api-key': this.apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            timeout: 60000, // 60 secondes
          }
        )
      );
      
      // Extraire la réponse
      const assistantMessage = response.data.content[0].text;
      
      // Analyser la réponse JSON pour extraire les commentaires et le résumé
      return this.parseJsonResponse(assistantMessage, files);
    } catch (error) {
      console.error(`Error calling Claude API: ${error.message}`);
      throw new Error(`Failed to analyze code with Claude: ${error.message}`);
    }
  }

  // Méthodes utilitaires
  private generatePrompt(files: CodeFile[]): string {
    let prompt = `Je voudrais que tu fasses une revue de code des fichiers suivants modifiés dans une pull request. 
Voici ce qui a été modifié:\n\n`;
    
    for (const file of files) {
      prompt += `=== ${file.path} (${file.language}) ===\n`;
      prompt += `${file.content}\n\n`;
      
      if (file.diffs.length > 0) {
        prompt += "Modifications:\n";
        for (const diff of file.diffs) {
          if (diff.type === 'added') {
            prompt += `+ Ligne ${diff.lineNumber}: ${diff.content}\n`;
          } else if (diff.type === 'deleted') {
            prompt += `- Ligne supprimée: ${diff.content}\n`;
          }
        }
        prompt += "\n";
      }
    }
    
    prompt += `Pour chaque problème que tu trouves dans les diff, indique:
1. Le fichier concerné
2. Le numéro de ligne
3. La catégorie du problème (bug, sécurité, performance, style, maintenance)
4. La sévérité (critique, importante, mineure)
5. Une description du problème
6. Une suggestion d'amélioration

IMPORTANT: Réponds uniquement avec un objet JSON valide ayant le format suivant, sans aucun texte avant ou après:
{
  "comments": [
    {
      "filePath": "chemin/vers/fichier.ext",
      "lineNumber": 42,
      "category": "sécurité",
      "severity": "critique",
      "problem": "Description du problème détaillée",
      "suggestion": "Suggestion d'amélioration détaillée"
    },
    // Autres commentaires...
  ],
  "summary": "Résumé global de la qualité du code et des principales améliorations à apporter"
}

Sois strict sur le format JSON, les clés doivent être exactement comme dans l'exemple. Les valeurs valides pour "category" sont: bug, sécurité, performance, style, maintenance. Les valeurs valides pour "severity" sont: critique, importante, mineure.`;

    return prompt;
  }

  private parseJsonResponse(jsonResponseText: string, files: CodeFile[]): AiResponse {
    try {
      // Extraire le JSON de la réponse (au cas où il y aurait du texte avant/après)
      const jsonMatch = jsonResponseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in the response");
      }
      
      const jsonStr = jsonMatch[0];
      const reviewData: CodeReviewResponse = JSON.parse(jsonStr);
      
      // Convertir en format AiResponse
      const result: AiResponse = {
        comments: [],
        summary: reviewData.summary || "Pas de résumé fourni"
      };
      
      // Convertir chaque commentaire
      for (const comment of reviewData.comments) {
        // Vérifier que le fichier existe
        const file = files.find(f => f.path === comment.filePath);
        if (!file) continue;
        
        // Vérifier que la ligne est dans les diffs (optionnel, désactivé pour l'instant)
        // const isDiffLine = file.diffs.some(d => d.lineNumber === comment.lineNumber);
        // if (!isDiffLine) continue;
        
        // Convertir la catégorie
        let category: CommentCategory;
        switch (comment.category.toLowerCase()) {
          case 'bug': category = CommentCategory.BUG; break;
          case 'sécurité': category = CommentCategory.SECURITY; break;
          case 'performance': category = CommentCategory.PERFORMANCE; break;
          case 'style': category = CommentCategory.STYLE; break;
          case 'maintenance': category = CommentCategory.MAINTENANCE; break;
          default: category = CommentCategory.OTHER;
        }
        
        // Convertir la sévérité
        let severity: Severity;
        switch (comment.severity.toLowerCase()) {
          case 'critique': severity = Severity.CRITICAL; break;
          case 'importante': severity = Severity.MAJOR; break;
          case 'mineure': severity = Severity.MINOR; break;
          default: severity = Severity.MINOR;
        }
        
        // Créer le commentaire
        result.comments.push({
          filePath: comment.filePath,
          lineNumber: comment.lineNumber,
          category,
          severity,
          content: `${comment.problem}\n\nSuggestion: ${comment.suggestion}`
        });
      }
      
      return result;
    } catch (error) {
      console.error(`Error parsing JSON response: ${error.message}`);
      
      // Si le parsing JSON échoue, fallback sur une réponse vide
      return {
        comments: [],
        summary: "Erreur lors de l'analyse de la revue de code."
      };
    }
  }
}
