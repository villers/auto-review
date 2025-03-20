import {CommentCategory, CommentSeverity} from "@core/domain/entities/review.entity";

export interface AIResponse {
    comments: {
        filePath: string;
        lineNumber: number;
        content: string;
        category: CommentCategory;
        severity: CommentSeverity;
    }[];
    summary: string;
}