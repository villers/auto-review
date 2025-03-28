import { CodeFile } from '../entities/code-file';
import { AiResponse } from '../entities/ai-response';

/**
 * Interface pour les services d'analyse de code par IA (Claude, OpenAI, etc.)
 */
export interface AiService {
  /**
   * Analyse le code et retourne des commentaires et un résumé
   */
  analyzeCode(files: CodeFile[]): Promise<AiResponse>;
}
