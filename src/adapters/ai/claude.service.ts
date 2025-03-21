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

@Injectable()
export class ClaudeService implements AiService {
  private readonly apiKey: string;
  private readonly apiUrl: string = 'https://api.anthropic.com/v1/messages';
  private readonly model: string = 'claude-3-opus-20240229';

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
            }
          }
        )
      );
      
      // Extraire la réponse
      const assistantMessage = response.data.content[0].text;
      
      // Analyser la réponse pour extraire les commentaires et le résumé
      return this.parseResponse(assistantMessage, files);
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
    
    prompt += `Pour chaque problème que tu trouves, indique:
1. Le fichier concerné
2. Le numéro de ligne
3. La catégorie du problème (bug, sécurité, performance, style, maintenance)
4. La sévérité (critique, importante, mineure)
5. Une description du problème
6. Une suggestion d'amélioration

À la fin, donne un résumé global de la qualité du code et des principales améliorations à apporter.

Format de réponse:
---
## Commentaires

- Fichier: example.ts
- Ligne: 42
- Catégorie: Sécurité
- Sévérité: Critique
- Problème: Description du problème
- Suggestion: Suggestion d'amélioration

(répéter pour chaque problème)

## Résumé

Résumé global de la qualité du code et principales améliorations à apporter.
---`;

    return prompt;
  }

  private parseResponse(response: string, files: CodeFile[]): AiResponse {
    // Structure pour stocker le résultat
    const result: AiResponse = {
      comments: [],
      summary: ''
    };
    
    // Extraction du résumé (tout ce qui se trouve après "## Résumé")
    const summaryMatch = response.match(/## Résumé\s*([\s\S]+)$/);
    if (summaryMatch && summaryMatch[1]) {
      result.summary = summaryMatch[1].trim();
    }
    
    // Extraction des commentaires
    const commentPattern = /- Fichier: (.+?)\s*\n- Ligne: (\d+)\s*\n- Catégorie: (.+?)\s*\n- Sévérité: (.+?)\s*\n- Problème: ([\s\S]+?)\n- Suggestion: ([\s\S]+?)(?=\n\n- Fichier:|\n\n## Résumé|$)/g;
    const commentMatches = response.matchAll(commentPattern);
    
    for (const match of Array.from(commentMatches)) {
      const [_, filePath, lineStr, categoryStr, severityStr, problem, suggestion] = match;
      const lineNumber = parseInt(lineStr, 10);
      
      // Convertir la catégorie en type énuméré
      let category: CommentCategory;
      switch (categoryStr.toLowerCase().trim()) {
        case 'bug': category = CommentCategory.BUG; break;
        case 'sécurité': category = CommentCategory.SECURITY; break;
        case 'performance': category = CommentCategory.PERFORMANCE; break;
        case 'style': category = CommentCategory.STYLE; break;
        case 'maintenance': category = CommentCategory.MAINTENANCE; break;
        default: category = CommentCategory.OTHER;
      }
      
      // Convertir la sévérité en type énuméré
      let severity: Severity;
      switch (severityStr.toLowerCase().trim()) {
        case 'critique': severity = Severity.CRITICAL; break;
        case 'importante': severity = Severity.MAJOR; break;
        case 'mineure': severity = Severity.MINOR; break;
        default: severity = Severity.MINOR;
      }
      
      // Vérifier que le fichier et la ligne existent dans les diffs
      const file = files.find(f => f.path === filePath.trim());
      if (file) {
        const isDiffLine = file.diffs.some(d => d.lineNumber === lineNumber);
        if (isDiffLine || true) { // Pour l'instant, on accepte tous les commentaires, même sur des lignes non modifiées
          const comment: Comment = {
            filePath: filePath.trim(),
            lineNumber,
            category,
            severity,
            content: `${problem.trim()}\n\nSuggestion: ${suggestion.trim()}`
          };
          result.comments.push(comment);
        }
      }
    }
    
    return result;
  }
}
