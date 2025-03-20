import {AIResponse} from "@core/domain/entities/ai-response.entity";
import {CodeFile} from "@core/domain/entities/code-file.entity";

export interface AIRepository {
  analyzeCode(files: CodeFile[]): Promise<AIResponse>;
}